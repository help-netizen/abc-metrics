import axios from 'axios';
import pool from '../db/connection';

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

// Normalized payment interface
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

  constructor() {
    this.apiKey = process.env.WORKIZ_API_KEY || '';
    this.apiSecret = process.env.WORKIZ_API_SECRET || '';
    const apiUrl = process.env.WORKIZ_API_URL || 'https://api.workiz.com';
    this.apiBasePath = `${apiUrl}/api/v1/${this.apiKey}`;

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

      // Workiz API: GET /api/v1/{API_KEY}/payments
      const response = await axios.get(`${this.apiBasePath}/payments`, {
        params: {
          start_date: startDate,
          end_date: endDate,
          updated_at: startDate, // Use updated_at for incremental sync
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
   * Save payments to fact_payments table
   * Uses ON CONFLICT DO UPDATE to ensure idempotent syncs - can run hourly without duplicates
   */
  async savePayments(payments: WorkizPayment[]): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ paymentId: string; error: string }> = [];

      for (const payment of payments) {
        try {
          if (!payment.id || !payment.job_id) {
            console.warn('Skipping payment without ID or job_id:', JSON.stringify(payment));
            skippedCount++;
            continue;
          }

          if (savedCount < 3) {
            console.log(`Saving payment: id=${payment.id}, job_id=${payment.job_id}, amount=${payment.amount}`);
          }

          // Parse paid_at date
          let paidAt: Date | null = null;
          if (payment.date) {
            paidAt = new Date(payment.date);
            if (isNaN(paidAt.getTime())) {
              paidAt = new Date();
            }
          } else {
            paidAt = new Date();
          }

          const metaJson = payment.raw_data ? JSON.stringify(payment.raw_data) : null;

          await client.query(
            `INSERT INTO fact_payments (
              payment_id, job_id, paid_at, amount, method, meta
            )
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (payment_id) 
             DO UPDATE SET 
               job_id = EXCLUDED.job_id,
               paid_at = EXCLUDED.paid_at,
               amount = EXCLUDED.amount,
               method = EXCLUDED.method,
               meta = EXCLUDED.meta,
               updated_at_db = CURRENT_TIMESTAMP`,
            [
              payment.id,
              payment.job_id,
              paidAt,
              payment.amount,
              payment.method || null,
              metaJson,
            ]
          );

          savedCount++;
        } catch (dbError: any) {
          console.error(`Error saving payment ${payment.id}:`, dbError.message);
          errors.push({ paymentId: payment.id, error: dbError.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');
      
      console.log(`Payments save summary: ${savedCount} saved, ${skippedCount} skipped`);
      if (errors.length > 0) {
        console.warn(`Errors encountered:`, errors.slice(0, 10));
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving Workiz payments:', error);
      throw error;
    } finally {
      client.release();
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

