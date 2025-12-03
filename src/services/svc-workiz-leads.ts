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
  private async getSourceId(sourceCode: string): Promise<number | null> {
    const client = await pool.connect();
    try {
      // Normalize source code
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

      // Try to find by name or create default
      const resultByName = await client.query(
        'SELECT id FROM dim_source WHERE LOWER(name) = LOWER($1)',
        [sourceCode]
      );

      if (resultByName.rows.length > 0) {
        return resultByName.rows[0].id;
      }

      // Return workiz as default
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
   */
  async fetchLeads(startDate?: string, endDate?: string, onlyOpen: boolean = true): Promise<WorkizLead[]> {
    const allLeads: WorkizLead[] = [];
    let offset = 0;
    const recordsPerPage = 100;
    let hasMore = true;

    try {
      console.log(`Fetching leads from Workiz API: start_date=${startDate || 'not set'}, end_date=${endDate || 'not set'}, only_open=${onlyOpen}`);

      while (hasMore) {
        const params: any = {
          offset: offset,
          records: recordsPerPage,
          only_open: onlyOpen,
        };

        if (startDate) {
          params.start_date = startDate;
        }

        console.log(`Fetching leads page: offset=${offset}, records=${recordsPerPage}`);

        const response = await axios.get(`${this.apiBasePath}/lead/all/`, { params });

        let leadsData: WorkizLeadRaw[] = [];
        if (Array.isArray(response.data)) {
          leadsData = response.data;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          leadsData = response.data.data;
        } else if (response.data?.leads && Array.isArray(response.data.leads)) {
          leadsData = response.data.leads;
        }

        console.log(`Received ${leadsData.length} leads in this page`);

        if (offset === 0 && leadsData.length > 0) {
          console.log('Sample raw lead structure from API:', JSON.stringify(leadsData[0], null, 2));
        }

        const normalizedLeads = leadsData
          .map((rawLead) => this.normalizeLead(rawLead))
          .filter((lead): lead is WorkizLead => lead !== null);

        allLeads.push(...normalizedLeads);

        if (leadsData.length < recordsPerPage) {
          hasMore = false;
        } else {
          offset += recordsPerPage;
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
      });
      return allLeads;
    }
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

