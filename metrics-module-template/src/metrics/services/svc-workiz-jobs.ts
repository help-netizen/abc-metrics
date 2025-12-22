/**
 * Workiz Jobs Service for Metrics Module
 * 
 * This service fetches jobs from Workiz API and saves them to abc-metrics via API.
 * No direct database connections - all operations go through AbcMetricsClient.
 */

import axios from 'axios';
import { AbcMetricsClient, AbcMetricsJob } from './abc-metrics-client';

// Raw response from Workiz API
interface WorkizJobRaw {
  UUID?: string;
  LocationId?: number;
  LocationKey?: string;
  SerialId?: number;
  JobDateTime?: string;
  JobEndDateTime?: string;
  CreatedDate?: string;
  JobTotalPrice?: number;
  JobAmountDue?: number;
  SubTotal?: number;
  item_cost?: number;
  tech_cost?: number;
  ClientId?: number;
  Status?: string;
  SubStatus?: string;
  PaymentDueDate?: string;
  Phone?: string;
  Email?: string;
  FirstName?: string;
  LastName?: string;
  Address?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Unit?: string;
  ServiceArea?: string;
  JobType?: string;
  JobSource?: string;
  JobNotes?: string;
  Team?: Array<{ id: number; Name: string }>;
  [key: string]: any;
}

// Normalized job interface (internal)
interface WorkizJob {
  id: string;
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

export class SvcWorkizJobs {
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
   * Normalize raw Workiz API job data
   */
  private normalizeJob(rawJob: WorkizJobRaw): WorkizJob | null {
    try {
      const jobId = rawJob.UUID || rawJob.id || rawJob.unique_id;
      if (!jobId) {
        console.warn('Job missing ID field:', JSON.stringify(rawJob));
        return null;
      }

      let jobDate: string;
      const dateValue = rawJob.JobDateTime || rawJob.date || rawJob.CreatedDate || rawJob.created_at;
      if (dateValue) {
        if (typeof dateValue === 'string') {
          const datePart = dateValue.split(' ')[0];
          if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
            jobDate = datePart;
          } else {
            const parsedDate = new Date(dateValue);
            if (!isNaN(parsedDate.getTime())) {
              jobDate = parsedDate.toISOString().split('T')[0];
            } else {
              console.warn(`Invalid date format for job ${jobId}:`, dateValue);
              jobDate = new Date().toISOString().split('T')[0];
            }
          }
        } else {
          const parsedDate = new Date(dateValue);
          if (!isNaN(parsedDate.getTime())) {
            jobDate = parsedDate.toISOString().split('T')[0];
          } else {
            jobDate = new Date().toISOString().split('T')[0];
          }
        }
      } else {
        console.warn(`Job ${jobId} missing date field, using today`);
        jobDate = new Date().toISOString().split('T')[0];
      }

      const jobType = rawJob.JobType || rawJob.Type || rawJob.type || null;
      const jobSource = rawJob.JobSource || rawJob.Source || rawJob.source || 'workiz';
      const jobStatus = rawJob.Status || rawJob.status || null;
      const jobUnit = rawJob.Unit || rawJob.unit || null;
      const repairType = rawJob.RepairType || rawJob.repair_type || 
                        (jobType && jobType.includes('Repair') ? jobType : null);

      const itemCost = rawJob.item_cost || 0;
      const techCost = rawJob.tech_cost || 0;
      const totalCost = itemCost + techCost;
      const costValue = totalCost > 0 ? totalCost : (rawJob.Cost || rawJob.cost || null);
      const costFinal = costValue !== null && costValue !== undefined ? parseFloat(String(costValue)) : null;

      const revenue = rawJob.JobTotalPrice || rawJob.SubTotal || rawJob.JobAmountDue || 
                     rawJob.Revenue || rawJob.revenue || rawJob.TotalAmount || rawJob.total_amount || null;
      const revenueValue = revenue !== null && revenue !== undefined ? parseFloat(String(revenue)) : null;

      return {
        id: String(jobId),
        date: jobDate,
        type: jobType || undefined,
        source: jobSource,
        unit: jobUnit || undefined,
        repair_type: repairType || undefined,
        cost: costFinal ?? undefined,
        revenue: revenueValue ?? undefined,
        status: jobStatus || undefined,
        raw_data: rawJob,
      };
    } catch (error) {
      console.error('Error normalizing job:', error, rawJob);
      return null;
    }
  }

