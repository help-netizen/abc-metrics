import axios from 'axios';
import pool from '../db/connection';
import { NormalizationService } from './normalization.service';

// Raw response from Workiz API
interface WorkizJobRaw {
  UUID?: string;
  LocationId?: number;
  LocationKey?: string;
  SerialId?: number;
  JobDateTime?: string;
  JobEndDateTime?: string;
  CreatedDate?: string;
  JobTotalPrice?: number | string;
  JobAmountDue?: number | string;
  SubTotal?: number | string;
  item_cost?: number | string;
  tech_cost?: number | string;
  ClientId?: number;
  Status?: string;
  SubStatus?: string;
  PaymentDueDate?: string;
  Phone?: string;
  SecondPhone?: string;
  PhoneExt?: string;
  SecondPhoneExt?: string;
  Email?: string;
  Comments?: string;
  FirstName?: string;
  LastName?: string;
  Company?: string;
  Address?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
  Unit?: string;
  Latitude?: string;
  Longitude?: string;
  ServiceArea?: string;
  JobType?: string;
  JobSource?: string;
  JobNotes?: string;
  ReferralCompany?: string;
  Timezone?: string;
  CreatedBy?: string;
  LastStatusUpdate?: string;
  Tags?: string[];
  Team?: Array<{ id: number | string; Name: string; name?: string }>;
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
      const normalizedDate = NormalizationService.date(dateValue);

      if (normalizedDate) {
        jobDate = normalizedDate;
      } else {
        console.warn(`Job ${jobId} missing or invalid date field, using today`);
        jobDate = new Date().toISOString().split('T')[0];
      }

      const jobType = rawJob.JobType || rawJob.Type || rawJob.type || null;
      const jobSource = rawJob.JobSource || rawJob.Source || rawJob.source || 'workiz';
      const jobStatus = rawJob.Status || rawJob.status || null;
      const jobUnit = rawJob.Unit || rawJob.unit || null;
      const repairType = rawJob.RepairType || rawJob.repair_type ||
        (jobType && jobType.includes('Repair') ? jobType : null);

      const itemCost = typeof rawJob.item_cost === 'number' ? rawJob.item_cost : parseFloat(String(rawJob.item_cost || 0));
      const techCost = typeof rawJob.tech_cost === 'number' ? rawJob.tech_cost : parseFloat(String(rawJob.tech_cost || 0));
      const totalCost = (isNaN(itemCost) ? 0 : itemCost) + (isNaN(techCost) ? 0 : techCost);
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
        raw_data: NormalizationService.normalizeObjectPhoneFields({ ...rawJob }),
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

          // Contact Information
          let phone: string | null = null;
          let secondPhone: string | null = null;
          let phoneExt: string | null = null;
          let secondPhoneExt: string | null = null;
          let email: string | null = null;
          let firstName: string | null = null;
          let lastName: string | null = null;
          let company: string | null = null;

          // Address Information
          let address: string | null = null;
          let city: string | null = null;
          let state: string | null = null;
          let postalCode: string | null = null;
          let country: string | null = null;
          let latitude: string | null = null;
          let longitude: string | null = null;

          // Job Details
          let subTotal: number | null = null;
          let itemCost: number | null = null;
          let techCost: number | null = null;
          let subStatus: string | null = null;
          let paymentDueDate: Date | null = null;
          let jobNotes: string | null = null;
          let comments: string | null = null;
          let timezone: string | null = null;
          let referralCompany: string | null = null;
          let serviceArea: string | null = null;
          let createdBy: string | null = null;
          let tags: any = null;
          let team: any = null;

