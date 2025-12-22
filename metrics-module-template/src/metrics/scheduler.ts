/**
 * Metrics Scheduler for Metrics Module
 * 
 * This scheduler runs periodic sync tasks for external data sources.
 * All data is saved to abc-metrics via API.
 */

import * as cron from 'node-cron';
import { SvcWorkizLeads } from './services/svc-workiz-leads';
import { SvcWorkizJobs } from './services/svc-workiz-jobs';
import { SvcWorkizPayments } from './services/svc-workiz-payments';
import { SvcElocalCalls } from './services/svc-elocal-calls';
import { CsvService } from './services/csv.service';
import { AbcMetricsClient } from './services/abc-metrics-client';

export class MetricsScheduler {
  private svcWorkizLeads: SvcWorkizLeads;
  private svcWorkizJobs: SvcWorkizJobs;
  private svcWorkizPayments: SvcWorkizPayments;
  private svcElocalCalls: SvcElocalCalls;
  private csvService: CsvService;
  private abcMetricsClient: AbcMetricsClient;

  constructor() {
    this.svcWorkizLeads = new SvcWorkizLeads();
    this.svcWorkizJobs = new SvcWorkizJobs();
    this.svcWorkizPayments = new SvcWorkizPayments();
    this.svcElocalCalls = new SvcElocalCalls();
    this.csvService = new CsvService();
    this.abcMetricsClient = new AbcMetricsClient();
  }

  start(): void {
    console.log('[METRICS] Starting metrics scheduler...');

    // Sync Workiz jobs every hour at minute 0
    cron.schedule('0 * * * *', async () => {
      console.log('[METRICS] Running Workiz jobs sync...');
      try {
        await this.svcWorkizJobs.syncJobs();
      } catch (error) {
        console.error('[METRICS] Error in Workiz jobs sync:', error);
      }
    });

    // Sync Workiz leads every hour at minute 5
    cron.schedule('5 * * * *', async () => {
      console.log('[METRICS] Running Workiz leads sync...');
      try {
        await this.svcWorkizLeads.syncLeads();
      } catch (error) {
        console.error('[METRICS] Error in Workiz leads sync:', error);
      }
    });

    // Sync Workiz payments every hour at minute 10
    cron.schedule('10 * * * *', async () => {
      console.log('[METRICS] Running Workiz payments sync...');
      try {
        await this.svcWorkizPayments.syncPayments();
      } catch (error) {
        console.error('[METRICS] Error in Workiz payments sync:', error);
      }
    });

    // Sync Elocal calls every day at 4 AM (excluding current day)
    cron.schedule('0 4 * * *', async () => {
      console.log('[METRICS] Running Elocal calls sync...');
      try {
        await this.svcElocalCalls.syncCalls();
      } catch (error) {
        console.error('[METRICS] Error in Elocal calls sync:', error);
      }
    });

    // Process CSV files every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      console.log('[METRICS] Processing CSV files...');
      try {
        await this.csvService.processCsvFiles();
      } catch (error) {
        console.error('[METRICS] Error processing CSV files:', error);
      }
    });

    // Trigger daily aggregation in abc-metrics every day at 1 AM
    cron.schedule('0 1 * * *', async () => {
      console.log('[METRICS] Triggering daily aggregation in abc-metrics...');
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];
        await this.abcMetricsClient.aggregateDaily(dateStr);
      } catch (error) {
        console.error('[METRICS] Error triggering daily aggregation:', error);
      }
    });

    // Trigger monthly aggregation in abc-metrics on the 1st of each month at 2 AM
    cron.schedule('0 2 1 * *', async () => {
      console.log('[METRICS] Triggering monthly aggregation in abc-metrics...');
      try {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const monthStr = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1).toISOString().split('T')[0];
        await this.abcMetricsClient.aggregateMonthly(monthStr);
      } catch (error) {
        console.error('[METRICS] Error triggering monthly aggregation:', error);
      }
    });

    console.log('[METRICS] Metrics scheduler started successfully');
  }
}



