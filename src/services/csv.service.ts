import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import pool from '../db/connection';

export class CsvService {
  private csvDirectory: string;

  constructor() {
    this.csvDirectory = process.env.CSV_DIRECTORY || './csv-data';
  }

  async loadCsvFile(filePath: string): Promise<any[]> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
      });
      return records;
    } catch (error) {
      console.error(`Error loading CSV file ${filePath}:`, error);
      return [];
    }
  }

  async processCsvFiles(): Promise<void> {
    try {
      if (!fs.existsSync(this.csvDirectory)) {
        console.log(`CSV directory ${this.csvDirectory} does not exist`);
        return;
      }

      const files = fs.readdirSync(this.csvDirectory);
      const csvFiles = files.filter(file => file.endsWith('.csv'));

      for (const file of csvFiles) {
        const filePath = path.join(this.csvDirectory, file);
        await this.processCsvFile(filePath, file);
      }
    } catch (error) {
      console.error('Error processing CSV files:', error);
    }
  }

  async processCsvFile(filePath: string, fileName: string): Promise<void> {
    const records = await this.loadCsvFile(filePath);
    
    if (records.length === 0) {
      return;
    }

    // Determine table based on filename
    const tableName = this.getTableNameFromFileName(fileName);
    
    if (!tableName) {
      console.log(`Unknown CSV file type: ${fileName}`);
      return;
    }

    await this.saveRecords(records, tableName, fileName);
  }

  private getTableNameFromFileName(fileName: string): string | null {
    const lowerName = fileName.toLowerCase();
    
    if (lowerName.includes('job') || lowerName.includes('work')) {
      return 'jobs';
    } else if (lowerName.includes('payment')) {
      return 'payments';
    } else if (lowerName.includes('call')) {
      return 'calls';
    } else if (lowerName.includes('elocal')) {
      return 'elocals_leads';
    } else if (lowerName.includes('google') || lowerName.includes('spend')) {
      return 'google_spend';
    }
    
    return null;
  }

  private async saveRecords(records: any[], tableName: string, source: string): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      for (const record of records) {
        await this.insertRecord(client, record, tableName, source);
      }

      await client.query('COMMIT');
      console.log(`Saved ${records.length} records to ${tableName} from ${source}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Error saving records to ${tableName}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertRecord(client: any, record: any, tableName: string, source: string): Promise<void> {
    try {
      switch (tableName) {
        case 'jobs':
          const jobType = record.type || record.job_type || null;
          const jobSegment = jobType?.includes('COD') ? 'COD' 
            : jobType?.includes('INS') ? 'INS' 
            : 'OTHER';
          
          await client.query(
            `INSERT INTO jobs (job_id, date, type, source, segment, unit, repair_type, cost, revenue, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (job_id) 
             DO UPDATE SET 
               date = EXCLUDED.date,
               type = EXCLUDED.type,
               source = EXCLUDED.source,
               segment = EXCLUDED.segment,
               unit = EXCLUDED.unit,
               repair_type = EXCLUDED.repair_type,
               cost = EXCLUDED.cost,
               revenue = EXCLUDED.revenue,
               status = EXCLUDED.status,
               updated_at = CURRENT_TIMESTAMP`,
            [
              record.job_id || record.id,
              record.date,
              jobType,
              record.source || source,
              jobSegment,
              record.unit,
              record.repair_type,
              record.cost ? parseFloat(record.cost) : null,
              record.revenue ? parseFloat(record.revenue) : null,
              record.status,
            ]
          );
          break;

        case 'payments':
          await client.query(
            `INSERT INTO payments (payment_id, job_id, date, amount, payment_type, source)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (payment_id) 
             DO UPDATE SET 
               job_id = EXCLUDED.job_id,
               date = EXCLUDED.date,
               amount = EXCLUDED.amount,
               payment_type = EXCLUDED.payment_type,
               updated_at = CURRENT_TIMESTAMP`,
            [
              record.payment_id || record.id,
              record.job_id,
              record.date,
              parseFloat(record.amount),
              record.payment_type || record.type,
              source,
            ]
          );
          break;

        case 'calls':
          await client.query(
            `INSERT INTO calls (call_id, date, duration, call_type, source)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (call_id) 
             DO UPDATE SET 
               date = EXCLUDED.date,
               duration = EXCLUDED.duration,
               call_type = EXCLUDED.call_type,
               updated_at = CURRENT_TIMESTAMP`,
            [
              record.call_id || record.id,
              record.date,
              record.duration ? parseInt(record.duration) : null,
              record.call_type || record.type,
              source,
            ]
          );
          break;

        case 'elocals_leads':
          await client.query(
            `INSERT INTO elocals_leads (lead_id, date, lead_type, status, cost, current_status)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (lead_id) 
             DO UPDATE SET 
               date = EXCLUDED.date,
               lead_type = EXCLUDED.lead_type,
               status = EXCLUDED.status,
               cost = EXCLUDED.cost,
               current_status = EXCLUDED.current_status,
               updated_at = CURRENT_TIMESTAMP`,
            [
              record.lead_id || record.id,
              record.date,
              record.lead_type || record.type,
              record.status,
              record.cost ? parseFloat(record.cost) : 0,
              record.current_status || record.status,
            ]
          );
          break;

        case 'google_spend':
          const spendDate = new Date(record.date);
          const monthDate = new Date(spendDate.getFullYear(), spendDate.getMonth(), 1)
            .toISOString().split('T')[0];
          
          await client.query(
            `INSERT INTO google_spend (date, month, campaign, amount, impressions, clicks)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (date, campaign) 
             DO UPDATE SET 
               month = EXCLUDED.month,
               amount = EXCLUDED.amount,
               impressions = EXCLUDED.impressions,
               clicks = EXCLUDED.clicks,
               updated_at = CURRENT_TIMESTAMP`,
            [
              record.date,
              monthDate,
              record.campaign || 'default',
              parseFloat(record.amount || record.spend || 0),
              record.impressions ? parseInt(record.impressions) : null,
              record.clicks ? parseInt(record.clicks) : null,
            ]
          );
          break;
      }
    } catch (error) {
      console.error(`Error inserting record into ${tableName}:`, error);
      throw error;
    }
  }
}