  /**
   * Fetch jobs from Workiz API with pagination
   */
  async fetchJobs(startDate: string, endDate?: string, onlyOpen: boolean = false): Promise<WorkizJob[]> {
    const allJobs: WorkizJob[] = [];
    let offset = 0;
    const recordsPerPage = 100;
    let hasMore = true;
    let pageNumber = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    if (endDate) {
      console.log(`Warning: end_date parameter (${endDate}) is ignored - Workiz API uses start_date until today`);
    }
    
    console.log(`[PAGINATION] Starting jobs fetch: start_date=${startDate}, only_open=${onlyOpen}, records_per_page=${recordsPerPage}`);

    while (hasMore) {
      pageNumber++;
      const pageStartTime = Date.now();
      
      const params: any = {
        start_date: startDate,
        offset: offset,
        records: recordsPerPage,
      };
      
      if (onlyOpen) {
        params.only_open = onlyOpen;
      }

      console.log(`[PAGINATION] Page ${pageNumber}: Fetching jobs - offset=${offset}, records=${recordsPerPage}`);

      let response;
      let jobsData: WorkizJobRaw[] = [];
      
      try {
        response = await axios.get(`${this.apiBasePath}/job/all/`, { params });
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        console.log(`[PAGINATION] Page ${pageNumber}: API request completed in ${requestTime}s, status=${response.status}`);

        if (Array.isArray(response.data)) {
          jobsData = response.data;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          jobsData = response.data.data;
        } else if (response.data?.jobs && Array.isArray(response.data.jobs)) {
          jobsData = response.data.jobs;
        }

        console.log(`[PAGINATION] Page ${pageNumber}: Received ${jobsData.length} jobs from API`);
        consecutiveErrors = 0;

      } catch (axiosError: any) {
        consecutiveErrors++;
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        
        console.error(`[PAGINATION] Page ${pageNumber}: API request failed after ${requestTime}s:`, {
          url: `${this.apiBasePath}/job/all/`,
          params: params,
          status: axiosError.response?.status,
          message: axiosError.message,
          consecutiveErrors: consecutiveErrors,
        });

        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`[PAGINATION] Stopping pagination after ${consecutiveErrors} consecutive errors`);
          hasMore = false;
          break;
        }

        if (axiosError.response?.status === 429) {
          const retryAfter = axiosError.response.headers['retry-after'] || 5;
          console.log(`[PAGINATION] Page ${pageNumber}: Rate limited, waiting ${retryAfter}s before next page`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        }

        console.warn(`[PAGINATION] Page ${pageNumber}: Skipping page due to error, continuing to next page`);
        offset += recordsPerPage;
        if (offset > 10000) {
          console.warn('[PAGINATION] Reached safety limit of 10000 records, stopping pagination');
          hasMore = false;
        }
        continue;
      }

      if (jobsData.length === 0) {
        console.log(`[PAGINATION] Page ${pageNumber}: No jobs returned from API, stopping pagination`);
        hasMore = false;
        break;
      }

      const normalizeStartTime = Date.now();
      const normalizedJobs = jobsData
        .map((rawJob) => this.normalizeJob(rawJob))
        .filter((job): job is WorkizJob => job !== null);
      const normalizeTime = ((Date.now() - normalizeStartTime) / 1000).toFixed(2);

      console.log(`[PAGINATION] Page ${pageNumber}: Normalized ${normalizedJobs.length} jobs from ${jobsData.length} raw jobs (took ${normalizeTime}s)`);

      allJobs.push(...normalizedJobs);

      const pageTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
      console.log(`[PAGINATION] Page ${pageNumber}: Summary - offset=${offset}, received=${jobsData.length}, normalized=${normalizedJobs.length}, total_accumulated=${allJobs.length}, time=${pageTime}s`);

      if (jobsData.length < recordsPerPage) {
        console.log(`[PAGINATION] Page ${pageNumber}: Received ${jobsData.length} < ${recordsPerPage} records, this is the last page`);
        hasMore = false;
      } else {
        offset += recordsPerPage;
        if (offset > 10000) {
          console.warn(`[PAGINATION] Page ${pageNumber}: Reached safety limit of 10000 records, stopping pagination`);
          hasMore = false;
        }
      }
      
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[PAGINATION] Completed: Total pages=${pageNumber}, total jobs fetched=${allJobs.length}`);
    if (allJobs.length === 0) {
      console.warn('[PAGINATION] WARNING: No jobs were fetched from Workiz API. Check API credentials and date range.');
    } else {
      console.log(`[PAGINATION] Successfully fetched ${allJobs.length} jobs across ${pageNumber} page(s)`);
    }
    return allJobs;
  }

  /**
   * Convert WorkizJob to AbcMetricsJob format for API
   */
  private convertToApiFormat(job: WorkizJob): AbcMetricsJob {
    return {
      job_id: job.id,
      date: job.date,
      type: job.type,
      source: job.source || 'workiz',
      unit: job.unit,
      repair_type: job.repair_type,
      cost: job.cost,
      revenue: job.revenue,
      status: job.status,
      raw_data: job.raw_data,
    };
  }

  /**
   * Save jobs to abc-metrics via API
   * Uses UPSERT to ensure idempotent syncs - can run hourly without duplicates
   */
  async saveJobs(jobs: WorkizJob[]): Promise<void> {
    if (!jobs || jobs.length === 0) {
      console.log('No jobs to save');
      return;
    }

    try {
      // Convert to API format
      const apiJobs: AbcMetricsJob[] = jobs
        .filter(job => job.id) // Filter out jobs without ID
        .map(job => this.convertToApiFormat(job));

      if (apiJobs.length === 0) {
        console.warn('No valid jobs to save after conversion');
        return;
      }

      console.log(`Saving ${apiJobs.length} jobs to abc-metrics via API...`);
      
      // Save via API
      const result = await this.abcMetricsClient.saveJobs(apiJobs);
      
      if (result.success) {
        console.log(`Jobs save summary: ${result.count || apiJobs.length} saved via API`);
      } else {
        console.error(`Error saving jobs via API: ${result.error || 'Unknown error'}`);
        throw new Error(result.error || 'Failed to save jobs via API');
      }
    } catch (error: any) {
      console.error('Error saving Workiz jobs via API:', error);
      throw error;
    }
  }

  /**
   * Sync jobs (fetch and save)
   */
  async syncJobs(): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const jobs = await this.fetchJobs(startDate, endDate, false);
    await this.saveJobs(jobs);
  }
}



