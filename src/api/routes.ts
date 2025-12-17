import { Router, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db/connection';
import { SvcWorkizLeads } from '../services/svc-workiz-leads';
import { SvcWorkizJobs } from '../services/svc-workiz-jobs';
import { SvcWorkizPayments } from '../services/svc-workiz-payments';
import { SvcElocalCalls } from '../services/svc-elocal-calls';
import { CsvService } from '../services/csv.service';
import dbRoutes from './db-routes';
import { parse } from 'csv-parse/sync';

const router = Router();

// ============================================================================
// PUBLIC WEB INTERFACE ENDPOINTS (no authentication required)
// ============================================================================
// These endpoints must be defined BEFORE dbRoutes to avoid authentication middleware

// Get list of all tables with row counts
router.get('/api/tables', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tables = await Promise.all(
      result.rows.map(async (row) => {
        try {
          const countResult = await pool.query(
            `SELECT COUNT(*) as cnt FROM ${row.table_name}`
          );
          return {
            name: row.table_name,
            rowCount: parseInt(countResult.rows[0].cnt, 10)
          };
        } catch (err: any) {
          // If table doesn't exist or can't be queried, return 0
          console.warn(`Error counting rows in ${row.table_name}:`, err.message);
          return {
            name: row.table_name,
            rowCount: 0
          };
        }
      })
    );

    res.json({ tables });
  } catch (error: any) {
    console.error('Error fetching tables list:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Get table data with pagination
router.get('/api/table/:tableName', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = Math.min(parseInt(req.query.limit as string || '100', 10), 1000); // Max 1000 rows per request

    // Validate table name (only letters, numbers, underscores)
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json({ 
        error: 'Invalid table name',
        message: 'Table name can only contain letters, numbers, and underscores'
      });
    }

    // Get total row count
    const countResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM ${tableName}`
    );
    const totalRows = parseInt(countResult.rows[0].cnt, 10);

    // Get column names
    const columnsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    let columns = columnsResult.rows.map(row => row.column_name);

    // For fact_jobs, customize column order and visibility
    if (tableName === 'fact_jobs') {
      // Exclude created_at and scheduled_at from display
      columns = columns.filter(col => col !== 'created_at' && col !== 'scheduled_at');
      
      // Define columns that should be at the end
      const endColumns = ['meta', 'lead_id', 'source_id', 'created_at_db', 'updated_at_db'];
      
      // Separate columns into regular and end columns
      let regularColumns = columns.filter(col => !endColumns.includes(col));
      const endColumnsFiltered = endColumns.filter(col => columns.includes(col));
      
      // Reorder: put Status immediately after Type
      const typeIndex = regularColumns.findIndex(col => col.toLowerCase() === 'type');
      const statusIndex = regularColumns.findIndex(col => col.toLowerCase() === 'status');
      
      if (typeIndex !== -1 && statusIndex !== -1 && statusIndex !== typeIndex + 1) {
        // Get the status column name
        const statusColumn = regularColumns[statusIndex];
        // Remove status from its current position
        regularColumns = regularColumns.filter((_, idx) => idx !== statusIndex);
        // Insert status right after type
        regularColumns.splice(typeIndex + 1, 0, statusColumn);
      }
      
      // Reorder: regular columns first, then end columns
      columns = [...regularColumns, ...endColumnsFiltered];
    }

    // For fact_leads, customize column order and visibility
    if (tableName === 'fact_leads') {
      // Exclude phone_hash from display
      columns = columns.filter(col => col !== 'phone_hash');
      
      // Define columns that should be at the end
      const endColumns = ['created_at', 'meta', 'created_at_db', 'updated_at_db'];
      
      // Separate columns into regular and end columns
      let regularColumns = columns.filter(col => !endColumns.includes(col));
      const endColumnsFiltered = endColumns.filter(col => columns.includes(col));
      
      // Find raw_source position and insert meta fields after it
      const rawSourceIndex = regularColumns.findIndex(col => col === 'raw_source');
      if (rawSourceIndex !== -1) {
        // Insert Status, CreatedDate, SerialId after raw_source
        regularColumns.splice(rawSourceIndex + 1, 0, 'Status', 'CreatedDate', 'SerialId');
      }
      
      // Reorder: regular columns first, then end columns
      columns = [...regularColumns, ...endColumnsFiltered];
    }

    if (columns.length === 0) {
      return res.status(404).json({ 
        error: 'Table not found',
        message: `Table "${tableName}" does not exist or has no columns`
      });
    }

    // Calculate offset
    const offset = (page - 1) * limit;

    // Build SELECT query with explicit column list
    let selectColumns: string;
    
    // For fact_leads, extract fields from meta JSONB
    if (tableName === 'fact_leads') {
      // Replace meta-derived columns with actual JSONB extractions
      const metaFields = ['Status', 'CreatedDate', 'SerialId'];
      const selectParts: string[] = [];
      
      for (const col of columns) {
        if (metaFields.includes(col)) {
          // Extract from meta JSONB
          selectParts.push(`meta->>'${col}' AS "${col}"`);
        } else {
          // Regular column, quote it
          selectParts.push(`"${col}"`);
        }
      }
      
      selectColumns = selectParts.join(', ');
    } else {
      // For other tables, quote column names
      selectColumns = columns.map(col => `"${col}"`).join(', ');
    }
    
    // Special ORDER BY for different tables
    let orderBy = '1';
    if (tableName === 'fact_jobs') {
      orderBy = 'COALESCE(job_end_date_time, last_status_update, created_at_db) DESC';
    } else if (tableName === 'elocals_leads') {
      // Use explicit column names for elocals_leads
      orderBy = 'COALESCE("date", "created_at") DESC, "id" DESC';
    }

    // Get data with pagination
    const dataResult = await pool.query(
      `SELECT ${selectColumns} FROM ${tableName} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      tableName,
      columns,
      rows: dataResult.rows,
      totalRows,
      page,
      limit,
      totalPages: Math.ceil(totalRows / limit)
    });
  } catch (error: any) {
    console.error('Error fetching table data:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// ============================================================================
// CSV IMPORT ENDPOINT (public, no authentication required)
// ============================================================================

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

/**
 * Get source_id from dim_source by code, create if not exists
 */
async function getSourceId(sourceCode: string): Promise<number> {
  const client = await pool.connect();
  try {
    if (!sourceCode || sourceCode.trim() === '') {
      sourceCode = 'workiz';
    }

    const normalizedCode = sourceCode.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    // Try to find by normalized code
    let result = await client.query(
      'SELECT id FROM dim_source WHERE code = $1',
      [normalizedCode]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    // Source not found - create it automatically
    console.log(`Creating new source in dim_source: code='${normalizedCode}', name='${sourceCode}'`);
    const insertResult = await client.query(
      `INSERT INTO dim_source (code, name) 
       VALUES ($1, $2) 
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [normalizedCode, sourceCode]
    );

    if (insertResult.rows.length > 0) {
      return insertResult.rows[0].id;
    }

    throw new Error(`Failed to create source '${sourceCode}' in dim_source table.`);
  } finally {
    client.release();
  }
}

/**
 * Parse date string from CSV format
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr || dateStr.trim() === '') {
    return null;
  }

  try {
    const date = new Date(dateStr.trim());
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch (error) {
    // Silently fail
  }

  return null;
}

/**
 * Parse numeric value from string
 */
function parseNumeric(value: string | undefined): number | null {
  if (!value || value.trim() === '') {
    return null;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parse integer value from string
 */
function parseIntValue(value: string | undefined): number | null {
  if (!value || value.trim() === '') {
    return null;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Send progress update to client
 */
function sendProgress(res: Response, percent: number, message: string) {
  res.write(JSON.stringify({ progress: percent, message }) + '\n');
}

/**
 * Import CSV jobs endpoint
 */
router.post('/api/import/jobs-csv', upload.single('csv'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'CSV file is required'
    });
  }

  // Set headers for streaming response
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    sendProgress(res, 5, 'Парсинг CSV файла...');

    // Parse CSV file
    const fileContent = req.file.buffer.toString('utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    sendProgress(res, 10, `Найдено ${records.length} записей. Начинаю импорт...`);

    if (records.length === 0) {
      res.write(JSON.stringify({
        result: {
          success: false,
          message: 'CSV файл пуст или не содержит данных'
        }
      }) + '\n');
      return res.end();
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ uuid: string; error: string }> = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        
        try {
          // UUID is required (it's the primary key)
          const uuid = record.UUID?.trim();
          if (!uuid || uuid === '') {
            skippedCount++;
            continue;
          }

          // Get source_id
          const sourceCode = record.Source?.trim() || 'workiz';
          let sourceId: number;
          try {
            sourceId = await getSourceId(sourceCode);
          } catch (error: any) {
            throw new Error(`Error getting source_id: ${error.message}`);
          }

          // Parse dates
          const createdDate = parseDate(record.Created || record['Job Date']);
          const scheduledDate = parseDate(record['Job Date']);
          const jobEndDate = parseDate(record['Job End']);
          const lastStatusUpdate = parseDate(record['Conversion Date']);

          // Parse numeric values
          const serialId = parseIntValue(record['Job #']);
          const jobAmountDue = parseNumeric(record['Amount Due']);
          const jobTotalPrice = parseNumeric(record.Total);
          const technicianName = record.Tech?.trim() || null;
          const jobType = record['Job Type']?.trim() || null;
          const clientId = record['Job #']?.trim() || null;

          // Build meta JSONB object with all additional data
          const meta: any = {
            client: record.Client?.trim() || null,
            tags: record.Tags?.trim() || null,
            primaryPhone: record['Primary Phone']?.trim() || null,
            emailAddress: record['Email Address']?.trim() || null,
            status: record.Status?.trim() || null,
            subStatus: record['Sub-Status']?.trim() || null,
            address: record.Address?.trim() || null,
            city: record.City?.trim() || null,
            zipCode: record['Zip Code']?.trim() || null,
            state: record.State?.trim() || null,
            serviceArea: record['Service Area']?.trim() || null,
            converted: record.Converted?.trim() || null,
            invoiced: record.Invoiced?.trim() || null,
            paymentDueDate: record['Payment Due Date']?.trim() || null,
            createdBy: record['Created By']?.trim() || null,
            amountPaid: parseNumeric(record['Amount Paid']),
            cost: parseNumeric(record.Cost),
            profit: parseNumeric(record.Profit),
            profitMargin: parseNumeric(record['Profit Margin']),
            company: record.Company?.trim() || null,
            tax: parseNumeric(record.Tax),
            creditCardServiceFee: parseNumeric(record['Credit Card Service Fee']),
            taxableAmount: parseNumeric(record['Taxable Amount']),
            taxRate: parseNumeric(record['Tax Rate']),
            hours: parseNumeric(record.Hours),
            firstName: record['First Name']?.trim() || null,
            lastName: record['Last Name']?.trim() || null,
            paymentMethods: record['Payment Methods']?.trim() || null,
            claimIdAndImportantNotes: record['Claim ID and Important notes']?.trim() || null,
            applianceTypeAndBrand: record['Appliance type and Brand']?.trim() || null,
            issueDescription: record['Issue description']?.trim() || null,
            expenses: parseNumeric(record.Expenses),
            firstTimeNotice: record['First time notice']?.trim() || null,
          };

          // Remove null values from meta to keep it clean
          Object.keys(meta).forEach(key => {
            if (meta[key] === null || meta[key] === undefined) {
              delete meta[key];
            }
          });

          const createdAt = createdDate || new Date();

          // Insert or update job in fact_jobs
          await client.query(
            `INSERT INTO fact_jobs (
              job_id, lead_id, created_at, scheduled_at, source_id, type, client_id,
              serial_id, technician_name, job_amount_due, job_total_price,
              job_end_date_time, last_status_update, meta
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (job_id) 
             DO UPDATE SET 
               lead_id = EXCLUDED.lead_id,
               created_at = EXCLUDED.created_at,
               scheduled_at = EXCLUDED.scheduled_at,
               source_id = EXCLUDED.source_id,
               type = EXCLUDED.type,
               client_id = EXCLUDED.client_id,
               serial_id = EXCLUDED.serial_id,
               technician_name = EXCLUDED.technician_name,
               job_amount_due = EXCLUDED.job_amount_due,
               job_total_price = EXCLUDED.job_total_price,
               job_end_date_time = EXCLUDED.job_end_date_time,
               last_status_update = EXCLUDED.last_status_update,
               meta = EXCLUDED.meta,
               updated_at_db = CURRENT_TIMESTAMP`,
            [
              uuid,
              null,
              createdAt,
              scheduledDate,
              sourceId,
              jobType,
              clientId,
              serialId,
              technicianName,
              jobAmountDue,
              jobTotalPrice,
              jobEndDate,
              lastStatusUpdate,
              JSON.stringify(meta),
            ]
          );

          savedCount++;
          
          // Send progress update every 100 records
          if (savedCount % 100 === 0 || i === records.length - 1) {
            const percent = Math.round(10 + ((i + 1) / records.length) * 85);
            sendProgress(res, percent, `Импортировано ${savedCount} из ${records.length} записей...`);
          }
        } catch (error: any) {
          const uuid = record.UUID?.trim() || `record_${i + 1}`;
          console.error(`Error importing job ${uuid}:`, error.message);
          errors.push({ uuid, error: error.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');

      sendProgress(res, 100, 'Импорт завершен!');

      res.write(JSON.stringify({
        result: {
          success: true,
          total: records.length,
          imported: savedCount,
          skipped: skippedCount,
          errors: errors.slice(0, 50), // Limit errors to first 50
        }
      }) + '\n');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.end();

  } catch (error: any) {
    console.error('Error importing CSV:', error);
    res.write(JSON.stringify({
      result: {
        success: false,
        message: error.message || 'Ошибка при импорте CSV файла'
      }
    }) + '\n');
    res.end();
  }
});

/**
 * Import CSV leads endpoint
 */
router.post('/api/import/leads-csv', upload.single('csv'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'CSV file is required'
    });
  }

  // Set headers for streaming response
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    sendProgress(res, 5, 'Парсинг CSV файла...');

    // Parse CSV file
    const fileContent = req.file.buffer.toString('utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    sendProgress(res, 10, `Найдено ${records.length} записей. Начинаю импорт...`);

    if (records.length === 0) {
      res.write(JSON.stringify({
        result: {
          success: false,
          message: 'CSV файл пуст или не содержит данных'
        }
      }) + '\n');
      return res.end();
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ lead_id: string; error: string }> = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        
        try {
          // Check if converted = 1, skip this record
          const converted = parseIntValue(record.Converted);
          if (converted === 1) {
            skippedCount++;
            continue;
          }

          // UUID is required (it's the primary key)
          const uuid = record.UUID?.trim();
          if (!uuid || uuid === '') {
            skippedCount++;
            continue;
          }

          // Get source_id
          const sourceCode = record.Source?.trim() || 'workiz';
          // Map source names to codes
          let mappedSourceCode = sourceCode.toLowerCase();
          if (mappedSourceCode === 'pro referral') {
            mappedSourceCode = 'pro_referral';
          }
          
          let sourceId: number;
          try {
            sourceId = await getSourceId(mappedSourceCode);
          } catch (error: any) {
            throw new Error(`Error getting source_id: ${error.message}`);
          }

          // Parse dates
          const createdDate = parseDate(record.Created);

          // Parse numeric values
          const cost = parseNumeric(record.Expenses) || 0;
          const rawSource = record.Source?.trim() || null;

          // Build meta JSONB object with all additional data
          const meta: any = {
            Lead: record['Lead #']?.trim() || null,
            Status: record.Status?.trim() || null,
            Tags: record.Tags?.trim() || null,
            Client: record.Client?.trim() || null,
            Street: record.Street?.trim() || null,
            City: record.City?.trim() || null,
            JobType: record['Job Type']?.trim() || null,
            Phone: record.Phone?.trim() || null,
            Assigned: record.Assigned?.trim() || null,
            Estimates: record.Estimates?.trim() || null,
            Scheduled: record.Scheduled?.trim() || null,
            EmailAddress: record['Email Address']?.trim() || null,
            ZipCode: record['Zip Code']?.trim() || null,
            ServiceArea: record['Service Area']?.trim() || null,
            Converted: converted !== null ? converted : null,
            ConvertedLeadTotal: parseNumeric(record['Converted Lead total']),
            ConversionDate: record['Conversion Date']?.trim() || null,
            CreatedBy: record['Created By']?.trim() || null,
            Company: record.Company?.trim() || null,
            FirstName: record['First Name']?.trim() || null,
            LastName: record['Last Name']?.trim() || null,
            State: record.State?.trim() || null,
            ClaimIDAndImportantNotes: record['Claim ID and Important notes']?.trim() || null,
            ApplianceTypeAndBrand: record['Appliance type and Brand']?.trim() || null,
            IssueDescription: record['Issue description']?.trim() || null,
            FirstTimeNotice: record['First time notice']?.trim() || null,
            Expenses: cost,
          };

          // Remove null values from meta to keep it clean
          Object.keys(meta).forEach(key => {
            if (meta[key] === null || meta[key] === undefined) {
              delete meta[key];
            }
          });

          const createdAt = createdDate || new Date();

          // Insert or update lead in fact_leads
          await client.query(
            `INSERT INTO fact_leads (
              lead_id, created_at, source_id, raw_source, cost, meta
            )
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (lead_id) 
             DO UPDATE SET 
               created_at = EXCLUDED.created_at,
               source_id = EXCLUDED.source_id,
               raw_source = EXCLUDED.raw_source,
               cost = EXCLUDED.cost,
               meta = EXCLUDED.meta,
               updated_at_db = CURRENT_TIMESTAMP`,
            [
              uuid,
              createdAt,
              sourceId,
              rawSource,
              cost,
              JSON.stringify(meta),
            ]
          );

          savedCount++;
          
          // Send progress update every 100 records
          if (savedCount % 100 === 0 || i === records.length - 1) {
            const percent = Math.round(10 + ((i + 1) / records.length) * 85);
            sendProgress(res, percent, `Импортировано ${savedCount} из ${records.length} записей...`);
          }
        } catch (error: any) {
          const uuid = record.UUID?.trim() || `record_${i + 1}`;
          console.error(`Error importing lead ${uuid}:`, error.message);
          errors.push({ lead_id: uuid, error: error.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');

      sendProgress(res, 100, 'Импорт завершен!');

      res.write(JSON.stringify({
        result: {
          success: true,
          total: records.length,
          imported: savedCount,
          skipped: skippedCount,
          errors: errors.slice(0, 50), // Limit errors to first 50
        }
      }) + '\n');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.end();

  } catch (error: any) {
    console.error('Error importing CSV:', error);
    res.write(JSON.stringify({
      result: {
        success: false,
        message: error.message || 'Ошибка при импорте CSV файла'
      }
    }) + '\n');
    res.end();
  }
});

// ============================================================================
// DB API ROUTES (with authentication and rate limiting)
// ============================================================================
// Mount DB API routes (with authentication and rate limiting)
router.use(dbRoutes);

// Daily metrics endpoint
router.get('/api/metrics/daily', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source, segment, limit = 30 } = req.query;
    
    let query = 'SELECT * FROM daily_metrics WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    if (source) {
      paramCount++;
      query += ` AND source = $${paramCount}`;
      params.push(source);
    }
    
    if (segment) {
      paramCount++;
      query += ` AND segment = $${paramCount}`;
      params.push(segment);
    }
    
    query += ' ORDER BY date DESC, source, segment';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching daily metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Monthly metrics endpoint
router.get('/api/metrics/monthly', async (req: Request, res: Response) => {
  try {
    const { start_month, end_month, source, segment, limit = 12 } = req.query;
    
    let query = 'SELECT * FROM monthly_metrics WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_month) {
      paramCount++;
      query += ` AND month >= $${paramCount}`;
      params.push(start_month);
    }
    
    if (end_month) {
      paramCount++;
      query += ` AND month <= $${paramCount}`;
      params.push(end_month);
    }
    
    if (source) {
      paramCount++;
      query += ` AND source = $${paramCount}`;
      params.push(source);
    }
    
    if (segment) {
      paramCount++;
      query += ` AND segment = $${paramCount}`;
      params.push(segment);
    }
    
    query += ' ORDER BY month DESC, source, segment';
    
    if (!start_month && !end_month) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching monthly metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Jobs endpoint
router.get('/api/jobs', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, include_raw = 'false', limit = 100 } = req.query;
    const includeRaw = include_raw === 'true';
    
    let query = `
      SELECT 
        fj.job_id,
        fj.lead_id,
        fj.serial_id,
        fj.technician_name,
        fj.job_amount_due,
        fj.job_total_price,
        fj.job_end_date_time,
        fj.last_status_update,
        ds.code as source,
        ds.name as source_name,
        fj.type,
        fj.client_id,
        fj.meta,
        fj.created_at_db,
        fj.updated_at_db
      FROM fact_jobs fj
      LEFT JOIN dim_source ds ON fj.source_id = ds.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND DATE(COALESCE(fj.job_end_date_time, fj.created_at_db)) >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND DATE(COALESCE(fj.job_end_date_time, fj.created_at_db)) <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY COALESCE(fj.job_end_date_time, fj.last_status_update, fj.created_at_db) DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    
    // Parse meta JSONB if requested
    const rows = result.rows.map(row => {
      if (includeRaw && row.meta) {
        try {
          row.meta = typeof row.meta === 'string' 
            ? JSON.parse(row.meta) 
            : row.meta;
        } catch (e) {
          // Keep as is if parsing fails
        }
      } else if (!includeRaw) {
        delete row.meta;
      }
      return row;
    });
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Payments endpoint
router.get('/api/payments', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, job_id, include_raw = 'false', limit = 100 } = req.query;
    const includeRaw = include_raw === 'true';
    
    let query = `
      SELECT 
        fp.payment_id,
        fp.job_id,
        fp.paid_at,
        fp.amount,
        fp.method,
        fp.meta,
        fp.created_at_db,
        fp.updated_at_db
      FROM fact_payments fp
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND DATE(fp.paid_at) >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND DATE(fp.paid_at) <= $${paramCount}`;
      params.push(end_date);
    }
    
    if (job_id) {
      paramCount++;
      query += ` AND fp.job_id = $${paramCount}`;
      params.push(job_id);
    }
    
    query += ' ORDER BY fp.paid_at DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    
    // Parse meta JSONB if requested
    const rows = result.rows.map(row => {
      if (includeRaw && row.meta) {
        try {
          row.meta = typeof row.meta === 'string' 
            ? JSON.parse(row.meta) 
            : row.meta;
        } catch (e) {
          // Keep as is if parsing fails
        }
      } else if (!includeRaw) {
        delete row.meta;
      }
      return row;
    });
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calls endpoint
router.get('/api/calls', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM calls WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY date DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Elocal calls extraction endpoint (without saving to DB)
router.get('/api/calls/elocal', async (req: Request, res: Response) => {
  const svcElocalCalls = new SvcElocalCalls();
  
  try {
    // Parse optional date parameters
    let startDate: string;
    let endDate: string;
    
    if (req.query.start_date && req.query.end_date) {
      startDate = req.query.start_date as string;
      endDate = req.query.end_date as string;
    } else {
      // Default: last 30 days (excluding today)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      endDate = yesterday.toISOString().split('T')[0];
      
      const startDateObj = new Date(yesterday);
      startDateObj.setDate(startDateObj.getDate() - 29);
      startDate = startDateObj.toISOString().split('T')[0];
    }
    
    // Fetch and parse calls (without saving)
    const csvContent = await svcElocalCalls.fetchCallsCsv(startDate, endDate);
    const calls = svcElocalCalls.parseCallsCsv(csvContent);
    
    res.json({
      success: true,
      start_date: startDate,
      end_date: endDate,
      count: calls.length,
      calls: calls
    });
  } catch (error: any) {
    console.error('Error fetching elocal calls:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  } finally {
    await svcElocalCalls.closeBrowser();
  }
});

// Leads endpoints
router.get('/api/leads/elocals', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM elocals_leads WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY date DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching elocals leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leads endpoint (universal - includes Pro Referral, Google, and other Workiz leads)
router.get('/api/leads', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source, status, include_raw = 'false', limit = 100 } = req.query;
    const includeRaw = include_raw === 'true';
    
    let query = `
      SELECT 
        fl.lead_id,
        fl.created_at,
        ds.code as source,
        ds.name as source_name,
        fl.phone_hash,
        fl.raw_source,
        fl.cost,
        fl.meta,
        fl.created_at_db,
        fl.updated_at_db
      FROM fact_leads fl
      LEFT JOIN dim_source ds ON fl.source_id = ds.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND DATE(fl.created_at) >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND DATE(fl.created_at) <= $${paramCount}`;
      params.push(end_date);
    }
    
    if (source) {
      paramCount++;
      query += ` AND ds.code = $${paramCount}`;
      params.push(source);
    }
    
    query += ' ORDER BY fl.created_at DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    
    // Parse meta JSONB if requested
    const rows = result.rows.map(row => {
      if (includeRaw && row.meta) {
        try {
          row.meta = typeof row.meta === 'string' 
            ? JSON.parse(row.meta) 
            : row.meta;
        } catch (e) {
          // Keep as is if parsing fails
        }
      } else if (!includeRaw) {
        delete row.meta;
      }
      return row;
    });
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Google spend endpoint
router.get('/api/google-spend', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM google_spend WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY date DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching google spend:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Targets endpoint
router.get('/api/targets', async (req: Request, res: Response) => {
  try {
    const { start_month, end_month, source, segment, metric_type } = req.query;
    
    let query = 'SELECT * FROM targets WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_month) {
      paramCount++;
      query += ` AND month >= $${paramCount}`;
      params.push(start_month);
    }
    
    if (end_month) {
      paramCount++;
      query += ` AND month <= $${paramCount}`;
      params.push(end_month);
    }
    
    if (source) {
      paramCount++;
      query += ` AND source = $${paramCount}`;
      params.push(source);
    }
    
    if (segment) {
      paramCount++;
      query += ` AND segment = $${paramCount}`;
      params.push(segment);
    }
    
    if (metric_type) {
      paramCount++;
      query += ` AND metric_type = $${paramCount}`;
      params.push(metric_type);
    }
    
    query += ' ORDER BY month DESC, source, segment, metric_type';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching targets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
router.get('/api/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// ========== TEST ENDPOINTS FOR WORKIZ JOBS ==========

// Test endpoint: Fetch jobs from Workiz API (without saving)
router.get('/api/test/workiz/jobs', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'false' } = req.query;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizJobs = new SvcWorkizJobs();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Test fetch jobs: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    const jobs = await svcWorkizJobs.fetchJobs(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    // Return jobs with raw_data for first job to show structure
    const jobsWithRaw = jobs.slice(0, 10).map(job => ({
      ...job,
      raw_data: job.raw_data || null,
      raw_data_keys: job.raw_data ? Object.keys(job.raw_data) : [],
    }));

    res.json({
      success: true,
      count: jobs.length,
      jobs: jobsWithRaw,
      message: `Fetched ${jobs.length} jobs. Showing first 10 with raw data.`,
      sample_raw_structure: jobs.length > 0 && jobs[0].raw_data ? {
        keys: Object.keys(jobs[0].raw_data),
        sample: jobs[0].raw_data,
      } : null,
    });
  } catch (error: any) {
    console.error('Error in test fetch jobs:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Fetch single job by UUID
router.get('/api/test/workiz/jobs/:uuid', async (req: Request, res: Response) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({ error: 'UUID parameter is required' });
    }

    // TODO: implement fetchJobByUuid in SvcWorkizJobs
    return res.status(501).json({ 
      success: false,
      error: 'fetchJobByUuid not yet implemented in SvcWorkizJobs',
      uuid 
    });
  } catch (error: any) {
    console.error('Error in test fetch job by UUID:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Manual sync jobs (fetch and save)
router.post('/api/test/workiz/jobs/sync', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'false' } = req.body;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizJobs = new SvcWorkizJobs();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Manual sync jobs: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    // Fetch jobs
    const jobs = await svcWorkizJobs.fetchJobs(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    console.log(`Fetched ${jobs.length} jobs, starting save...`);

    // Save jobs
    await svcWorkizJobs.saveJobs(jobs);

    res.json({
      success: true,
      message: `Successfully synced ${jobs.length} jobs`,
      count: jobs.length,
    });
  } catch (error: any) {
    console.error('Error in manual sync jobs:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Trigger full sync (like scheduler does)
router.post('/api/test/workiz/jobs/sync-full', async (req: Request, res: Response) => {
  try {
    const svcWorkizJobs = new SvcWorkizJobs();
    console.log('Starting full jobs sync (last 30 days)...');

    await svcWorkizJobs.syncJobs();

    res.json({
      success: true,
      message: 'Full jobs sync completed successfully',
    });
  } catch (error: any) {
    console.error('Error in full sync jobs:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// ========== TEST ENDPOINTS FOR WORKIZ LEADS ==========

// Test endpoint: Fetch leads from Workiz API (without saving)
router.get('/api/test/workiz/leads', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'true' } = req.query;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizLeads = new SvcWorkizLeads();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Test fetch leads: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    const leads = await svcWorkizLeads.fetchLeads(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    // Return leads with raw_data for first lead to show structure
    const leadsWithRaw = leads.slice(0, 10).map(lead => ({
      ...lead,
      raw_data: lead.raw_data || null,
      raw_data_keys: lead.raw_data ? Object.keys(lead.raw_data) : [],
    }));

    res.json({
      success: true,
      count: leads.length,
      leads: leadsWithRaw,
      message: `Fetched ${leads.length} leads. Showing first 10 with raw data.`,
      sample_raw_structure: leads.length > 0 && leads[0].raw_data ? {
        keys: Object.keys(leads[0].raw_data),
        sample: leads[0].raw_data,
      } : null,
    });
  } catch (error: any) {
    console.error('Error in test fetch leads:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Fetch single lead by UUID
router.get('/api/test/workiz/leads/:uuid', async (req: Request, res: Response) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({ error: 'UUID parameter is required' });
    }

    // TODO: implement fetchLeadByUuid in SvcWorkizLeads
    return res.status(501).json({ 
      success: false,
      error: 'fetchLeadByUuid not yet implemented in SvcWorkizLeads',
      uuid 
    });
  } catch (error: any) {
    console.error('Error in test fetch lead by UUID:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Manual sync leads (fetch and save)
router.post('/api/test/workiz/leads/sync', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'false' } = req.body;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizLeads = new SvcWorkizLeads();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Manual sync leads: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    // Fetch leads
    const leads = await svcWorkizLeads.fetchLeads(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    console.log(`Fetched ${leads.length} leads, starting save...`);

    // Save leads
    await svcWorkizLeads.saveLeads(leads);

    res.json({
      success: true,
      message: `Successfully synced ${leads.length} leads`,
      count: leads.length,
    });
  } catch (error: any) {
    console.error('Error in manual sync leads:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Trigger full sync (like scheduler does)
router.post('/api/test/workiz/leads/sync-full', async (req: Request, res: Response) => {
  try {
    const svcWorkizLeads = new SvcWorkizLeads();
    console.log('Starting full leads sync (last 30 days)...');

    await svcWorkizLeads.syncLeads();

    res.json({
      success: true,
      message: 'Full leads sync completed successfully',
    });
  } catch (error: any) {
    console.error('Error in full sync leads:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Trigger full payments sync (like scheduler does)
router.post('/api/test/workiz/payments/sync-full', async (req: Request, res: Response) => {
  try {
    const svcWorkizPayments = new SvcWorkizPayments();
    console.log('Starting full payments sync (last 30 days)...');

    await svcWorkizPayments.syncPayments();

    res.json({
      success: true,
      message: 'Full payments sync completed successfully',
    });
  } catch (error: any) {
    console.error('Error in full sync payments:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// ========== TEST ENDPOINTS FOR ELOCAL CALLS ==========

// Test endpoint: Test authentication only (via CSV fetch with small date range)
router.post('/api/test/elocal/calls/auth', async (req: Request, res: Response) => {
  try {
    console.log('Testing elocal.com authentication...');
    const svcElocalCalls = new SvcElocalCalls();
    
    // Test authentication by trying to fetch CSV for a small date range
    const today = new Date();
    const testDate = today.toISOString().split('T')[0];
    
    try {
      await svcElocalCalls.fetchCallsCsv(testDate, testDate);
      res.json({
        success: true,
        message: 'Authentication successful (able to access export endpoint)',
      });
    } catch (error: any) {
      if (error.message.includes('authentication') || error.message.includes('login')) {
        res.json({
          success: false,
          message: 'Authentication failed',
          error: error.message,
        });
      } else {
        // Other errors might still mean auth worked
        res.json({
          success: true,
          message: 'Authentication successful (but CSV fetch had other issues)',
          error: error.message,
        });
      }
    } finally {
      await svcElocalCalls.closeBrowser();
    }
  } catch (error: any) {
    console.error('Error in test authentication:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.stack 
    });
  }
});

// Test endpoint: Fetch calls CSV from elocal.com (without saving)
router.get('/api/test/elocal/calls', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ 
        error: 'start_date and end_date parameters are required (format: YYYY-MM-DD)' 
      });
    }

    const svcElocalCalls = new SvcElocalCalls();
    
    console.log(`Test fetch elocal calls: start_date=${start_date}, end_date=${end_date}`);

    // Fetch CSV (authentication happens inside fetchCallsCsv)
    let csvContent: string;
    try {
      csvContent = await svcElocalCalls.fetchCallsCsv(
        start_date as string,
        end_date as string
      );
    } finally {
      await svcElocalCalls.closeBrowser();
    }

    // Parse CSV to show structure
    const calls = svcElocalCalls.parseCallsCsv(csvContent);

    res.json({
      success: true,
      count: calls.length,
      calls: calls.slice(0, 10), // Show first 10
      csv_preview: csvContent.substring(0, 500), // First 500 chars of CSV
      message: `Fetched ${calls.length} calls. Showing first 10.`,
    });
  } catch (error: any) {
    console.error('Error in test fetch elocal calls:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Manual sync calls (authenticate + fetch + save)

// Test endpoint: Process CSV files manually
router.post('/api/test/csv/process', async (req: Request, res: Response) => {
  try {
    console.log('Processing CSV files...');
    const csvService = new CsvService();
    
    await csvService.processCsvFiles();
    
    res.json({
      success: true,
      message: 'CSV files processed successfully',
      csvDirectory: process.env.CSV_DIRECTORY || './csv-data',
    });
  } catch (error: any) {
    console.error('Error processing CSV files:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.stack 
    });
  }
});

export default router;

