import axios from 'axios';
import pool from '../db/connection';

// Raw response from Workiz API
interface WorkizJobRaw {
  // Possible field names from API
  id?: string;
  unique_id?: string;
  UUID?: string;
  JobDateTime?: string;
  date?: string;
  created_at?: string;
  Type?: string;
  type?: string;
  JobType?: string;
  Source?: string;
  source?: string;
  Status?: string;
  status?: string;
  Unit?: string;
  unit?: string;
  RepairType?: string;
  repair_type?: string;
  Cost?: number;
  cost?: number;
  Revenue?: number;
  revenue?: number;
  TotalAmount?: number;
  total_amount?: number;
  [key: string]: any; // Allow any additional fields
}

// Normalized job interface for internal use (with raw data)
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
  raw_data?: any; // Full raw data from API
}

// Raw response from Workiz API for leads
interface WorkizLeadRaw {
  // Real API fields from /lead/all/ and /lead/get/{UUID}/
  UUID?: string;
  SerialId?: number;
  LeadDateTime?: string;
  LeadEndDateTime?: string;
  CreatedDate?: string;
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
  JobType?: string;
  ReferralCompany?: string;
  Timezone?: string;
  JobSource?: string; // This is the source field!
  LeadNotes?: string;
  Team?: Array<{ id: string; name: string }>;
  // Fallback field names for compatibility
  id?: string;
  lead_id?: string;
  source?: string;
  origin?: string;
  ad_source?: string;
  created_at?: string;
  updated_at?: string;
  job_id?: string;
  jobId?: string;
  client_phone?: string;
  phone?: string;
  client_name?: string;
  name?: string;
  [key: string]: any; // Allow any additional fields
}

// Normalized lead interface for internal use (with raw data)
interface WorkizLead {
  id: string;
  source?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  job_id?: string;
  client_phone?: string;
  client_name?: string;
  raw_data?: any; // Full raw data from API
}

interface WorkizPayment {
  id: string;
  job_id: string;
  amount: number;
  date: string;
  payment_type?: string;
}

interface WorkizCall {
  id: string;
  from_number?: string;
  to_number?: string;
  job_id?: string;
  started_at?: string;
  duration?: number;
  ad_source?: string;
  ad_group?: string;
}

