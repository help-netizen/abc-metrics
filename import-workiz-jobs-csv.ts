import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
// Import pool - when compiled to dist/, use ../db/connection
// When running from source, use ./src/db/connection  
let pool: any;
try {
  // Try compiled path first (when running from dist/)
  pool = require('../db/connection').default;
} catch {
  try {
    // Try source path (when running from root)
    pool = require('./src/db/connection').default;
  } catch {
    // Fallback: try absolute paths
    pool = require('./dist/db/connection').default;
  }
}

interface CsvJobRecord {
  'Job #': string;
  'Client': string;
  'Tags': string;
  'Job Type': string;
  'Job Date': string;
  'Job End': string;
  'Primary Phone': string;
  'Email Address': string;
  'Status': string;
  'Tech': string;
  'Address': string;
  'City': string;
  'Zip Code': string;
  'Service Area': string;
  'UUID': string;
  'Sub-Status': string;
  'Conversion Date': string;
  'Total': string;
  'Converted': string;
  'Invoiced': string;
  'Created': string;
  'Payment Due Date': string;
  'Created By': string;
  'Amount Due': string;
  'Amount Paid': string;
  'Cost': string;
  'Profit': string;
  'Profit Margin': string;
  'Company': string;
  'Tax': string;
  'Credit Card Service Fee': string;
  'Taxable Amount': string;
  'Tax Rate': string;
  'Hours': string;
  'Source': string;
  'First Name': string;
  'Last Name': string;
  'State': string;
  'Payment Methods': string;
  'Claim ID and Important notes': string;
  'Appliance type and Brand': string;
  'Issue description': string;
  'Expenses': string;
  'First time notice': string;
}

/**
 * Parse date string from CSV format (e.g., "Fri Dec 19 2025") to Date object
 * Handles various date formats from Workiz CSV export
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr || dateStr.trim() === '') {
    return null;
  }

  const trimmed = dateStr.trim();

  try {
    // Try parsing directly
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Try parsing formats like "Fri Dec 19 2025"
    // JavaScript Date can usually parse this, but let's be explicit
    const dateMatch = trimmed.match(/(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/);
    if (dateMatch) {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    // Try ISO format
    if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch (error) {
    // Silently fail - will return null
  }

  return null;
}

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
 * Import CSV jobs to fact_jobs table
 */
async function importCsvJobs(csvFilePath: string): Promise<void> {
  console.log(`\n=== Workiz Jobs CSV Import ===`);
  console.log(`CSV file: ${csvFilePath}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured (set DATABASE_URL)'}\n`);

  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`CSV file not found: ${csvFilePath}`);
  }

  // Read and parse CSV file
  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const records: CsvJobRecord[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  console.log(`Parsed ${records.length} records from CSV`);

  if (records.length === 0) {
    console.warn('No records found in CSV file');
    return;
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
          console.warn(`Skipping record ${i + 1}: missing UUID`);
          skippedCount++;
          continue;
        }

        // Get source_id
        const sourceCode = record.Source?.trim() || 'workiz';
        let sourceId: number;
        try {
          sourceId = await getSourceId(sourceCode);
        } catch (error: any) {
          console.error(`Error getting source_id for UUID ${uuid}, source='${sourceCode}':`, error.message);
          throw error;
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
        const clientId = record['Job #']?.trim() || null; // Using Job # as client_id if needed

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
            uuid,                    // job_id (UUID)
            null,                    // lead_id (not available in CSV)
            createdAt,               // created_at
            scheduledDate,           // scheduled_at
            sourceId,               // source_id
            jobType,                // type
            clientId,               // client_id
            serialId,               // serial_id
            technicianName,         // technician_name
            jobAmountDue,           // job_amount_due
            jobTotalPrice,          // job_total_price
            jobEndDate,             // job_end_date_time
            lastStatusUpdate,       // last_status_update
            JSON.stringify(meta),   // meta
          ]
        );

        savedCount++;
        
        if (savedCount % 100 === 0) {
          console.log(`Progress: ${savedCount}/${records.length} jobs imported...`);
        }
      } catch (error: any) {
        const uuid = record.UUID?.trim() || `record_${i + 1}`;
        console.error(`Error importing job ${uuid}:`, error.message);
        errors.push({ uuid, error: error.message });
        skippedCount++;
      }
    }

    await client.query('COMMIT');

    console.log('\n=== Import Summary ===');
    console.log(`Total records: ${records.length}`);
    console.log(`Successfully imported: ${savedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    
    if (errors.length > 0) {
      console.log(`\nErrors (first 10):`);
      errors.slice(0, 10).forEach(({ uuid, error }) => {
        console.log(`  - ${uuid}: ${error}`);
      });
      if (errors.length > 10) {
        console.log(`  ... and ${errors.length - 10} more errors`);
      }
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during import:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Main execution
async function main() {
  const csvFilePath = process.argv[2] || 'Import-2025-12-16T13_58_55.706Z.csv';

  // Resolve path relative to current working directory
  const resolvedPath = path.isAbsolute(csvFilePath) 
    ? csvFilePath 
    : path.join(process.cwd(), csvFilePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: CSV file not found: ${resolvedPath}`);
    console.error('\nUsage:');
    console.error('  npm run import-jobs-csv <path-to-csv-file>');
    console.error('  or');
    console.error('  ts-node import-workiz-jobs-csv.ts <path-to-csv-file>');
    console.error('\nExample:');
    console.error('  npm run import-jobs-csv Import-2025-12-16T13_58_55.706Z.csv');
    process.exit(1);
  }

  try {
    await importCsvJobs(resolvedPath);
    console.log('\nImport completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\nImport failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { importCsvJobs };

