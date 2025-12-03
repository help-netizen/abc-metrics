import * as cron from 'node-cron';
import { SvcWorkizLeads } from './services/svc-workiz-leads';
import { SvcWorkizJobs } from './services/svc-workiz-jobs';
import { SvcWorkizPayments } from './services/svc-workiz-payments';
import { SvcElocalCalls } from './services/svc-elocal-calls';
import { CsvService } from './services/csv.service';
import { AggregationService } from './services/aggregation.service';

export class Scheduler {
  private svcWorkizLeads: SvcWorkizLeads;
  private svcWorkizJobs: SvcWorkizJobs;
  private svcWorkizPayments: SvcWorkizPayments;
  private svcElocalCalls: SvcElocalCalls;
  private csvService: CsvService;
  private aggregationService: AggregationService;

  constructor() {
    this.svcWorkizLeads = new SvcWorkizLeads();
    this.svcWorkizJobs = new SvcWorkizJobs();
    this.svcWorkizPayments = new SvcWorkizPayments();
    this.svcElocalCalls = new SvcElocalCalls();
    this.csvService = new CsvService();
    this.aggregationService = new AggregationService();
  }

  start(): void {
    console.log('Starting scheduler...');

    // Sync Workiz jobs every hour
    cron.schedule('0 * * * *', async () => {
      console.log('Running svc-workiz-jobs sync...');
      try {
        await this.svcWorkizJobs.syncJobs();
      } catch (error) {
        console.error('Error in svc-workiz-jobs sync:', error);
      }
    });

    // Sync Workiz leads every hour
    cron.schedule('5 * * * *', async () => {
      console.log('Running svc-workiz-leads sync...');
      try {
        await this.svcWorkizLeads.syncLeads();
      } catch (error) {
        console.error('Error in svc-workiz-leads sync:', error);
      }
    });

    // Sync Workiz payments every hour
    cron.schedule('10 * * * *', async () => {
      console.log('Running svc-workiz-payments sync...');
      try {
        await this.svcWorkizPayments.syncPayments();
      } catch (error) {
        console.error('Error in svc-workiz-payments sync:', error);
      }
    });

    // Sync Workiz calls every 6 hours (optional) - TODO: implement svc-workiz-calls
    // cron.schedule('0 */6 * * *', async () => {
    //   console.log('Running Workiz calls sync...');
    //   // TODO: implement calls service
    // });

    // Sync Elocal calls every day at 4 AM
    cron.schedule('0 4 * * *', async () => {
      console.log('Running elocal calls sync...');
      try {
        await this.svcElocalCalls.syncCalls();
      } catch (error) {
        console.error('Error in elocal calls sync:', error);
      }
    });

    // Process CSV files every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      console.log('Processing CSV files...');
      try {
        await this.csvService.processCsvFiles();
      } catch (error) {
        console.error('Error processing CSV files:', error);
      }
    });

    // Aggregate daily metrics every day at 1 AM
    cron.schedule('0 1 * * *', async () => {
      console.log('Aggregating daily metrics...');
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        await this.aggregationService.aggregateDailyMetrics(yesterday);
      } catch (error) {
        console.error('Error aggregating daily metrics:', error);
      }
    });

    // Aggregate monthly metrics on the 1st of each month at 2 AM
    cron.schedule('0 2 1 * *', async () => {
      console.log('Aggregating monthly metrics...');
      try {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        // Use first day of the month
        const monthDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
        await this.aggregationService.aggregateMonthlyMetrics(monthDate);
      } catch (error) {
        console.error('Error aggregating monthly metrics:', error);
      }
    });

    // Re-aggregate all metrics every day at 3 AM (for data corrections)
    cron.schedule('0 3 * * *', async () => {
      console.log('Re-aggregating all metrics...');
      try {
        await this.aggregationService.aggregateAllDailyMetrics();
        await this.aggregationService.aggregateAllMonthlyMetrics();
      } catch (error) {
        console.error('Error re-aggregating metrics:', error);
      }
    });

    console.log('Scheduler started successfully');
  }
}

