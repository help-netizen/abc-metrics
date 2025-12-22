import * as cron from 'node-cron';
import { AggregationService } from './services/aggregation.service';

/**
 * Scheduler for ABC Metrics
 * 
 * NOTE: Data synchronization (Workiz, Elocal, CSV) has been moved to rely-lead-processor.
 * This scheduler only handles aggregation of metrics from the database.
 */
export class Scheduler {
  private aggregationService: AggregationService;

  constructor() {
    this.aggregationService = new AggregationService();
  }

  start(): void {
    console.log('[SCHEDULER] Starting metrics aggregation scheduler...');
    console.log('[SCHEDULER] Note: Data synchronization is handled by rely-lead-processor');

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

    console.log('[SCHEDULER] Metrics aggregation scheduler started successfully');
  }
}

