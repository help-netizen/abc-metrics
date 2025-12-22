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
   * Get source_id from dim_source by code, create if not exists
   */
  private async getSourceId(sourceCode: string): Promise<number> {
    const client = await pool.connect();
    try {
      if (!sourceCode || sourceCode.trim() === '') {
        sourceCode = 'workiz';
      }

      const normalizedCode = sourceCode.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');

      // Try to find by normalized code
      let result = await client.query(
        'SELECT id FROM dim_source WHERE code = $1',
        [normalizedCode]
      );

      if (result.rows.length > 0) {
        return result.rows[0].id;
      }

      // Source not found - create it automatically
      console.log(`Creating new source in dim_source: code='${normalizedCode}', name='${sourceCode}'`);
      const insertResult = await client.query(
        `INSERT INTO dim_source (code, name) 
         VALUES ($1, $2) 
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [normalizedCode, sourceCode]
      );

      if (insertResult.rows.length > 0) {
        return insertResult.rows[0].id;
      }

      throw new Error(`Failed to create source '${sourceCode}' in dim_source table.`);
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
   * Workiz API endpoint: /job/all/
   * Parameters: start_date (required), offset (default 0), records (default 100, max 100), only_open (default true)
   * Note: end_date is NOT supported by Workiz API - it uses start_date until today
   */
  async fetchJobs(startDate: string, endDate?: string, onlyOpen: boolean = false): Promise<WorkizJob[]> {
    const allJobs: WorkizJob[] = [];
    let offset = 0;
    const recordsPerPage = 100;
    let hasMore = true;
    let pageNumber = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    // Workiz API doesn't support end_date - it uses start_date until today
    // endDate parameter is kept for backward compatibility but ignored
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
        records: recordsPerPage, // Workiz API uses 'records' not 'limit'
      };
      
      if (onlyOpen) {
        params.only_open = onlyOpen;
      }

      console.log(`[PAGINATION] Page ${pageNumber}: Fetching jobs - offset=${offset}, records=${recordsPerPage}`);
      console.log(`[PAGINATION] Page ${pageNumber}: Request URL: ${this.apiBasePath}/job/all/`);
      console.log(`[PAGINATION] Page ${pageNumber}: Request params:`, JSON.stringify(params, null, 2));

      // Workiz API: GET /api/v1/{API_KEY}/job/all/
      let response;
      let jobsData: WorkizJobRaw[] = [];
      
      try {
        response = await axios.get(`${this.apiBasePath}/job/all/`, { params });
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        console.log(`[PAGINATION] Page ${pageNumber}: API request completed in ${requestTime}s, status=${response.status}`);
        
        // Log response structure for debugging
        if (pageNumber === 1) {
          console.log(`[PAGINATION] Page ${pageNumber}: Response structure:`, {
            isArray: Array.isArray(response.data),
            hasData: !!response.data?.data,
            hasJobs: !!response.data?.jobs,
            keys: response.data ? Object.keys(response.data) : [],
          });
        }

        // Parse response data - handle different possible structures
        if (Array.isArray(response.data)) {
          jobsData = response.data;
          console.log(`[PAGINATION] Page ${pageNumber}: Response is direct array`);
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          jobsData = response.data.data;
          console.log(`[PAGINATION] Page ${pageNumber}: Response has data.data array`);
        } else if (response.data?.jobs && Array.isArray(response.data.jobs)) {
          jobsData = response.data.jobs;
          console.log(`[PAGINATION] Page ${pageNumber}: Response has data.jobs array`);
        } else {
          console.warn(`[PAGINATION] Page ${pageNumber}: Unexpected response structure:`, {
            type: typeof response.data,
            isArray: Array.isArray(response.data),
            keys: response.data ? Object.keys(response.data) : [],
            sample: JSON.stringify(response.data).substring(0, 200),
          });
        }

        console.log(`[PAGINATION] Page ${pageNumber}: Received ${jobsData.length} jobs from API`);

        // Reset error counter on successful request
        consecutiveErrors = 0;

      } catch (axiosError: any) {
        consecutiveErrors++;
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        
        // Enhanced error logging
        console.error(`[PAGINATION] Page ${pageNumber}: API request failed after ${requestTime}s:`, {
          url: `${this.apiBasePath}/job/all/`,
          params: params,
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
          message: axiosError.message,
          code: axiosError.code,
          consecutiveErrors: consecutiveErrors,
        });

        // If we have too many consecutive errors, stop pagination
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`[PAGINATION] Stopping pagination after ${consecutiveErrors} consecutive errors`);
          hasMore = false;
          break;
        }

        // For non-critical errors (like 429 rate limit), wait and retry
        if (axiosError.response?.status === 429) {
          const retryAfter = axiosError.response.headers['retry-after'] || 5;
          console.log(`[PAGINATION] Page ${pageNumber}: Rate limited, waiting ${retryAfter}s before next page`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        }

        // Skip this page and continue to next
        console.warn(`[PAGINATION] Page ${pageNumber}: Skipping page due to error, continuing to next page`);
        offset += recordsPerPage;
        if (offset > 10000) {
          console.warn('[PAGINATION] Reached safety limit of 10000 records, stopping pagination');
          hasMore = false;
        }
        continue;
      }

      // Log sample data structure on first page
      if (pageNumber === 1 && jobsData.length > 0) {
        console.log(`[PAGINATION] Page ${pageNumber}: Sample raw job structure from API:`, JSON.stringify(jobsData[0], null, 2));
      }

      // If no jobs returned, this is the last page
      if (jobsData.length === 0) {
        console.log(`[PAGINATION] Page ${pageNumber}: No jobs returned from API, stopping pagination`);
        hasMore = false;
        break;
      }

      // Normalize jobs
      const normalizeStartTime = Date.now();
      const normalizedJobs = jobsData
        .map((rawJob) => this.normalizeJob(rawJob))
        .filter((job): job is WorkizJob => job !== null);
      const normalizeTime = ((Date.now() - normalizeStartTime) / 1000).toFixed(2);

      console.log(`[PAGINATION] Page ${pageNumber}: Normalized ${normalizedJobs.length} jobs from ${jobsData.length} raw jobs (took ${normalizeTime}s)`);
      if (normalizedJobs.length < jobsData.length) {
        console.warn(`[PAGINATION] Page ${pageNumber}: Lost ${jobsData.length - normalizedJobs.length} jobs during normalization`);
      }

      allJobs.push(...normalizedJobs);

      // Log progress summary
      const pageTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
      console.log(`[PAGINATION] Page ${pageNumber}: Summary - offset=${offset}, received=${jobsData.length}, normalized=${normalizedJobs.length}, total_accumulated=${allJobs.length}, time=${pageTime}s`);

      // Check if we got fewer records than requested (last page)
      if (jobsData.length < recordsPerPage) {
        console.log(`[PAGINATION] Page ${pageNumber}: Received ${jobsData.length} < ${recordsPerPage} records, this is the last page`);
        hasMore = false;
      } else {
        // Continue to next page
        const previousOffset = offset;
        offset += recordsPerPage;
        console.log(`[PAGINATION] Page ${pageNumber}: Received full page (${jobsData.length} records), continuing to next page: offset ${previousOffset} -> ${offset}`);
        
        if (offset > 10000) {
          console.warn(`[PAGINATION] Page ${pageNumber}: Reached safety limit of 10000 records, stopping pagination`);
          hasMore = false;
        }
      }
      
      // Small delay to avoid rate limiting
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
        // Declare variables outside try block so they're accessible in catch
        let sourceId: number | undefined;
        let leadId: string | null = null;
        let clientId: string | null = null;
        let scheduledAt: Date | null = null;
        
        try {
          if (!job.id) {
            console.warn('Skipping job without ID:', JSON.stringify(job));
            skippedCount++;
            continue;
          }

          if (savedCount < 3) {
            console.log(`Saving job: id=${job.id}, date=${job.date}, type=${job.type}, source=${job.source}`);
          }

          // Get source_id from dim_source (will create 'workiz' if needed)
          try {
            sourceId = await this.getSourceId(job.source || 'workiz');
          } catch (error: any) {
            console.error(`Error getting source_id for job ${job.id}, source='${job.source}':`, error.message);
            throw error;
          }

          // Extract lead_id from raw_data if available (job might be converted from lead)
          if (job.raw_data) {
            const rawData = job.raw_data as any;
            leadId = rawData.LeadId || rawData.lead_id || rawData.LeadUUID || null;
          }

          // Extract scheduled_at from JobDateTime
          if (job.raw_data) {
            const rawData = job.raw_data as any;
            const jobDateTime = rawData.JobDateTime;
            if (jobDateTime) {
              scheduledAt = new Date(jobDateTime);
            }
          }

          // Extract client_id (convert to string if number, as DB column is VARCHAR)
          if (job.raw_data) {
            const rawData = job.raw_data as any;
            const rawClientId = rawData.ClientId;
            if (rawClientId !== null && rawClientId !== undefined) {
              clientId = String(rawClientId);
            }
          }

          // Extract new fields from raw_data
          let serialId: number | null = null;
          let technicianName: string | null = null;
          let jobAmountDue: number | null = null;
          let jobTotalPrice: number | null = null;
          let jobEndDateTime: Date | null = null;
          let lastStatusUpdate: Date | null = null;

          if (job.raw_data) {
            const rawData = job.raw_data as any;
            
            // SerialId
            if (rawData.SerialId !== null && rawData.SerialId !== undefined) {
              serialId = parseInt(String(rawData.SerialId), 10);
              if (isNaN(serialId)) serialId = null;
            }

            // TechnicianName from Team[0].Name
            if (rawData.Team && Array.isArray(rawData.Team) && rawData.Team.length > 0) {
              technicianName = rawData.Team[0].Name || null;
            }

            // JobAmountDue
            if (rawData.JobAmountDue !== null && rawData.JobAmountDue !== undefined) {
              jobAmountDue = parseFloat(String(rawData.JobAmountDue));
              if (isNaN(jobAmountDue)) jobAmountDue = null;
            }

            // JobTotalPrice
            if (rawData.JobTotalPrice !== null && rawData.JobTotalPrice !== undefined) {
              jobTotalPrice = parseFloat(String(rawData.JobTotalPrice));
              if (isNaN(jobTotalPrice)) jobTotalPrice = null;
            }

            // JobEndDateTime
            if (rawData.JobEndDateTime) {
              const parsedDate = new Date(rawData.JobEndDateTime);
              if (!isNaN(parsedDate.getTime())) {
                jobEndDateTime = parsedDate;
              }
            }

            // LastStatusUpdate - try different possible field names
            const statusUpdateValue = rawData.LastStatusUpdate || rawData.LastStatusChange || 
                                     rawData.StatusUpdate || rawData.status_updated_at ||
                                     rawData.UpdatedDate || rawData.updated_at;
            if (statusUpdateValue) {
              const parsedDate = new Date(statusUpdateValue);
              if (!isNaN(parsedDate.getTime())) {
                lastStatusUpdate = parsedDate;
              }
            }
          }

          const metaJson = job.raw_data ? JSON.stringify(job.raw_data) : null;
          const createdAt = job.date ? new Date(job.date) : new Date();

          await client.query(
            `INSERT INTO fact_jobs (
              job_id, lead_id, created_at, scheduled_at, source_id, type, client_id,
              serial_id, technician_name, job_amount_due, job_total_price,
              job_end_date_time, last_status_update, meta
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (job_id) 
             DO UPDATE SET 
               lead_id = EXCLUDED.lead_id,
               created_at = EXCLUDED.created_at,
               scheduled_at = EXCLUDED.scheduled_at,
               source_id = EXCLUDED.source_id,
               type = EXCLUDED.type,
               client_id = EXCLUDED.client_id,
               serial_id = EXCLUDED.serial_id,
               technician_name = EXCLUDED.technician_name,
               job_amount_due = EXCLUDED.job_amount_due,
               job_total_price = EXCLUDED.job_total_price,
               job_end_date_time = EXCLUDED.job_end_date_time,
               last_status_update = EXCLUDED.last_status_update,
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
              serialId,
              technicianName,
              jobAmountDue,
              jobTotalPrice,
              jobEndDateTime,
              lastStatusUpdate,
              metaJson,
            ]
          );

          savedCount++;
        } catch (dbError: any) {
          // Log first error in detail to help diagnose issues
          if (errors.length === 0) {
            console.error(`First error saving job ${job.id}:`, {
              jobId: job.id,
              error: dbError.message,
              code: dbError.code,
              detail: dbError.detail,
              hint: dbError.hint,
              position: dbError.position,
              jobData: {
                id: job.id,
                date: job.date,
                type: job.type,
                source: job.source,
                clientId: clientId,
                leadId: leadId,
                sourceId: sourceId,
              }
            });
          }
          console.error(`Error saving job ${job.id}:`, dbError.message);
          errors.push({ jobId: job.id, error: dbError.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');
      
      console.log(`Jobs save summary: ${savedCount} saved, ${skippedCount} skipped`);
      if (errors.length > 0) {
        console.warn(`Errors encountered (showing first 10):`, errors.slice(0, 10));
        if (errors.length > 10) {
          console.warn(`... and ${errors.length - 10} more errors`);
        }
      }
      
      if (savedCount === 0 && jobs.length > 0) {
        console.error('ERROR: No jobs were saved despite having jobs to save. Check errors above.');
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

