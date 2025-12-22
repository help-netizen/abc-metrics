/**
 * CSV Service for Metrics Module
 * 
 * This service processes CSV files and saves them to abc-metrics via API.
 * No direct database connections - all operations go through AbcMetricsClient.
 */

import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { AbcMetricsClient, AbcMetricsJob, AbcMetricsPayment, AbcMetricsCall, AbcMetricsLead, BatchData } from './abc-metrics-client';

export class CsvService {
  private csvDirectory: string;
  private abcMetricsClient: AbcMetricsClient;

  constructor() {
    this.csvDirectory = process.env.CSV_DIRECTORY || './csv-data';
    this.abcMetricsClient = new AbcMetricsClient();
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
    try {
      const batchData: BatchData = {};

      switch (tableName) {
        case 'jobs':
          const jobs: AbcMetricsJob[] = records.map(record => {
            const jobType = record.type || record.job_type || null;
            return {
              job_id: record.job_id || record.id,
              date: record.date,
              type: jobType,
              source: record.source || source,
              unit: record.unit,
              repair_type: record.repair_type,
              cost: record.cost ? parseFloat(record.cost) : undefined,
              revenue: record.revenue ? parseFloat(record.revenue) : undefined,
              status: record.status,
              raw_data: record,
            };
          }).filter(job => job.job_id);
          batchData.jobs = jobs;
          break;

        case 'payments':
          const payments: AbcMetricsPayment[] = records.map(record => ({
            payment_id: record.payment_id || record.id,
            job_id: record.job_id,
            date: record.date,
            amount: parseFloat(record.amount),
            method: record.payment_type || record.type,
            raw_data: record,
          })).filter(payment => payment.payment_id && payment.job_id);
          batchData.payments = payments;
          break;

        case 'calls':
          const calls: AbcMetricsCall[] = records.map(record => ({
            call_id: record.call_id || record.id,
            date: record.date,
            duration: record.duration ? parseInt(record.duration) : undefined,
            call_type: record.call_type || record.type,
            source: source,
          })).filter(call => call.call_id);
          batchData.calls = calls;
          break;

        case 'elocals_leads':
          const leads: AbcMetricsLead[] = records.map(record => ({
            lead_id: record.lead_id || record.id,
            source: source,
            status: record.status || record.current_status,
            created_at: record.date || new Date().toISOString(),
            raw_data: record,
          })).filter(lead => lead.lead_id);
          batchData.leads = leads;
          break;

        case 'google_spend':
          // Google spend is not supported via API yet - skip for now
          console.log(`Google spend CSV processing not yet supported via API`);
          return;

        default:
          console.log(`Unknown table type: ${tableName}`);
          return;
      }

      // Save via batch API
      if (Object.keys(batchData).length > 0) {
        const result = await this.abcMetricsClient.batchSave(batchData);
        if (result.success) {
          const totalCount = result.total_count || Object.values(batchData).reduce((sum, arr) => sum + (arr?.length || 0), 0);
          console.log(`Saved ${totalCount} records to ${tableName} from ${source} via API`);
        } else {
          console.error(`Error saving records to ${tableName} via API: ${result.error}`);
          throw new Error(result.error || 'Failed to save records via API');
        }
      }
    } catch (error) {
      console.error(`Error saving records to ${tableName}:`, error);
      throw error;
    }
  }
}



