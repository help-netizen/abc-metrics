import axios from 'axios';
import pool from '../db/connection';
import crypto from 'crypto';

// Raw response from Workiz API for leads
interface WorkizLeadRaw {
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
  [key: string]: any;
}

// Normalized lead interface
interface WorkizLead {
  id: string;
  source?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  job_id?: string;
  client_phone?: string;
  client_name?: string;
  raw_data?: any;
}

export class SvcWorkizLeads {
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
  private async getSourceId(sourceCode: string): Promise<number> {
    const client = await pool.connect();
    try {
      if (!sourceCode || sourceCode.trim() === '') {
        sourceCode = 'workiz';
      }

      // Normalize source code
      const normalizedCode = sourceCode.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');

      // Try to find by normalized code
      const result = await client.query(
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
   * Normalize phone number and create hash
   */
  private normalizePhoneHash(phone: string | null | undefined): string | null {
    if (!phone) return null;
    
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');
    
    // If empty after normalization, return null
    if (!digits) return null;
    
    // Create hash
    return crypto.createHash('sha256').update(digits).digest('hex');
  }

  /**
   * Normalize raw Workiz API lead data
   */
  private normalizeLead(rawLead: WorkizLeadRaw): WorkizLead | null {
    try {
      const leadId = rawLead.UUID || rawLead.id || rawLead.lead_id;
      if (!leadId) {
        console.warn('Lead missing ID field:', JSON.stringify(rawLead));
        return null;
      }

      const leadSource = rawLead.JobSource || rawLead.source || rawLead.origin || rawLead.ReferralCompany || 'Unknown';
      const leadStatus = rawLead.Status || rawLead.status || rawLead.current_status || 'New';
      const createdAt = rawLead.CreatedDate || rawLead.LeadDateTime || rawLead.created_at || new Date().toISOString();
      const updatedAt = rawLead.LeadEndDateTime || rawLead.UpdatedDate || rawLead.updated_at || createdAt;
      const jobId = rawLead.job_id || rawLead.jobId || rawLead.JobId || null;
      const phone = rawLead.Phone || rawLead.phone || rawLead.client_phone || null;
      const firstName = rawLead.FirstName || '';
      const lastName = rawLead.LastName || '';
      const clientName = (firstName + ' ' + lastName).trim() || rawLead.name || rawLead.client_name || null;

      return {
        id: String(leadId),
        source: leadSource,
        status: leadStatus,
        created_at: createdAt,
        updated_at: updatedAt,
        job_id: jobId || undefined,
        client_phone: phone || undefined,
        client_name: clientName || undefined,
        raw_data: rawLead,
      };
    } catch (error) {
      console.error('Error normalizing lead:', error, rawLead);
      return null;
    }
  }

  /**
   * Fetch leads from Workiz API with pagination
   * Workiz API endpoint: /lead/all/
   * Parameters: start_date (optional, uses start_date until today), offset (default 0), records (default 100, max 100), only_open (default true)
   * Note: end_date is NOT supported by Workiz API - it uses start_date until today
   */
  async fetchLeads(startDate?: string, endDate?: string, onlyOpen: boolean = true): Promise<WorkizLead[]> {
    const allLeads: WorkizLead[] = [];
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
    
    console.log(`[PAGINATION] Starting leads fetch: start_date=${startDate || 'not set'}, only_open=${onlyOpen}, records_per_page=${recordsPerPage}`);

    while (hasMore) {
      pageNumber++;
      const pageStartTime = Date.now();
      
      const params: any = {
        offset: offset,
        records: recordsPerPage, // Workiz API uses 'records' not 'limit'
      };

      if (startDate) {
        params.start_date = startDate;
      }
      
      if (onlyOpen) {
        params.only_open = onlyOpen;
      }

      console.log(`[PAGINATION] Page ${pageNumber}: Fetching leads - offset=${offset}, records=${recordsPerPage}`);
      console.log(`[PAGINATION] Page ${pageNumber}: Request URL: ${this.apiBasePath}/lead/all/`);
      console.log(`[PAGINATION] Page ${pageNumber}: Request params:`, JSON.stringify(params, null, 2));

      // Workiz API: GET /api/v1/{API_KEY}/lead/all/
      let response;
      let leadsData: WorkizLeadRaw[] = [];
      
      try {
        response = await axios.get(`${this.apiBasePath}/lead/all/`, { params });
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        console.log(`[PAGINATION] Page ${pageNumber}: API request completed in ${requestTime}s, status=${response.status}`);
        
        // Log response structure for debugging
        if (pageNumber === 1) {
          console.log(`[PAGINATION] Page ${pageNumber}: Response structure:`, {
            isArray: Array.isArray(response.data),
            hasData: !!response.data?.data,
            hasLeads: !!response.data?.leads,
            keys: response.data ? Object.keys(response.data) : [],
          });
        }

        // Parse response data - handle different possible structures
        if (Array.isArray(response.data)) {
          leadsData = response.data;
          console.log(`[PAGINATION] Page ${pageNumber}: Response is direct array`);
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          leadsData = response.data.data;
          console.log(`[PAGINATION] Page ${pageNumber}: Response has data.data array`);
        } else if (response.data?.leads && Array.isArray(response.data.leads)) {
          leadsData = response.data.leads;
          console.log(`[PAGINATION] Page ${pageNumber}: Response has data.leads array`);
        } else {
          console.warn(`[PAGINATION] Page ${pageNumber}: Unexpected response structure:`, {
            type: typeof response.data,
            isArray: Array.isArray(response.data),
            keys: response.data ? Object.keys(response.data) : [],
            sample: JSON.stringify(response.data).substring(0, 200),
          });
        }

        console.log(`[PAGINATION] Page ${pageNumber}: Received ${leadsData.length} leads from API`);

        // Reset error counter on successful request
        consecutiveErrors = 0;

      } catch (axiosError: any) {
        consecutiveErrors++;
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        
        // Enhanced error logging
        console.error(`[PAGINATION] Page ${pageNumber}: API request failed after ${requestTime}s:`, {
          url: `${this.apiBasePath}/lead/all/`,
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
      if (pageNumber === 1 && leadsData.length > 0) {
        console.log(`[PAGINATION] Page ${pageNumber}: Sample raw lead structure from API:`, JSON.stringify(leadsData[0], null, 2));
      }

      // If no leads returned, this is the last page
      if (leadsData.length === 0) {
        console.log(`[PAGINATION] Page ${pageNumber}: No leads returned from API, stopping pagination`);
        hasMore = false;
        break;
      }

      // Normalize leads
      const normalizeStartTime = Date.now();
      const normalizedLeads = leadsData
        .map((rawLead) => this.normalizeLead(rawLead))
        .filter((lead): lead is WorkizLead => lead !== null);
      const normalizeTime = ((Date.now() - normalizeStartTime) / 1000).toFixed(2);

      console.log(`[PAGINATION] Page ${pageNumber}: Normalized ${normalizedLeads.length} leads from ${leadsData.length} raw leads (took ${normalizeTime}s)`);
      if (normalizedLeads.length < leadsData.length) {
        console.warn(`[PAGINATION] Page ${pageNumber}: Lost ${leadsData.length - normalizedLeads.length} leads during normalization`);
      }

      allLeads.push(...normalizedLeads);

      // Log progress summary
      const pageTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
      console.log(`[PAGINATION] Page ${pageNumber}: Summary - offset=${offset}, received=${leadsData.length}, normalized=${normalizedLeads.length}, total_accumulated=${allLeads.length}, time=${pageTime}s`);

      // Check if we got fewer records than requested (last page)
      if (leadsData.length < recordsPerPage) {
        console.log(`[PAGINATION] Page ${pageNumber}: Received ${leadsData.length} < ${recordsPerPage} records, this is the last page`);
        hasMore = false;
      } else {
        // Continue to next page
        const previousOffset = offset;
        offset += recordsPerPage;
        console.log(`[PAGINATION] Page ${pageNumber}: Received full page (${leadsData.length} records), continuing to next page: offset ${previousOffset} -> ${offset}`);
        
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

    console.log(`[PAGINATION] Completed: Total pages=${pageNumber}, total leads fetched=${allLeads.length}`);
    if (allLeads.length === 0) {
      console.warn('[PAGINATION] WARNING: No leads were fetched from Workiz API. Check API credentials and date range.');
    } else {
      console.log(`[PAGINATION] Successfully fetched ${allLeads.length} leads across ${pageNumber} page(s)`);
    }
    return allLeads;
  }

  /**
   * Save leads to fact_leads table
   * Uses ON CONFLICT DO UPDATE to ensure idempotent syncs - can run hourly without duplicates
   */
  async saveLeads(leads: WorkizLead[]): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let savedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ leadId: string; error: string }> = [];

      for (const lead of leads) {
        try {
          if (!lead.id) {
            console.warn('Skipping lead without ID:', JSON.stringify(lead));
            skippedCount++;
            continue;
          }

          if (savedCount < 3) {
            console.log(`Saving lead: id=${lead.id}, source=${lead.source}, status=${lead.status}`);
          }

          // Get source_id from dim_source
          const sourceId = await this.getSourceId(lead.source || 'workiz');
          
          // Normalize phone hash
          const phoneHash = this.normalizePhoneHash(lead.client_phone);

          // Calculate cost (for paid channels)
          let cost = 0;
          const sourceCode = (lead.source || '').toLowerCase();
          if (sourceCode.includes('pro_referral') || sourceCode.includes('pro referral')) {
            // Pro Referral: $20 per lead if status != 'Passed'
            if (lead.status && lead.status !== 'Passed') {
              cost = 20;
            }
          }

          const rawPayloadJson = lead.raw_data ? JSON.stringify(lead.raw_data) : null;
          const createdAt = lead.created_at ? new Date(lead.created_at) : new Date();
          const updatedAt = lead.updated_at ? new Date(lead.updated_at) : createdAt;

          await client.query(
            `INSERT INTO fact_leads (
              lead_id, created_at, source_id, phone_hash, raw_source, cost, meta
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (lead_id) 
             DO UPDATE SET 
               created_at = EXCLUDED.created_at,
               source_id = EXCLUDED.source_id,
               phone_hash = EXCLUDED.phone_hash,
               raw_source = EXCLUDED.raw_source,
               cost = EXCLUDED.cost,
               meta = EXCLUDED.meta,
               updated_at_db = CURRENT_TIMESTAMP`,
            [
              lead.id,
              createdAt,
              sourceId,
              phoneHash,
              lead.source || 'Unknown',
              cost,
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
        console.warn(`Errors encountered:`, errors.slice(0, 10));
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving Workiz leads:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync leads (fetch and save)
   */
  async syncLeads(): Promise<void> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const leads = await this.fetchLeads(startDate, endDate, false);
    await this.saveLeads(leads);
  }
}

