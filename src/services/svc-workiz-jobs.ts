import axios from 'axios';
import pool from '../db/connection';

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

// Normalized job interface
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
   * Get source_id from dim_source by code
   */
  private async getSourceId(sourceCode: string): Promise<number | null> {
    const client = await pool.connect();
    try {
      const normalizedCode = sourceCode.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');

      const result = await client.query(
        'SELECT id FROM dim_source WHERE code = $1',
        [normalizedCode]
      );

      if (result.rows.length > 0) {
        return result.rows[0].id;
      }

      const resultByName = await client.query(
        'SELECT id FROM dim_source WHERE LOWER(name) = LOWER($1)',
        [sourceCode]
      );

      if (resultByName.rows.length > 0) {
        return resultByName.rows[0].id;
      }

      const defaultResult = await client.query(
        'SELECT id FROM dim_source WHERE code = $1',
        ['workiz']
      );

      return defaultResult.rows[0]?.id || null;
    } finally {
      client.release();
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

    try {
      console.log(`Fetching jobs from Workiz API: start_date=${startDate}, end_date=${endDate || 'today'}, only_open=${onlyOpen}`);

      while (hasMore) {
        const params: any = {
          start_date: startDate,
          offset: offset,
          records: recordsPerPage,
          only_open: onlyOpen,
        };

        console.log(`Fetching jobs page: offset=${offset}, records=${recordsPerPage}`);

        const response = await axios.get(`${this.apiBasePath}/job/all/`, { params });

        let jobsData: WorkizJobRaw[] = [];
        if (Array.isArray(response.data)) {
          jobsData = response.data;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          jobsData = response.data.data;
        } else if (response.data?.jobs && Array.isArray(response.data.jobs)) {
          jobsData = response.data.jobs;
        }

        console.log(`Received ${jobsData.length} jobs in this page`);

        if (offset === 0 && jobsData.length > 0) {
          console.log('Sample raw job structure from API:', JSON.stringify(jobsData[0], null, 2));
        }

        const normalizedJobs = jobsData
          .map((rawJob) => this.normalizeJob(rawJob))
          .filter((job): job is WorkizJob => job !== null);

        allJobs.push(...normalizedJobs);

        if (jobsData.length < recordsPerPage) {
          hasMore = false;
        } else {
          offset += recordsPerPage;
          if (offset > 10000) {
            console.warn('Reached safety limit of 10000 records, stopping pagination');
            hasMore = false;
          }
        }
      }

      console.log(`Total jobs fetched: ${allJobs.length}`);
      return allJobs;
    } catch (error: any) {
      console.error('Error fetching Workiz jobs:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return allJobs;
    }
  }

  /**
   * Save jobs to fact_jobs table
   * Uses ON CONFLICT DO UPDATE to ensure idempotent syncs - can run hourly without duplicates
   */
  async saveJobs(jobs: WorkizJob[]): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ jobId: string; error: string }> = [];

      for (const job of jobs) {
        try {
          if (!job.id) {
            console.warn('Skipping job without ID:', JSON.stringify(job));
            skippedCount++;
            continue;
          }

          if (savedCount < 3) {
            console.log(`Saving job: id=${job.id}, date=${job.date}, type=${job.type}, source=${job.source}`);
          }

          // Get source_id from dim_source
          const sourceId = await this.getSourceId(job.source || 'workiz');

          // Extract lead_id from raw_data if available (job might be converted from lead)
          let leadId: string | null = null;
          if (job.raw_data) {
            const rawData = job.raw_data as any;
            leadId = rawData.LeadId || rawData.lead_id || rawData.LeadUUID || null;
          }

          // Extract scheduled_at from JobDateTime
          let scheduledAt: Date | null = null;
          if (job.raw_data) {
            const rawData = job.raw_data as any;
            const jobDateTime = rawData.JobDateTime;
            if (jobDateTime) {
              scheduledAt = new Date(jobDateTime);
            }
          }

          // Extract client_id
          let clientId: number | null = null;
          if (job.raw_data) {
            const rawData = job.raw_data as any;
            clientId = rawData.ClientId || null;
          }

          const metaJson = job.raw_data ? JSON.stringify(job.raw_data) : null;
          const createdAt = job.date ? new Date(job.date) : new Date();

          await client.query(
            `INSERT INTO fact_jobs (
              job_id, lead_id, created_at, scheduled_at, source_id, type, client_id, meta
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (job_id) 
             DO UPDATE SET 
               lead_id = EXCLUDED.lead_id,
               created_at = EXCLUDED.created_at,
               scheduled_at = EXCLUDED.scheduled_at,
               source_id = EXCLUDED.source_id,
               type = EXCLUDED.type,
               client_id = EXCLUDED.client_id,
               meta = EXCLUDED.meta,
               updated_at_db = CURRENT_TIMESTAMP`,
            [
              job.id,
              leadId,
              createdAt,
              scheduledAt,
              sourceId,
              job.type || null,
              clientId,
              metaJson,
            ]
          );

          savedCount++;
        } catch (dbError: any) {
          console.error(`Error saving job ${job.id}:`, dbError.message);
          errors.push({ jobId: job.id, error: dbError.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');
      
      console.log(`Jobs save summary: ${savedCount} saved, ${skippedCount} skipped`);
      if (errors.length > 0) {
        console.warn(`Errors encountered:`, errors.slice(0, 10));
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving Workiz jobs:', error);
      throw error;
    } finally {
      client.release();
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

