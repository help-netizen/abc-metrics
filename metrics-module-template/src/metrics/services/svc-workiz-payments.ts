/**
 * Workiz Payments Service for Metrics Module
 * 
 * This service fetches payments from Workiz API and saves them to abc-metrics via API.
 * No direct database connections - all operations go through AbcMetricsClient.
 */

import axios from 'axios';
import { AbcMetricsClient, AbcMetricsPayment } from './abc-metrics-client';

// Raw response from Workiz API for payments
interface WorkizPaymentRaw {
  id?: string;
  payment_id?: string;
  UUID?: string;
  job_id?: string;
  jobId?: string;
  JobId?: string;
  amount?: number;
  Amount?: number;
  date?: string;
  Date?: string;
  paid_at?: string;
  PaidAt?: string;
  payment_type?: string;
  PaymentType?: string;
  method?: string;
  Method?: string;
  [key: string]: any;
}

// Normalized payment interface (internal)
interface WorkizPayment {
  id: string;
  job_id: string;
  amount: number;
  date: string;
  payment_type?: string;
  method?: string;
  raw_data?: any;
}

export class SvcWorkizPayments {
  private apiKey: string;
  private apiSecret: string;
  private apiBasePath: string;
  private abcMetricsClient: AbcMetricsClient;

  constructor() {
    this.apiKey = process.env.WORKIZ_API_KEY || '';
    this.apiSecret = process.env.WORKIZ_API_SECRET || '';
    const apiUrl = process.env.WORKIZ_API_URL || 'https://api.workiz.com';
    this.apiBasePath = `${apiUrl}/api/v1/${this.apiKey}`;
    this.abcMetricsClient = new AbcMetricsClient();

    if (!this.apiKey) {
      throw new Error('WORKIZ_API_KEY is required');
    }
  }

  /**
   * Normalize raw Workiz API payment data
   */
  private normalizePayment(rawPayment: WorkizPaymentRaw): WorkizPayment | null {
    try {
      const paymentId = rawPayment.UUID || rawPayment.id || rawPayment.payment_id;
      if (!paymentId) {
        console.warn('Payment missing ID field:', JSON.stringify(rawPayment));
        return null;
      }

      const jobId = rawPayment.job_id || rawPayment.jobId || rawPayment.JobId;
      if (!jobId) {
        console.warn('Payment missing job_id:', JSON.stringify(rawPayment));
        return null;
      }

      const amount = rawPayment.Amount || rawPayment.amount;
      if (amount === null || amount === undefined || isNaN(Number(amount))) {
        console.warn('Payment missing or invalid amount:', JSON.stringify(rawPayment));
        return null;
      }

      const paidAt = rawPayment.PaidAt || rawPayment.paid_at || rawPayment.Date || rawPayment.date || new Date().toISOString();
      const method = rawPayment.Method || rawPayment.method || rawPayment.PaymentType || rawPayment.payment_type || null;

      return {
        id: String(paymentId),
        job_id: String(jobId),
        amount: parseFloat(String(amount)),
        date: paidAt,
        payment_type: method || undefined,
        method: method || undefined,
        raw_data: rawPayment,
      };
    } catch (error) {
      console.error('Error normalizing payment:', error, rawPayment);
      return null;
    }
  }

  /**
   * Fetch payments from Workiz API
   */
  async fetchPayments(startDate: string, endDate: string): Promise<WorkizPayment[]> {
    try {
      console.log(`Fetching payments from Workiz API: start_date=${startDate}, end_date=${endDate}`);

      const response = await axios.get(`${this.apiBasePath}/payments`, {
        params: {
          start_date: startDate,
          end_date: endDate,
          updated_at: startDate,
        },
      });

      let paymentsData: WorkizPaymentRaw[] = [];
      if (Array.isArray(response.data)) {
        paymentsData = response.data;
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        paymentsData = response.data.data;
      } else if (response.data?.payments && Array.isArray(response.data.payments)) {
        paymentsData = response.data.payments;
      }

      console.log(`Received ${paymentsData.length} payments`);

      if (paymentsData.length > 0) {
        console.log('Sample raw payment structure from API:', JSON.stringify(paymentsData[0], null, 2));
      }

      const normalizedPayments = paymentsData
        .map((rawPayment) => this.normalizePayment(rawPayment))
        .filter((payment): payment is WorkizPayment => payment !== null);

      console.log(`Total payments fetched: ${normalizedPayments.length}`);
      return normalizedPayments;
    } catch (error: any) {
      console.error('Error fetching Workiz payments:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return [];
    }
  }

  /**
   * Convert WorkizPayment to AbcMetricsPayment format for API
   */
  private convertToApiFormat(payment: WorkizPayment): AbcMetricsPayment {
    return {
      payment_id: payment.id,
      job_id: payment.job_id,
      date: payment.date,
      amount: payment.amount,
      method: payment.method,
      raw_data: payment.raw_data,
    };
  }

  /**
   * Save payments to abc-metrics via API
   * Uses UPSERT to ensure idempotent syncs - can run hourly without duplicates
   */
  async savePayments(payments: WorkizPayment[]): Promise<void> {
    if (!payments || payments.length === 0) {
      console.log('No payments to save');
      return;
    }

    try {
      // Convert to API format
      const apiPayments: AbcMetricsPayment[] = payments
        .filter(payment => payment.id && payment.job_id) // Filter out invalid payments
        .map(payment => this.convertToApiFormat(payment));

      if (apiPayments.length === 0) {
        console.warn('No valid payments to save after conversion');
        return;
      }

      console.log(`Saving ${apiPayments.length} payments to abc-metrics via API...`);
      
      // Save via API
      const result = await this.abcMetricsClient.savePayments(apiPayments);
      
      if (result.success) {
        console.log(`Payments save summary: ${result.count || apiPayments.length} saved via API`);
      } else {
        console.error(`Error saving payments via API: ${result.error || 'Unknown error'}`);
        throw new Error(result.error || 'Failed to save payments via API');
      }
    } catch (error: any) {
      console.error('Error saving Workiz payments via API:', error);
      throw error;
    }
  }

  /**
   * Sync payments (fetch and save)
   */
  async syncPayments(): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const payments = await this.fetchPayments(startDate, endDate);
    await this.savePayments(payments);
  }
}



