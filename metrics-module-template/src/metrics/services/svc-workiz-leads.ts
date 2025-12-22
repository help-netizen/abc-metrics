/**
 * Workiz Leads Service for Metrics Module
 * 
 * This service fetches leads from Workiz API and saves them to abc-metrics via API.
 * No direct database connections - all operations go through AbcMetricsClient.
 */

import axios from 'axios';
import crypto from 'crypto';
import { AbcMetricsClient, AbcMetricsLead } from './abc-metrics-client';

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
  Phone?: string;
  SecondPhone?: string;
  Email?: string;
  FirstName?: string;
  LastName?: string;
  JobType?: string;
  ReferralCompany?: string;
  JobSource?: string; // This is the source field!
  [key: string]: any;
}

// Normalized lead interface (internal)
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
   * Normalize phone number and create hash
   */
  private normalizePhoneHash(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
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
   */
  async fetchLeads(startDate?: string, endDate?: string, onlyOpen: boolean = true): Promise<WorkizLead[]> {
    const allLeads: WorkizLead[] = [];
    let offset = 0;
    const recordsPerPage = 100;
    let hasMore = true;
    let pageNumber = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    if (endDate) {
      console.log(`Warning: end_date parameter (${endDate}) is ignored - Workiz API uses start_date until today`);
    }
    
    console.log(`[PAGINATION] Starting leads fetch: start_date=${startDate || 'not set'}, only_open=${onlyOpen}, records_per_page=${recordsPerPage}`);

    while (hasMore) {
      pageNumber++;
      const pageStartTime = Date.now();
      
      const params: any = {
        offset: offset,
        records: recordsPerPage,
      };

      if (startDate) {
        params.start_date = startDate;
      }
      
      if (onlyOpen) {
        params.only_open = onlyOpen;
      }

      console.log(`[PAGINATION] Page ${pageNumber}: Fetching leads - offset=${offset}, records=${recordsPerPage}`);

      let response;
      let leadsData: WorkizLeadRaw[] = [];
      
      try {
        response = await axios.get(`${this.apiBasePath}/lead/all/`, { params });
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        console.log(`[PAGINATION] Page ${pageNumber}: API request completed in ${requestTime}s, status=${response.status}`);

        if (Array.isArray(response.data)) {
          leadsData = response.data;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          leadsData = response.data.data;
        } else if (response.data?.leads && Array.isArray(response.data.leads)) {
          leadsData = response.data.leads;
        }

        console.log(`[PAGINATION] Page ${pageNumber}: Received ${leadsData.length} leads from API`);
        consecutiveErrors = 0;

      } catch (axiosError: any) {
        consecutiveErrors++;
        const requestTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        
        console.error(`[PAGINATION] Page ${pageNumber}: API request failed after ${requestTime}s:`, {
          url: `${this.apiBasePath}/lead/all/`,
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

      if (leadsData.length === 0) {
        console.log(`[PAGINATION] Page ${pageNumber}: No leads returned from API, stopping pagination`);
        hasMore = false;
        break;
      }

      const normalizeStartTime = Date.now();
      const normalizedLeads = leadsData
        .map((rawLead) => this.normalizeLead(rawLead))
        .filter((lead): lead is WorkizLead => lead !== null);
      const normalizeTime = ((Date.now() - normalizeStartTime) / 1000).toFixed(2);

      console.log(`[PAGINATION] Page ${pageNumber}: Normalized ${normalizedLeads.length} leads from ${leadsData.length} raw leads (took ${normalizeTime}s)`);

      allLeads.push(...normalizedLeads);

      const pageTime = ((Date.now() - pageStartTime) / 1000).toFixed(2);
      console.log(`[PAGINATION] Page ${pageNumber}: Summary - offset=${offset}, received=${leadsData.length}, normalized=${normalizedLeads.length}, total_accumulated=${allLeads.length}, time=${pageTime}s`);

      if (leadsData.length < recordsPerPage) {
        console.log(`[PAGINATION] Page ${pageNumber}: Received ${leadsData.length} < ${recordsPerPage} records, this is the last page`);
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

    console.log(`[PAGINATION] Completed: Total pages=${pageNumber}, total leads fetched=${allLeads.length}`);
    if (allLeads.length === 0) {
      console.warn('[PAGINATION] WARNING: No leads were fetched from Workiz API. Check API credentials and date range.');
    } else {
      console.log(`[PAGINATION] Successfully fetched ${allLeads.length} leads across ${pageNumber} page(s)`);
    }
    return allLeads;
  }

  /**
   * Convert WorkizLead to AbcMetricsLead format for API
   */
  private convertToApiFormat(lead: WorkizLead): AbcMetricsLead {
    return {
      lead_id: lead.id,
      source: lead.source || 'workiz',
      status: lead.status,
      created_at: lead.created_at || new Date().toISOString(),
      updated_at: lead.updated_at || lead.created_at || new Date().toISOString(),
      job_id: lead.job_id,
      client_phone: lead.client_phone,
      client_name: lead.client_name,
      raw_data: lead.raw_data,
    };
  }

  /**
   * Save leads to abc-metrics via API
   * Uses UPSERT to ensure idempotent syncs - can run hourly without duplicates
   */
  async saveLeads(leads: WorkizLead[]): Promise<void> {
    if (!leads || leads.length === 0) {
      console.log('No leads to save');
      return;
    }

    try {
      // Convert to API format
      const apiLeads: AbcMetricsLead[] = leads
        .filter(lead => lead.id) // Filter out leads without ID
        .map(lead => this.convertToApiFormat(lead));

      if (apiLeads.length === 0) {
        console.warn('No valid leads to save after conversion');
        return;
      }

      console.log(`Saving ${apiLeads.length} leads to abc-metrics via API...`);
      
      // Save via API
      const result = await this.abcMetricsClient.saveLeads(apiLeads);
      
      if (result.success) {
        console.log(`Leads save summary: ${result.count || apiLeads.length} saved via API`);
      } else {
        console.error(`Error saving leads via API: ${result.error || 'Unknown error'}`);
        throw new Error(result.error || 'Failed to save leads via API');
      }
    } catch (error: any) {
      console.error('Error saving Workiz leads via API:', error);
      throw error;
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