export class WorkizService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private apiBasePath: string;

  constructor() {
    this.apiKey = process.env.WORKIZ_API_KEY || '';
    this.apiSecret = process.env.WORKIZ_API_SECRET || this.apiKey; // Fallback to apiKey if secret not provided
    this.baseUrl = process.env.WORKIZ_API_URL || 'https://api.workiz.com';
    
    if (!this.apiKey) {
      throw new Error('WORKIZ_API_KEY is required');
    }
    
    // Workiz API format: https://api.workiz.com/api/v1/{API_KEY}
    // For jobs: /job/all/ endpoint
    this.apiBasePath = `${this.baseUrl}/api/v1/${this.apiKey}`;
  }

  /**
   * Normalize raw Workiz API job data to our internal format
   * Preserves ALL raw data while extracting critical fields for queries
   */
  private normalizeJob(rawJob: WorkizJobRaw): WorkizJob | null {
    try {
      // Extract job ID (try multiple possible field names)
      // Real API uses: UUID
      const jobId = rawJob.UUID || rawJob.id || rawJob.unique_id;
      if (!jobId) {
        console.warn('Job missing ID field:', JSON.stringify(rawJob));
        return null;
      }

      // Extract date from JobDateTime (real API field)
      let jobDate: string;
      const dateValue = rawJob.JobDateTime || rawJob.date || rawJob.CreatedDate || rawJob.created_at;
      if (dateValue) {
        // Parse date string (format: "2025-12-23 14:00:00")
        if (typeof dateValue === 'string') {
          const datePart = dateValue.split(' ')[0]; // Take date part before space
          if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
            jobDate = datePart;
          } else {
            // Try to parse as Date
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

      // Extract type (real API uses: JobType)
      const jobType = rawJob.JobType || rawJob.Type || rawJob.type || null;

      // Extract source (real API uses: JobSource)
      const jobSource = rawJob.JobSource || rawJob.Source || rawJob.source || 'workiz';

      // Extract status (real API uses: Status)
      const jobStatus = rawJob.Status || rawJob.status || null;

      // Extract unit (real API uses: Unit)
      const jobUnit = rawJob.Unit || rawJob.unit || null;

      // Extract repair type (may not be in API, but keep for compatibility)
      // Could be derived from JobType if it contains "Repair"
      const repairType = rawJob.RepairType || rawJob.repair_type || 
                        (jobType && jobType.includes('Repair') ? jobType : null);

      // Extract cost (real API has: item_cost, tech_cost)
      // Total cost = item_cost + tech_cost
      const itemCost = rawJob.item_cost || 0;
      const techCost = rawJob.tech_cost || 0;
      const totalCost = itemCost + techCost;
      const costValue = totalCost > 0 ? totalCost : (rawJob.Cost || rawJob.cost || null);
      const costFinal = costValue !== null && costValue !== undefined ? parseFloat(String(costValue)) : null;

      // Extract revenue (real API uses: JobTotalPrice, SubTotal, JobAmountDue)
      // JobTotalPrice seems to be the main revenue field
      const revenue = rawJob.JobTotalPrice || rawJob.SubTotal || rawJob.JobAmountDue || 
                     rawJob.Revenue || rawJob.revenue || rawJob.TotalAmount || rawJob.total_amount || null;
      const revenueValue = revenue !== null && revenue !== undefined ? parseFloat(String(revenue)) : null;

      // Return normalized job WITH full raw data
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
        raw_data: rawJob, // Save ALL raw data
      };
    } catch (error) {
      console.error('Error normalizing job:', error, rawJob);
      return null;
    }
  }

  /**
   * Fetch jobs from Workiz API with pagination support
   */
  async fetchJobs(startDate: string, endDate?: string, onlyOpen: boolean = false): Promise<WorkizJob[]> {
    const allJobs: WorkizJob[] = [];
    let offset = 0;
    const recordsPerPage = 100; // Maximum allowed by API
    let hasMore = true;

    try {
      console.log(`Fetching jobs from Workiz API: start_date=${startDate}, end_date=${endDate || 'today'}, only_open=${onlyOpen}`);

      while (hasMore) {
        // Workiz API: GET /job/all/
        const params: any = {
          start_date: startDate,
          offset: offset,
          records: recordsPerPage,
          only_open: onlyOpen,
        };

        if (endDate) {
          // Note: API doesn't explicitly mention end_date, but we'll include it if provided
          // The API defaults to "until today" if not provided
        }

        console.log(`Fetching jobs page: offset=${offset}, records=${recordsPerPage}`);

        const response = await axios.get(`${this.apiBasePath}/job/all/`, {
          params,
        });

        // Handle different possible response structures
        let jobsData: WorkizJobRaw[] = [];
        if (Array.isArray(response.data)) {
          jobsData = response.data;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          jobsData = response.data.data;
        } else if (response.data?.jobs && Array.isArray(response.data.jobs)) {
          jobsData = response.data.jobs;
        } else if (response.data?.results && Array.isArray(response.data.results)) {
          jobsData = response.data.results;
        }

        console.log(`Received ${jobsData.length} jobs in this page`);

        // Log structure of first job for analysis (only once)
        if (offset === 0 && jobsData.length > 0) {
          console.log('Sample raw job structure from API:', JSON.stringify(jobsData[0], null, 2));
        }

        // Normalize and filter out invalid jobs
        const normalizedJobs = jobsData
          .map((rawJob) => this.normalizeJob(rawJob))
          .filter((job): job is WorkizJob => job !== null);

        allJobs.push(...normalizedJobs);

        // Check if we need to fetch more pages
        if (jobsData.length < recordsPerPage) {
          hasMore = false;
        } else {
          offset += recordsPerPage;
          // Safety limit to prevent infinite loops
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
        url: error.config?.url,
        params: error.config?.params,
      });
      return allJobs; // Return what we have so far
    }
  }

  /**
   * Fetch a single job by UUID
   */
  async fetchJobByUuid(uuid: string): Promise<WorkizJob | null> {
    try {
      console.log(`Fetching job by UUID: ${uuid}`);
      
      // Workiz API: GET /job/get/{UUID}/
      const response = await axios.get(`${this.apiBasePath}/job/get/${uuid}/`);

      // Handle different possible response structures
      let jobData: WorkizJobRaw;
      if (response.data && typeof response.data === 'object') {
        // API might return data wrapped in 'data' field
        jobData = response.data.data || response.data;
        
        // Log full structure for analysis
        console.log('Full job structure from API:', JSON.stringify(jobData, null, 2));
      } else {
        console.warn('Unexpected response format for job:', response.data);
        return null;
      }

      const normalizedJob = this.normalizeJob(jobData);
      if (normalizedJob) {
        console.log(`Successfully fetched job: ${normalizedJob.id}`);
        console.log(`Raw data contains ${Object.keys(normalizedJob.raw_data || {}).length} fields`);
      }
      return normalizedJob;
    } catch (error: any) {
      console.error('Error fetching Workiz job by UUID:', {
        uuid,
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return null;
    }
  }

  /**
   * Validate job data before saving
   */
  private validateJob(job: WorkizJob): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!job.id || job.id.trim() === '') {
      errors.push('Job ID is required');
    }

    if (!job.date) {
      errors.push('Job date is required');
    } else {
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(job.date)) {
        errors.push(`Invalid date format: ${job.date} (expected YYYY-MM-DD)`);
      }
    }

    // Validate numeric fields
    if (job.cost !== null && job.cost !== undefined && isNaN(Number(job.cost))) {
      errors.push(`Invalid cost value: ${job.cost}`);
    }

    if (job.revenue !== null && job.revenue !== undefined && isNaN(Number(job.revenue))) {
      errors.push(`Invalid revenue value: ${job.revenue}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async saveJobs(jobs: WorkizJob[]): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ jobId: string; error: string }> = [];

      for (const job of jobs) {
        // Validate job data
        const validation = this.validateJob(job);
        if (!validation.valid) {
          console.warn(`Skipping invalid job ${job.id}:`, validation.errors);
          errors.push({ jobId: job.id, error: validation.errors.join(', ') });
          skippedCount++;
          continue;
        }

        try {
          // Determine segment from type
          const segment = job.type?.includes('COD') ? 'COD' 
            : job.type?.includes('INS') ? 'INS' 
            : 'OTHER';

          // Log detailed information for debugging (only first few to avoid spam)
          if (savedCount < 3) {
            console.log(`Saving job: id=${job.id}, date=${job.date}, type=${job.type}, source=${job.source}, segment=${segment}`);
            if (job.raw_data) {
              console.log(`Raw data keys:`, Object.keys(job.raw_data).join(', '));
            }
          }

          // Prepare raw_data JSON
          const rawDataJson = job.raw_data ? JSON.stringify(job.raw_data) : null;

          await client.query(
            `INSERT INTO jobs (job_id, date, type, source, segment, unit, repair_type, cost, revenue, status, raw_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (job_id) 
             DO UPDATE SET 
               date = EXCLUDED.date,
               type = EXCLUDED.type,
               source = EXCLUDED.source,
               segment = EXCLUDED.segment,
               unit = EXCLUDED.unit,
               repair_type = EXCLUDED.repair_type,
               cost = EXCLUDED.cost,
               revenue = EXCLUDED.revenue,
               status = EXCLUDED.status,
               raw_data = EXCLUDED.raw_data,
               updated_at = CURRENT_TIMESTAMP`,
            [
              job.id,
              job.date,
              job.type || null,
              job.source || 'workiz',
              segment,
              job.unit || null,
              job.repair_type || null,
              job.cost !== null && job.cost !== undefined ? Number(job.cost) : null,
              job.revenue !== null && job.revenue !== undefined ? Number(job.revenue) : null,
              job.status || null,
              rawDataJson,
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
        console.warn(`Errors encountered:`, errors.slice(0, 10)); // Log first 10 errors
        if (errors.length > 10) {
          console.warn(`... and ${errors.length - 10} more errors`);
        }
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving Workiz jobs:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async syncJobs(): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch all jobs (including closed ones) for complete data
    const jobs = await this.fetchJobs(startDate, endDate, false);
    await this.saveJobs(jobs);
  }

  // ========== LEADS SYNC ==========
  
  /**
   * Normalize raw Workiz API lead data to our internal format
   * Preserves ALL raw data while extracting critical fields for queries
   */
  private normalizeLead(rawLead: WorkizLeadRaw): WorkizLead | null {
    try {
      // Extract lead ID (real API uses: UUID)
      const leadId = rawLead.UUID || rawLead.id || rawLead.lead_id;
      if (!leadId) {
        console.warn('Lead missing ID field:', JSON.stringify(rawLead));
        return null;
      }

      // Extract source (real API uses: JobSource)
      const leadSource = rawLead.JobSource || rawLead.source || rawLead.origin || rawLead.ReferralCompany || 'Unknown';

      // Extract status (real API uses: Status)
      const leadStatus = rawLead.Status || rawLead.status || rawLead.current_status || 'New';

      // Extract created_at (real API uses: CreatedDate or LeadDateTime)
      const createdAt = rawLead.CreatedDate || rawLead.LeadDateTime || rawLead.created_at || new Date().toISOString();

      // Extract updated_at (real API uses: LeadEndDateTime or CreatedDate)
      const updatedAt = rawLead.LeadEndDateTime || rawLead.UpdatedDate || rawLead.updated_at || createdAt;

      // Extract job_id (may not be present for leads that haven't converted)
      const jobId = rawLead.job_id || rawLead.jobId || rawLead.JobId || null;

      // Extract phone (real API uses: Phone)
      const phone = rawLead.Phone || rawLead.phone || rawLead.client_phone || null;

      // Extract client name (real API uses: FirstName + LastName)
      const firstName = rawLead.FirstName || '';
      const lastName = rawLead.LastName || '';
      const clientName = (firstName + ' ' + lastName).trim() || rawLead.name || rawLead.client_name || null;

      // Return normalized lead WITH full raw data
      return {
        id: String(leadId),
        source: leadSource,
        status: leadStatus,
        created_at: createdAt,
        updated_at: updatedAt,
        job_id: jobId || undefined,
        client_phone: phone || undefined,
        client_name: clientName || undefined,
        raw_data: rawLead, // Save ALL raw data
      };
    } catch (error) {
      console.error('Error normalizing lead:', error, rawLead);
      return null;
    }
  }

  /**
   * Fetch leads from Workiz API with pagination support
   */
  async fetchLeads(startDate?: string, endDate?: string, onlyOpen: boolean = true): Promise<WorkizLead[]> {
    const allLeads: WorkizLead[] = [];
    let offset = 0;
    const recordsPerPage = 100; // Maximum allowed by API
    let hasMore = true;

    try {
      console.log(`Fetching leads from Workiz API: start_date=${startDate || 'not set'}, end_date=${endDate || 'not set'}, only_open=${onlyOpen}`);

      while (hasMore) {
        // Workiz API: GET /lead/all/
        const params: any = {
          offset: offset,
          records: recordsPerPage,
          only_open: onlyOpen,
        };

        if (startDate) {
          params.start_date = startDate;
        }

        if (endDate) {
          // Note: API doesn't explicitly mention end_date, but we'll include it if provided
        }

        console.log(`Fetching leads page: offset=${offset}, records=${recordsPerPage}`);

        const response = await axios.get(`${this.apiBasePath}/lead/all/`, {
          params,
        });

        // Handle different possible response structures
        let leadsData: WorkizLeadRaw[] = [];
        if (Array.isArray(response.data)) {
          leadsData = response.data;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          leadsData = response.data.data;
        } else if (response.data?.leads && Array.isArray(response.data.leads)) {
          leadsData = response.data.leads;
        } else if (response.data?.results && Array.isArray(response.data.results)) {
          leadsData = response.data.results;
        }

        console.log(`Received ${leadsData.length} leads in this page`);

        // Log structure of first lead for analysis (only once)
        if (offset === 0 && leadsData.length > 0) {
          console.log('Sample raw lead structure from API:', JSON.stringify(leadsData[0], null, 2));
        }

        // Normalize and filter out invalid leads
        const normalizedLeads = leadsData
          .map((rawLead) => this.normalizeLead(rawLead))
          .filter((lead): lead is WorkizLead => lead !== null);

        allLeads.push(...normalizedLeads);

        // Check if we need to fetch more pages
        if (leadsData.length < recordsPerPage) {
          hasMore = false;
        } else {
          offset += recordsPerPage;
          
          // Safety limit to prevent infinite loops
          if (offset > 10000) {
            console.warn('Reached safety limit of 10000 records, stopping pagination');
            hasMore = false;
          }
        }
      }

      console.log(`Total leads fetched: ${allLeads.length}`);
      return allLeads;
    } catch (error: any) {
      console.error('Error fetching Workiz leads:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
        params: error.config?.params,
      });
      return allLeads; // Return what we have so far
    }
  }

  /**
   * Fetch a single lead by UUID
   */
  async fetchLeadByUuid(uuid: string): Promise<WorkizLead | null> {
    try {
      console.log(`Fetching lead by UUID: ${uuid}`);
      
      // Workiz API: GET /lead/get/{UUID}/
      const response = await axios.get(`${this.apiBasePath}/lead/get/${uuid}/`);

      // Handle different possible response structures
      let leadData: WorkizLeadRaw;
      if (response.data && typeof response.data === 'object') {
        // API might return data wrapped in 'data' field
        leadData = response.data.data || response.data;
        
        // Log full structure for analysis
        console.log('Full lead structure from API:', JSON.stringify(leadData, null, 2));
      } else {
        console.warn('Unexpected response format for lead:', response.data);
        return null;
      }

      const normalizedLead = this.normalizeLead(leadData);
      if (normalizedLead) {
        console.log(`Successfully fetched lead: ${normalizedLead.id}`);
        console.log(`Raw data contains ${Object.keys(normalizedLead.raw_data || {}).length} fields`);
      }
      return normalizedLead;
    } catch (error: any) {
      console.error('Error fetching Workiz lead by UUID:', {
        uuid,
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      return null;
    }
  }

  async saveLeads(leads: WorkizLead[]): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ leadId: string; error: string }> = [];

      for (const lead of leads) {
        try {
          // Validate required fields
          if (!lead.id) {
            console.warn('Skipping lead without ID:', JSON.stringify(lead));
            skippedCount++;
            continue;
          }

          // Log detailed information for debugging (only first few to avoid spam)
          if (savedCount < 3) {
            console.log(`Saving lead: id=${lead.id}, source=${lead.source}, status=${lead.status}`);
            if (lead.raw_data) {
              console.log(`Raw data keys:`, Object.keys(lead.raw_data).join(', '));
            }
          }

          // Prepare raw_payload JSON
          const rawPayloadJson = lead.raw_data ? JSON.stringify(lead.raw_data) : null;

          // Convert dates to proper format
          const createdAt = lead.created_at ? new Date(lead.created_at) : new Date();
          const updatedAt = lead.updated_at ? new Date(lead.updated_at) : createdAt;

          await client.query(
            `INSERT INTO leads (
              lead_id, source, status, created_at, updated_at, 
              job_id, client_phone, client_name, raw_payload
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (lead_id) 
             DO UPDATE SET 
               source = EXCLUDED.source,
               status = EXCLUDED.status,
               updated_at = EXCLUDED.updated_at,
               job_id = EXCLUDED.job_id,
               client_phone = EXCLUDED.client_phone,
               client_name = EXCLUDED.client_name,
               raw_payload = EXCLUDED.raw_payload,
               updated_at_db = CURRENT_TIMESTAMP`,
            [
              lead.id,
              lead.source || 'Unknown',
              lead.status || 'New',
              createdAt,
              updatedAt,
              lead.job_id || null,
              lead.client_phone || null,
              lead.client_name || null,
              rawPayloadJson,
            ]
          );

          savedCount++;
        } catch (dbError: any) {
          console.error(`Error saving lead ${lead.id}:`, dbError.message);
          errors.push({ leadId: lead.id, error: dbError.message });
          skippedCount++;
        }
      }

      await client.query('COMMIT');
      
      console.log(`Leads save summary: ${savedCount} saved, ${skippedCount} skipped`);
      if (errors.length > 0) {
        console.warn(`Errors encountered:`, errors.slice(0, 10)); // Log first 10 errors
        if (errors.length > 10) {
          console.warn(`... and ${errors.length - 10} more errors`);
        }
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving Workiz leads:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async syncLeads(): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch all leads (including closed ones) for complete data
    const leads = await this.fetchLeads(startDate, endDate, false);
    await this.saveLeads(leads);
  }

  // ========== PAYMENTS SYNC ==========

  async fetchPayments(startDate: string, endDate: string): Promise<WorkizPayment[]> {
    try {
      // Workiz API: GET /api/v1/{API_KEY}/payments
      const response = await axios.get(`${this.apiBasePath}/payments`, {
        params: {
          start_date: startDate,
          end_date: endDate,
          updated_at: startDate, // Use updated_at for incremental sync
        },
      });

      return response.data.data || response.data.payments || [];
    } catch (error: any) {
      console.error('Error fetching Workiz payments:', error.response?.data || error.message);
      return [];
    }
  }

  async savePayments(payments: WorkizPayment[]): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      for (const payment of payments) {
        await client.query(
          `INSERT INTO payments (payment_id, job_id, date, amount, payment_type, source)
           VALUES ($1, $2, $3, $4, $5, 'workiz')
           ON CONFLICT (payment_id) 
           DO UPDATE SET 
             job_id = EXCLUDED.job_id,
             date = EXCLUDED.date,
             amount = EXCLUDED.amount,
             payment_type = EXCLUDED.payment_type,
             updated_at = CURRENT_TIMESTAMP`,
          [
            payment.id,
            payment.job_id,
            payment.date,
            payment.amount,
            payment.payment_type || null,
          ]
        );
      }

      await client.query('COMMIT');
      console.log(`Saved ${payments.length} payments from Workiz`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving Workiz payments:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async syncPayments(): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const payments = await this.fetchPayments(startDate, endDate);
    await this.savePayments(payments);
  }

  // ========== CALLS SYNC (OPTIONAL) ==========

  async fetchCalls(startDate: string, endDate: string): Promise<WorkizCall[]> {
    try {
      // Workiz API: GET /api/v1/{API_KEY}/calls
      const response = await axios.get(`${this.apiBasePath}/calls`, {
        params: {
          start_date: startDate,
          end_date: endDate,
          updated_at: startDate, // Use updated_at for incremental sync
        },
      });

      return response.data.data || response.data.calls || [];
    } catch (error: any) {
      console.error('Error fetching Workiz calls:', error.response?.data || error.message);
      return [];
    }
  }

  async saveCalls(calls: WorkizCall[]): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      for (const call of calls) {
        const callDate = call.started_at 
          ? new Date(call.started_at).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];
        
        const source = call.ad_source || call.ad_group || 'workiz';

        await client.query(
          `INSERT INTO calls (call_id, date, duration, call_type, source)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (call_id) 
           DO UPDATE SET 
             date = EXCLUDED.date,
             duration = EXCLUDED.duration,
             call_type = EXCLUDED.call_type,
             source = EXCLUDED.source,
             updated_at = CURRENT_TIMESTAMP`,
          [
            call.id,
            callDate,
            call.duration || null,
            call.ad_source ? 'ad' : 'regular',
            source,
          ]
        );
      }

      await client.query('COMMIT');
      console.log(`Saved ${calls.length} calls from Workiz`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving Workiz calls:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async syncCalls(): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const calls = await this.fetchCalls(startDate, endDate);
    await this.saveCalls(calls);
  }
}

