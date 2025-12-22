import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { dbAuthMiddleware } from '../middleware/db-auth.middleware';
import { dbRateLimitMiddleware } from '../middleware/db-rate-limit.middleware';
import { SvcWorkizJobs } from '../services/svc-workiz-jobs';
import { SvcWorkizLeads } from '../services/svc-workiz-leads';
import { SvcWorkizPayments } from '../services/svc-workiz-payments';
import { AggregationService } from '../services/aggregation.service';
import { NormalizationService } from '../services/normalization.service';

const router = Router();

// Apply authentication and rate limiting to all routes
router.use(dbAuthMiddleware);
router.use(dbRateLimitMiddleware);

// ============================================================================
// READ ENDPOINTS
// ============================================================================

/**
 * GET /api/db/jobs - Read jobs with filtering
 */
router.get('/api/db/jobs', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source, limit = 100, offset = 0 } = req.query;

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

    if (source) {
      paramCount++;
      query += ` AND ds.code = $${paramCount}`;
      params.push(source);
    }

    query += ' ORDER BY COALESCE(fj.job_end_date_time, fj.last_status_update, fj.created_at_db) DESC';

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit as string, 10));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset as string, 10));

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/db/payments - Read payments with filtering
 */
router.get('/api/db/payments', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, job_id, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        fp.payment_id,
        fp.job_id,
        fp.paid_at,
        fp.amount,
        fp.method,
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

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit as string, 10));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset as string, 10));

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching payments:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/db/calls - Deprecated endpoint
 */
router.get('/api/db/calls', async (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'This endpoint is deprecated. Use /api/db/elocals_leads instead.',
  });
});

/**
 * GET /api/db/leads - Read leads with filtering
 */
router.get('/api/db/leads', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        fl.lead_id,
        fl.created_at,
        ds.code as source,
        ds.name as source_name,
        fl.phone_hash,
        fl.cost,
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

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit as string, 10));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset as string, 10));

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching leads:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/db/elocals_leads - Read elocals leads with filtering
 */
router.get('/api/db/elocals_leads', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, limit = 100, offset = 0 } = req.query;

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

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit as string, 10));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset as string, 10));

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching elocals leads:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/db/metrics/daily - Read daily metrics
 */
router.get('/api/db/metrics/daily', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source, segment, limit = 100, offset = 0 } = req.query;

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

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit as string, 10));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset as string, 10));

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching daily metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/db/metrics/monthly - Read monthly metrics
 */
router.get('/api/db/metrics/monthly', async (req: Request, res: Response) => {
  try {
    const { start_month, end_month, source, segment, limit = 100, offset = 0 } = req.query;

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

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit as string, 10));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset as string, 10));

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching monthly metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/db/tables - List all tables
 */