          if (job.raw_data) {
            const rawData = job.raw_data as any;

            // SerialId
            if (rawData.SerialId !== null && rawData.SerialId !== undefined) {
              serialId = parseInt(String(rawData.SerialId), 10);
              if (isNaN(serialId)) serialId = null;
            }

            // TechnicianName from Team[0].Name
            if (rawData.Team && Array.isArray(rawData.Team) && rawData.Team.length > 0) {
              technicianName = rawData.Team[0].Name || rawData.Team[0].name || null;
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
              const normalized = NormalizationService.dateTime(rawData.JobEndDateTime);
              if (normalized) {
                jobEndDateTime = new Date(normalized);
              }
            }

            // LastStatusUpdate
            const statusUpdateValue = rawData.LastStatusUpdate || rawData.LastStatusChange ||
              rawData.StatusUpdate || rawData.status_updated_at ||
              rawData.UpdatedDate || rawData.updated_at;
            if (statusUpdateValue) {
              const normalized = NormalizationService.dateTime(statusUpdateValue);
              if (normalized) {
                lastStatusUpdate = new Date(normalized);
              }
            }

            // Contact Information
            phone = NormalizationService.phone(rawData.Phone) || null;
            secondPhone = NormalizationService.phone(rawData.SecondPhone) || null;
            phoneExt = rawData.PhoneExt || null;
            secondPhoneExt = rawData.SecondPhoneExt || null;
            email = rawData.Email || null;
            firstName = rawData.FirstName || null;
            lastName = rawData.LastName || null;
            company = rawData.Company || null;

            // Address Information
            address = rawData.Address || null;
            city = rawData.City || null;
            state = rawData.State || null;
            postalCode = NormalizationService.zip(rawData.PostalCode) || null;
            country = rawData.Country || null;
            latitude = rawData.Latitude || null;
            longitude = rawData.Longitude || null;

            // Job Details
            if (rawData.SubTotal !== null && rawData.SubTotal !== undefined) {
              subTotal = parseFloat(String(rawData.SubTotal));
              if (isNaN(subTotal)) subTotal = null;
            }
            if (rawData.item_cost !== null && rawData.item_cost !== undefined) {
              itemCost = parseFloat(String(rawData.item_cost));
              if (isNaN(itemCost)) itemCost = null;
            }
            if (rawData.tech_cost !== null && rawData.tech_cost !== undefined) {
              techCost = parseFloat(String(rawData.tech_cost));
              if (isNaN(techCost)) techCost = null;
            }
            subStatus = rawData.SubStatus || null;
            if (rawData.PaymentDueDate) {
              const normalized = NormalizationService.dateTime(rawData.PaymentDueDate);
              if (normalized) {
                paymentDueDate = new Date(normalized);
              }
            }
            jobNotes = rawData.JobNotes || null;
            comments = rawData.Comments || null;
            timezone = rawData.Timezone || null;
            referralCompany = rawData.ReferralCompany || null;
            serviceArea = rawData.ServiceArea || null;
            createdBy = rawData.CreatedBy || null;
            tags = rawData.Tags ? JSON.stringify(rawData.Tags) : null;
            team = rawData.Team ? JSON.stringify(rawData.Team) : null;
          }

          const metaJson = job.raw_data ? JSON.stringify(job.raw_data) : null;
          const normalizedDate = NormalizationService.date(job.date);
          const createdAt = normalizedDate ? new Date(normalizedDate) : new Date();

          await client.query(
            `INSERT INTO fact_jobs (
              job_id, lead_id, created_at, scheduled_at, source_id, type, client_id,
              serial_id, technician_name, job_amount_due, job_total_price,
              job_end_date_time, last_status_update,
              phone, second_phone, phone_ext, second_phone_ext, email, first_name, last_name, company,
              address, city, state, postal_code, country, latitude, longitude,
              sub_total, item_cost, tech_cost, sub_status, payment_due_date,
              job_notes, comments, timezone, referral_company, service_area, created_by,
              tags, team, meta, import_source
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43)
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
               phone = EXCLUDED.phone,
               second_phone = EXCLUDED.second_phone,
               phone_ext = EXCLUDED.phone_ext,
               second_phone_ext = EXCLUDED.second_phone_ext,
               email = EXCLUDED.email,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               company = EXCLUDED.company,
               address = EXCLUDED.address,
               city = EXCLUDED.city,
               state = EXCLUDED.state,
               postal_code = EXCLUDED.postal_code,
               country = EXCLUDED.country,
               latitude = EXCLUDED.latitude,
               longitude = EXCLUDED.longitude,
               sub_total = EXCLUDED.sub_total,
               item_cost = EXCLUDED.item_cost,
               tech_cost = EXCLUDED.tech_cost,
               sub_status = EXCLUDED.sub_status,
               payment_due_date = EXCLUDED.payment_due_date,
               job_notes = EXCLUDED.job_notes,
               comments = EXCLUDED.comments,
               timezone = EXCLUDED.timezone,
               referral_company = EXCLUDED.referral_company,
               service_area = EXCLUDED.service_area,
               created_by = EXCLUDED.created_by,
               tags = EXCLUDED.tags,
               team = EXCLUDED.team,
               meta = EXCLUDED.meta,
               import_source = EXCLUDED.import_source,
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
              phone,
              secondPhone,
              phoneExt,
              secondPhoneExt,
              email,
              firstName,
              lastName,
              company,
              address,
              city,
              state,
              postalCode,
              country,
              latitude,
              longitude,
              subTotal,
              itemCost,
              techCost,
              subStatus,
              paymentDueDate,
              jobNotes,
              comments,
              timezone,
              referralCompany,
              serviceArea,
              createdBy,
              tags,
              team,
              metaJson,
              'api'
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

