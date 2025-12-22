/**
 * HTTP Client for ABC Metrics API
 * 
 * This client is used to save data to abc-metrics database via REST API.
 * All database operations go through this client - no direct DB connections.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

export interface AbcMetricsJob {
  job_id: string;
  date: string;
  type?: string;
  source?: string;
  unit?: string;
  repair_type?: string;
  cost?: number;
  revenue?: number;
  status?: string;
  raw_data?: any;
}

export interface AbcMetricsLead {
  lead_id: string;
  source?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  job_id?: string;
  client_phone?: string;
  client_name?: string;
  raw_data?: any;
}

export interface AbcMetricsPayment {
  payment_id: string;
  job_id: string;
  date: string;
  amount: number;
  method?: string;
  raw_data?: any;
}

export interface AbcMetricsCall {
  call_id: string;
  date: string;
  duration?: number;
  call_type?: string;
  source: string;
}

export interface BatchData {
  jobs?: AbcMetricsJob[];
  leads?: AbcMetricsLead[];
  payments?: AbcMetricsPayment[];
  calls?: AbcMetricsCall[];
}

export interface AbcMetricsResponse {
  success: boolean;
  count?: number;
  total_count?: number;
  message?: string;
  error?: string;
  data?: any;
  results?: any;
}

export class AbcMetricsClient {
  private apiUrl: string;
  private apiKey: string;
  private client: AxiosInstance;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor() {
    this.apiUrl = process.env.ABC_METRICS_API_URL || 'https://abc-metrics.fly.dev';
    this.apiKey = process.env.ABC_METRICS_API_KEY || '';

    if (!this.apiKey) {
      throw new Error('ABC_METRICS_API_KEY is required');
    }

    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: 30000, // 30 seconds
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Retry logic for failed requests
   */
  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    retries: number = this.maxRetries
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error: any) {
      if (retries > 0 && this.isRetryableError(error)) {
        console.warn(`Request failed, retrying... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.retryRequest(requestFn, retries - 1);
      }
      throw error;
    }
  }

  /**
   * Check if error is retryable (5xx, network errors)
   */
  private isRetryableError(error: any): boolean {
    if (!error.response) {
      // Network error - retry
      return true;
    }
    const status = error.response.status;
    // Retry on 5xx errors, but not on 4xx (client errors)
    return status >= 500 && status < 600;
  }

  /**
   * Save jobs to abc-metrics via API
   */
  async saveJobs(jobs: AbcMetricsJob[]): Promise<AbcMetricsResponse> {
    if (!jobs || jobs.length === 0) {
      return { success: true, count: 0, message: 'No jobs to save' };
    }

    return this.retryRequest(async () => {
      const response = await this.client.post<AbcMetricsResponse>('/api/db/jobs', jobs);
      return response.data;
    });
  }

  /**
   * Save leads to abc-metrics via API
   */
  async saveLeads(leads: AbcMetricsLead[]): Promise<AbcMetricsResponse> {
    if (!leads || leads.length === 0) {
      return { success: true, count: 0, message: 'No leads to save' };
    }

    return this.retryRequest(async () => {
      const response = await this.client.post<AbcMetricsResponse>('/api/db/leads', leads);
      return response.data;
    });
  }

  /**
   * Save payments to abc-metrics via API
   */
  async savePayments(payments: AbcMetricsPayment[]): Promise<AbcMetricsResponse> {
    if (!payments || payments.length === 0) {
      return { success: true, count: 0, message: 'No payments to save' };
    }

    return this.retryRequest(async () => {
      const response = await this.client.post<AbcMetricsResponse>('/api/db/payments', payments);
      return response.data;
    });
  }

  /**
   * Save calls to abc-metrics via API
   */
  async saveCalls(calls: AbcMetricsCall[]): Promise<AbcMetricsResponse> {
    if (!calls || calls.length === 0) {
      return { success: true, count: 0, message: 'No calls to save' };
    }

    return this.retryRequest(async () => {
      const response = await this.client.post<AbcMetricsResponse>('/api/db/calls', calls);
      return response.data;
    });
  }

  /**
   * Batch save multiple types of data in a single request
   */
  async batchSave(data: BatchData): Promise<AbcMetricsResponse> {
    if (!data || (!data.jobs && !data.leads && !data.payments && !data.calls)) {
      return { success: false, error: 'No data provided for batch save' };
    }

    return this.retryRequest(async () => {
      const response = await this.client.post<AbcMetricsResponse>('/api/db/batch', data);
      return response.data;
    });
  }

  /**
   * Trigger daily aggregation in abc-metrics
   */
  async aggregateDaily(date?: string): Promise<AbcMetricsResponse> {
    return this.retryRequest(async () => {
      const response = await this.client.post<AbcMetricsResponse>('/api/db/aggregate/daily', {
        date: date || new Date().toISOString().split('T')[0],
      });
      return response.data;
    });
  }

  /**
   * Trigger monthly aggregation in abc-metrics
   */
  async aggregateMonthly(month?: string): Promise<AbcMetricsResponse> {
    return this.retryRequest(async () => {
      const response = await this.client.post<AbcMetricsResponse>('/api/db/aggregate/monthly', {
        month: month || new Date().toISOString().split('T')[0],
      });
      return response.data;
    });
  }
}