router.get('/api/db/tables', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    res.json({
      success: true,
      count: result.rows.length,
      tables: result.rows.map(row => row.table_name),
    });
  } catch (error: any) {
    console.error('Error fetching tables:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/db/table/:name - Read table data with pagination
 */
router.get('/api/db/table/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    // Validate table name to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid table name',
      });
    }

    const query = `SELECT * FROM ${name} ORDER BY 1 DESC LIMIT $1 OFFSET $2`;
    const result = await pool.query(query, [parseInt(limit as string, 10), parseInt(offset as string, 10)]);

    res.json({
      success: true,
      table: name,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error(`Error fetching table ${req.params.name}:`, error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================================
// WRITE ENDPOINTS
// ============================================================================

/**
 * POST /api/db/jobs - Create/update jobs (UPSERT)
 */
router.post('/api/db/jobs', async (req: Request, res: Response) => {
  try {
    const jobs = Array.isArray(req.body) ? req.body : [req.body];

    if (!jobs || jobs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No jobs provided',
      });
    }

    const svcWorkizJobs = new SvcWorkizJobs();

    // Convert API format to WorkizJob format
    const workizJobs = jobs.map((job: any) => ({
      id: job.job_id || job.id,
      date: job.date || job.created_at || new Date().toISOString().split('T')[0],
      type: job.type,
      source: job.source || 'workiz',
      unit: job.unit,
      repair_type: job.repair_type,
      cost: job.cost,
      revenue: job.revenue || job.amount,
      status: job.status,
      raw_data: job.raw_data || job.meta,
    }));

    await svcWorkizJobs.saveJobs(workizJobs);

    res.json({
      success: true,
      count: jobs.length,
      message: `Successfully saved ${jobs.length} job(s)`,
    });
  } catch (error: any) {
    console.error('Error saving jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/db/leads - Create/update leads (UPSERT)
 */
router.post('/api/db/leads', async (req: Request, res: Response) => {
  try {
    const leads = Array.isArray(req.body) ? req.body : [req.body];

    if (!leads || leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No leads provided',
      });
    }

    const svcWorkizLeads = new SvcWorkizLeads();

    // Convert API format to WorkizLead format
    const workizLeads = leads.map((lead: any) => ({
      id: lead.lead_id || lead.id,
      source: lead.source || 'workiz',
      status: lead.status,
      created_at: lead.created_at || new Date().toISOString(),
      updated_at: lead.updated_at || lead.created_at || new Date().toISOString(),
      job_id: lead.job_id,
      client_phone: lead.client_phone || lead.phone,
      client_name: lead.client_name || lead.name,
      raw_data: lead.raw_data || lead.meta,
    }));

    await svcWorkizLeads.saveLeads(workizLeads);

    res.json({
      success: true,
      count: leads.length,
      message: `Successfully saved ${leads.length} lead(s)`,
    });
  } catch (error: any) {
    console.error('Error saving leads:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/db/payments - Create/update payments (UPSERT)
 */
router.post('/api/db/payments', async (req: Request, res: Response) => {
  try {
    const payments = Array.isArray(req.body) ? req.body : [req.body];

    if (!payments || payments.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No payments provided',
      });
    }

    const svcWorkizPayments = new SvcWorkizPayments();

    // Convert API format to WorkizPayment format
    const workizPayments = payments.map((payment: any) => ({
      id: payment.payment_id || payment.id,
      job_id: payment.job_id,
      date: payment.date || payment.paid_at || new Date().toISOString().split('T')[0],
      amount: payment.amount,
      method: payment.method,
      raw_data: payment.raw_data || payment.meta,
    }));

    await svcWorkizPayments.savePayments(workizPayments);

    res.json({
      success: true,
      count: payments.length,
      message: `Successfully saved ${payments.length} payment(s)`,
    });
  } catch (error: any) {
    console.error('Error saving payments:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/db/calls - Deprecated endpoint
 */
router.post('/api/db/calls', async (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'This endpoint is deprecated. Use /api/db/elocals_leads instead.',
  });
});

/**
 * POST /api/db/elocals_leads - Create/update elocals leads (UPSERT)
 */
router.post('/api/db/elocals_leads', async (req: Request, res: Response) => {
  try {
    const leads = Array.isArray(req.body) ? req.body : [req.body];

    if (!leads || leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No leads provided',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let savedCount = 0;
      const errors: Array<{ lead_id: string; error: string }> = [];

      for (const lead of leads) {
        try {
          // Маппинг полей из CSV
          const leadId = lead['Unique ID'] || lead.unique_id || lead.lead_id || lead.id;
          if (!leadId) {
            console.warn('Skipping lead without ID:', JSON.stringify(lead));
            continue;
          }

          // Парсинг даты из поля Time
          let leadDate: Date | null = null;
          let leadTime: Date | null = null;

          if (lead['Time'] || lead.time) {
            const timeStr = lead['Time'] || lead.time;
            leadTime = new Date(timeStr);
            if (isNaN(leadTime.getTime())) {
              leadTime = null;
            } else {
              // Используем время для даты, если дата не указана отдельно
              leadDate = leadTime;
            }
          }

          // Если дата не распарсилась, используем date или текущую дату
          if (!leadDate && lead.date) {
            leadDate = new Date(lead.date);
            if (isNaN(leadDate.getTime())) {
              leadDate = new Date();
            }
          }
          if (!leadDate) {
            leadDate = new Date();
          }

          // Создаем raw_data JSONB со всеми полями
          const rawData: any = { ...lead };

          // Нормализация данных
          const normalizedDate = NormalizationService.date(leadDate);
          const normalizedTime = NormalizationService.dateTime(leadTime);
          const normalizedForwarding = NormalizationService.phone(lead['Forwarding Number'] || lead.forwarding_number);
          const normalizedCallerId = NormalizationService.phone(lead['Caller ID'] || lead.caller_id);
          const normalizedServiceZip = NormalizationService.zip(lead['Service Zip Code'] || lead.service_zip);
          const normalizedContactPhone = NormalizationService.phone(lead['Contact Phone Number'] || lead.contact_phone);
          const normalizedContactCell = NormalizationService.phone(lead['Contact Cell Phone Number'] || lead.contact_cell_phone);
          const normalizedContactZip = NormalizationService.zip(lead['Contact Zip Code'] || lead.contact_zip);

          // Подготовка данных для вставки
          const insertData = [
            leadId, // lead_id
            normalizedDate, // date
            lead['Duration'] ? parseInt(String(lead['Duration']), 10) : (lead.duration ? parseInt(String(lead.duration), 10) : null), // duration
            lead['Cost'] ? parseFloat(String(lead['Cost'])) : (lead.cost ? parseFloat(String(lead.cost)) : 0), // cost
            lead['Status'] || lead.status || null, // status
            lead['Lead Type'] || lead.lead_type || lead.type || null, // lead_type
            lead['Current Status'] || lead.current_status || lead.status || null, // current_status
            lead['Unique ID'] || lead.unique_id || null, // unique_id
            normalizedTime, // time (TIMESTAMPTZ)
            normalizedForwarding, // forwarding_number
            normalizedCallerId, // caller_id
            lead['Caller Name'] || lead.caller_name || null, // caller_name
            lead['Profile'] || lead.profile || null, // profile
            lead['Service City'] || lead.service_city || null, // service_city
            lead['Service State Abbr'] || lead.service_state || null, // service_state
            normalizedServiceZip, // service_zip
            lead['Recording URL'] || lead.recording_url || null, // recording_url
            lead['Profile Name'] || lead.profile_name || null, // profile_name
            lead['Dispositions'] || lead.dispositions || null, // dispositions
            lead['Dollar Value'] ? parseFloat(String(lead['Dollar Value'])) : (lead.dollar_value ? parseFloat(String(lead.dollar_value)) : null), // dollar_value
            lead['Notes'] || lead.notes || null, // notes
            lead['Contact First Name'] || lead.contact_first_name || null, // contact_first_name
            lead['Contact Last Name'] || lead.contact_last_name || null, // contact_last_name
            normalizedContactPhone, // contact_phone
            lead['Contact Extension'] || lead.contact_extension || null, // contact_extension
            normalizedContactCell, // contact_cell_phone
            lead['Contact Email'] || lead.contact_email || null, // contact_email
            lead['Contact Address'] || lead.contact_address || null, // contact_address
            lead['Contact City'] || lead.contact_city || null, // contact_city
            lead['Contact State'] || lead.contact_state || null, // contact_state
            normalizedContactZip, // contact_zip
            rawData, // raw_data (JSONB - передаем объект напрямую)
          ];

          await client.query(
            `INSERT INTO elocals_leads (
              lead_id, date, duration, cost, status, lead_type, current_status,
              unique_id, time, forwarding_number, caller_id, caller_name, profile,
              service_city, service_state, service_zip, recording_url, profile_name,
              dispositions, dollar_value, notes,
              contact_first_name, contact_last_name, contact_phone, contact_extension,
              contact_cell_phone, contact_email, contact_address, contact_city,
              contact_state, contact_zip, raw_data
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
             ON CONFLICT (lead_id) 
             DO UPDATE SET 
               date = EXCLUDED.date,
               duration = EXCLUDED.duration,
               cost = EXCLUDED.cost,
               status = EXCLUDED.status,
               lead_type = EXCLUDED.lead_type,
               current_status = EXCLUDED.current_status,
               unique_id = EXCLUDED.unique_id,
               time = EXCLUDED.time,
               forwarding_number = EXCLUDED.forwarding_number,
               caller_id = EXCLUDED.caller_id,
               caller_name = EXCLUDED.caller_name,
               profile = EXCLUDED.profile,
               service_city = EXCLUDED.service_city,
               service_state = EXCLUDED.service_state,
               service_zip = EXCLUDED.service_zip,
               recording_url = EXCLUDED.recording_url,
               profile_name = EXCLUDED.profile_name,
               dispositions = EXCLUDED.dispositions,
               dollar_value = EXCLUDED.dollar_value,
               notes = EXCLUDED.notes,
               contact_first_name = EXCLUDED.contact_first_name,
               contact_last_name = EXCLUDED.contact_last_name,
               contact_phone = EXCLUDED.contact_phone,
               contact_extension = EXCLUDED.contact_extension,
               contact_cell_phone = EXCLUDED.contact_cell_phone,
               contact_email = EXCLUDED.contact_email,
               contact_address = EXCLUDED.contact_address,
               contact_city = EXCLUDED.contact_city,
               contact_state = EXCLUDED.contact_state,
               contact_zip = EXCLUDED.contact_zip,
               raw_data = EXCLUDED.raw_data,
               updated_at = CURRENT_TIMESTAMP`,
            insertData
          );

          savedCount++;
        } catch (error: any) {
          errors.push({ lead_id: lead['Unique ID'] || lead.unique_id || lead.lead_id || lead.id || 'unknown', error: error.message });
          console.error(`Error saving elocals lead ${lead['Unique ID'] || lead.unique_id || lead.lead_id || lead.id}:`, error);
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        count: savedCount,
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully saved ${savedCount} lead(s)${errors.length > 0 ? `, ${errors.length} error(s)` : ''}`,
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error saving elocals leads:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/db/servicedirect_leads - Save Service Direct leads
 */
router.post('/api/db/servicedirect_leads', async (req: Request, res: Response) => {
  try {
    const leads = Array.isArray(req.body) ? req.body : [req.body];

    if (!leads || leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No leads provided',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let savedCount = 0;
      const errors: Array<{ lead_id: string; error: string }> = [];

      for (const lead of leads) {
        try {
          // Получаем lead_id (поддерживаем оба формата: с пробелами и snake_case)
          const leadId = lead['Lead Id'] || lead.lead_id;
          if (!leadId) {
            errors.push({ lead_id: 'unknown', error: 'missing Lead Id' });
            continue;
          }

          // Парсинг даты из поля Date (формат: "2025-12-17 14:21:00 -0500" или ISO)
          let leadDate: Date | null = null;
          let leadTime: Date | null = null;

          const dateStr = lead['Date'] || lead.date;
          if (dateStr) {
            try {
              let dateToParse: string = String(dateStr).trim();

              // Пробуем распарсить дату с таймзоной
              // Формат: "2025-12-17 14:21:00 -0500" или "2025-12-17 14:21:00 +0500"
              if (dateToParse.includes(' -') || dateToParse.includes(' +')) {
                // Заменяем пробел перед таймзоной на 'T' для ISO формата
                // "2025-12-17 14:21:00 -0500" -> "2025-12-17T14:21:00-0500"
                dateToParse = dateToParse.replace(/\s+(-|\+)/, 'T$1');
              } else if (dateToParse.includes(' ') && !dateToParse.includes('T')) {
                // Если есть пробел, но нет T, добавляем T для ISO формата
                // "2025-12-17 14:21:00" -> "2025-12-17T14:21:00"
                dateToParse = dateToParse.replace(' ', 'T');
              }

              leadTime = new Date(dateToParse);

              if (!isNaN(leadTime.getTime())) {
                leadDate = leadTime;
              } else {
                leadTime = null;
              }
            } catch (e) {
              // Игнорируем ошибки парсинга
              console.warn(`Failed to parse date: ${dateStr}`, e);
            }
          }

          // Если дата не распарсилась, используем текущую дату
          if (!leadDate) {
            leadDate = new Date();
            leadTime = leadDate;
          }

          // Создаем raw_data JSONB со всеми полями
          const rawData: any = { ...lead };

          // Функция для получения значения (поддерживает оба формата)
          const getValue = (csvField: string, dbField: string): any => {
            return lead[csvField] !== undefined ? lead[csvField] : (lead[dbField] !== undefined ? lead[dbField] : null);
          };

          // Парсинг числовых значений
          const parseNumeric = (value: any): number | null => {
            if (value === null || value === undefined || value === '') return null;
            const parsed = parseFloat(String(value));
            return isNaN(parsed) ? null : parsed;
          };

          // Нормализация данных
          const normalizedDate = NormalizationService.date(leadDate);
          const normalizedTime = NormalizationService.dateTime(leadTime);
          const normalizedPhone = NormalizationService.phone(getValue('Lead Phone', 'lead_phone'));
          const normalizedZip = NormalizationService.zip(getValue('Zip Code', 'zip_code'));

          // Подготовка данных для вставки
          const insertData = [
            leadId, // lead_id
            normalizedDate, // date
            normalizedTime, // time
            getValue('Campaign', 'campaign'), // campaign
            getValue('Lead Name', 'lead_name'), // lead_name
            normalizedPhone, // lead_phone
            getValue('Call Duration', 'call_duration'), // call_duration
            getValue('Lead Email', 'lead_email'), // lead_email
            getValue('Form Submission', 'form_submission'), // form_submission
            getValue('Service Category', 'service_category'), // service_category
            getValue('Campaign Type', 'campaign_type'), // campaign_type
            getValue('Billable', 'billable'), // billable
            getValue('Lead Status', 'lead_status'), // lead_status
            getValue('Job Status', 'job_status'), // job_status
            getValue('Need Follow-Up', 'need_follow_up'), // need_follow_up
            getValue('Call Answered', 'call_answered'), // call_answered
            getValue('Booked Appointment', 'booked_appointment'), // booked_appointment
            getValue('Lost Reasons', 'lost_reasons'), // lost_reasons
            getValue('Under Review', 'under_review'), // under_review
            parseNumeric(getValue('Revenue', 'revenue')), // revenue
            parseNumeric(getValue('Cost', 'cost')), // cost
            getValue('Address', 'address'), // address
            getValue('Unit', 'unit'), // unit
            getValue('City', 'city'), // city
            getValue('State', 'state'), // state
            normalizedZip, // zip_code
            rawData, // raw_data (JSONB)
          ];

          await client.query(
            `INSERT INTO servicedirect_leads (
              lead_id, date, time, campaign, lead_name, lead_phone, call_duration,
              lead_email, form_submission, service_category, campaign_type, billable,
              lead_status, job_status, need_follow_up, call_answered, booked_appointment,
              lost_reasons, under_review, revenue, cost, address, unit, city, state, zip_code, raw_data
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
             ON CONFLICT (lead_id) 
             DO UPDATE SET 
               date = EXCLUDED.date,
               time = EXCLUDED.time,
               campaign = EXCLUDED.campaign,
               lead_name = EXCLUDED.lead_name,
               lead_phone = EXCLUDED.lead_phone,
               call_duration = EXCLUDED.call_duration,
               lead_email = EXCLUDED.lead_email,
               form_submission = EXCLUDED.form_submission,
               service_category = EXCLUDED.service_category,
               campaign_type = EXCLUDED.campaign_type,
               billable = EXCLUDED.billable,
               lead_status = EXCLUDED.lead_status,
               job_status = EXCLUDED.job_status,
               need_follow_up = EXCLUDED.need_follow_up,
               call_answered = EXCLUDED.call_answered,
               booked_appointment = EXCLUDED.booked_appointment,
               lost_reasons = EXCLUDED.lost_reasons,
               under_review = EXCLUDED.under_review,
               revenue = EXCLUDED.revenue,
               cost = EXCLUDED.cost,
               address = EXCLUDED.address,
               unit = EXCLUDED.unit,
               city = EXCLUDED.city,
               state = EXCLUDED.state,
               zip_code = EXCLUDED.zip_code,
               raw_data = EXCLUDED.raw_data,
               updated_at = CURRENT_TIMESTAMP`,
            insertData
          );

          savedCount++;
        } catch (error: any) {
          const leadId = lead['Lead Id'] || lead.lead_id || 'unknown';
          errors.push({ lead_id: String(leadId), error: error.message });
          console.error(`Error saving Service Direct lead ${leadId}:`, error);
        }
      }

      await client.query('COMMIT');

      const message = errors.length > 0
        ? `Successfully saved ${savedCount} Service Direct lead(s), ${errors.length} error(s)`
        : `Successfully saved ${savedCount} Service Direct lead(s)`;

      res.json({
        success: true,
        count: savedCount,
        errors: errors.length > 0 ? errors : undefined,
        message,
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error saving Service Direct leads:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/db/batch - Batch write (transactional)
 */
router.post('/api/db/batch', async (req: Request, res: Response) => {
  try {
    const { jobs, leads, payments, calls } = req.body;

    if (!jobs && !leads && !payments && !calls) {
      return res.status(400).json({
        success: false,
        error: 'No data provided. Expected: jobs, leads, payments, or calls',
      });
    }

    const results: any = {
      jobs: { count: 0, errors: [] },
      leads: { count: 0, errors: [] },
      payments: { count: 0, errors: [] },
      calls: { count: 0, errors: [] },
    };

    // Save jobs
    if (jobs && Array.isArray(jobs) && jobs.length > 0) {
      try {
        const svcWorkizJobs = new SvcWorkizJobs();
        const workizJobs = jobs.map((job: any) => ({
          id: job.job_id || job.id,
          date: job.date || job.created_at || new Date().toISOString().split('T')[0],
          type: job.type,
          source: job.source || 'workiz',
          unit: job.unit,
          repair_type: job.repair_type,
          cost: job.cost,
          revenue: job.revenue || job.amount,
          status: job.status,
          raw_data: job.raw_data || job.meta,
        }));
        await svcWorkizJobs.saveJobs(workizJobs);
        results.jobs.count = jobs.length;
      } catch (error: any) {
        results.jobs.errors.push(error.message);
      }
    }

    // Save leads
    if (leads && Array.isArray(leads) && leads.length > 0) {
      try {
        const svcWorkizLeads = new SvcWorkizLeads();
        const workizLeads = leads.map((lead: any) => ({
          id: lead.lead_id || lead.id,
          source: lead.source || 'workiz',
          status: lead.status,
          created_at: lead.created_at || new Date().toISOString(),
          updated_at: lead.updated_at || lead.created_at || new Date().toISOString(),
          job_id: lead.job_id,
          client_phone: lead.client_phone || lead.phone,
          client_name: lead.client_name || lead.name,
          raw_data: lead.raw_data || lead.meta,
        }));
        await svcWorkizLeads.saveLeads(workizLeads);
        results.leads.count = leads.length;
      } catch (error: any) {
        results.leads.errors.push(error.message);
      }
    }

    // Save payments
    if (payments && Array.isArray(payments) && payments.length > 0) {
      try {
        const svcWorkizPayments = new SvcWorkizPayments();
        const workizPayments = payments.map((payment: any) => ({
          id: payment.payment_id || payment.id,
          job_id: payment.job_id,
          date: payment.date || payment.paid_at || new Date().toISOString().split('T')[0],
          amount: payment.amount,
          method: payment.method,
          raw_data: payment.raw_data || payment.meta,
        }));
        await svcWorkizPayments.savePayments(workizPayments);
        results.payments.count = payments.length;
      } catch (error: any) {
        results.payments.errors.push(error.message);
      }
    }

    // Save calls
    if (calls && Array.isArray(calls) && calls.length > 0) {
      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          for (const call of calls) {
            const callId = call.call_id || call.id;
            if (!callId) continue;

            await client.query(
              `INSERT INTO calls (call_id, date, duration, call_type, source)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (call_id) 
               DO UPDATE SET 
                 date = EXCLUDED.date,
                 duration = EXCLUDED.duration,
                 call_type = EXCLUDED.call_type,
                 source = EXCLUDED.source,
                 updated_at = CURRENT_TIMESTAMP`,
              [
                callId,
                NormalizationService.date(call.date),
                call.duration ? parseInt(String(call.duration), 10) : null,
                call.call_type || call.type,
                call.source || 'elocals',
              ]
            );
          }

          await client.query('COMMIT');
          results.calls.count = calls.length;
        } catch (error: any) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error: any) {
        results.calls.errors.push(error.message);
      }
    }

    const totalCount = results.jobs.count + results.leads.count + results.payments.count + results.calls.count;
    const hasErrors = results.jobs.errors.length > 0 || results.leads.errors.length > 0 ||
      results.payments.errors.length > 0 || results.calls.errors.length > 0;

    res.json({
      success: !hasErrors,
      total_count: totalCount,
      results,
      message: `Batch operation completed: ${totalCount} record(s) saved`,
    });
  } catch (error: any) {
    console.error('Error in batch operation:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/db/aggregate/daily - Trigger daily aggregation
 */
router.post('/api/db/aggregate/daily', async (req: Request, res: Response) => {
  try {
    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setDate(targetDate.getDate() - 1); // Default to yesterday

    const aggregationService = new AggregationService();
    await aggregationService.aggregateDailyMetrics(targetDate);

    res.json({
      success: true,
      date: targetDate.toISOString().split('T')[0],
      message: 'Daily aggregation completed',
    });
  } catch (error: any) {
    console.error('Error aggregating daily metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/db/aggregate/monthly - Trigger monthly aggregation
 */
router.post('/api/db/aggregate/monthly', async (req: Request, res: Response) => {
  try {
    const { month } = req.body;
    let targetMonth: Date;

    if (month) {
      targetMonth = new Date(month);
    } else {
      // Default to last month
      targetMonth = new Date();
      targetMonth.setMonth(targetMonth.getMonth() - 1);
    }

    // Use first day of the month
    const monthDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);

    const aggregationService = new AggregationService();
    await aggregationService.aggregateMonthlyMetrics(monthDate);

    res.json({
      success: true,
      month: monthDate.toISOString().split('T')[0],
      message: 'Monthly aggregation completed',
    });
  } catch (error: any) {
    console.error('Error aggregating monthly metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;


