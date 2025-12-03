import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { SvcWorkizLeads } from '../services/svc-workiz-leads';
import { SvcWorkizJobs } from '../services/svc-workiz-jobs';
import { SvcWorkizPayments } from '../services/svc-workiz-payments';
import { SvcElocalCalls } from '../services/svc-elocal-calls';

const router = Router();

// Daily metrics endpoint
router.get('/api/metrics/daily', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source, segment, limit = 30 } = req.query;
    
    let query = 'SELECT * FROM daily_metrics WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    if (source) {
      paramCount++;
      query += ` AND source = $${paramCount}`;
      params.push(source);
    }
    
    if (segment) {
      paramCount++;
      query += ` AND segment = $${paramCount}`;
      params.push(segment);
    }
    
    query += ' ORDER BY date DESC, source, segment';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching daily metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Monthly metrics endpoint
router.get('/api/metrics/monthly', async (req: Request, res: Response) => {
  try {
    const { start_month, end_month, source, segment, limit = 12 } = req.query;
    
    let query = 'SELECT * FROM monthly_metrics WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_month) {
      paramCount++;
      query += ` AND month >= $${paramCount}`;
      params.push(start_month);
    }
    
    if (end_month) {
      paramCount++;
      query += ` AND month <= $${paramCount}`;
      params.push(end_month);
    }
    
    if (source) {
      paramCount++;
      query += ` AND source = $${paramCount}`;
      params.push(source);
    }
    
    if (segment) {
      paramCount++;
      query += ` AND segment = $${paramCount}`;
      params.push(segment);
    }
    
    query += ' ORDER BY month DESC, source, segment';
    
    if (!start_month && !end_month) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching monthly metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Jobs endpoint
router.get('/api/jobs', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, include_raw = 'false', limit = 100 } = req.query;
    const includeRaw = include_raw === 'true';
    
    let query = `
      SELECT 
        fj.job_id,
        fj.lead_id,
        fj.created_at,
        fj.scheduled_at,
        ds.code as source,
        ds.name as source_name,
        fj.type,
        fj.client_id,
        fj.meta,
        fj.created_at_db,
        fj.updated_at_db
      FROM fact_jobs fj
      LEFT JOIN dim_source ds ON fj.source_id = ds.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND DATE(fj.created_at) >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND DATE(fj.created_at) <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY fj.created_at DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    
    // Parse meta JSONB if requested
    const rows = result.rows.map(row => {
      if (includeRaw && row.meta) {
        try {
          row.meta = typeof row.meta === 'string' 
            ? JSON.parse(row.meta) 
            : row.meta;
        } catch (e) {
          // Keep as is if parsing fails
        }
      } else if (!includeRaw) {
        delete row.meta;
      }
      return row;
    });
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Payments endpoint
router.get('/api/payments', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, job_id, include_raw = 'false', limit = 100 } = req.query;
    const includeRaw = include_raw === 'true';
    
    let query = `
      SELECT 
        fp.payment_id,
        fp.job_id,
        fp.paid_at,
        fp.amount,
        fp.method,
        fp.meta,
        fp.created_at_db,
        fp.updated_at_db
      FROM fact_payments fp
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND DATE(fp.paid_at) >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND DATE(fp.paid_at) <= $${paramCount}`;
      params.push(end_date);
    }
    
    if (job_id) {
      paramCount++;
      query += ` AND fp.job_id = $${paramCount}`;
      params.push(job_id);
    }
    
    query += ' ORDER BY fp.paid_at DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    
    // Parse meta JSONB if requested
    const rows = result.rows.map(row => {
      if (includeRaw && row.meta) {
        try {
          row.meta = typeof row.meta === 'string' 
            ? JSON.parse(row.meta) 
            : row.meta;
        } catch (e) {
          // Keep as is if parsing fails
        }
      } else if (!includeRaw) {
        delete row.meta;
      }
      return row;
    });
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calls endpoint
router.get('/api/calls', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM calls WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY date DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leads endpoints
router.get('/api/leads/elocals', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM elocals_leads WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY date DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching elocals leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leads endpoint (universal - includes Pro Referral, Google, and other Workiz leads)
router.get('/api/leads', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source, status, include_raw = 'false', limit = 100 } = req.query;
    const includeRaw = include_raw === 'true';
    
    let query = `
      SELECT 
        fl.lead_id,
        fl.created_at,
        ds.code as source,
        ds.name as source_name,
        fl.phone_hash,
        fl.raw_source,
        fl.cost,
        fl.meta,
        fl.created_at_db,
        fl.updated_at_db
      FROM fact_leads fl
      LEFT JOIN dim_source ds ON fl.source_id = ds.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND DATE(fl.created_at) >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND DATE(fl.created_at) <= $${paramCount}`;
      params.push(end_date);
    }
    
    if (source) {
      paramCount++;
      query += ` AND ds.code = $${paramCount}`;
      params.push(source);
    }
    
    query += ' ORDER BY fl.created_at DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    
    // Parse meta JSONB if requested
    const rows = result.rows.map(row => {
      if (includeRaw && row.meta) {
        try {
          row.meta = typeof row.meta === 'string' 
            ? JSON.parse(row.meta) 
            : row.meta;
        } catch (e) {
          // Keep as is if parsing fails
        }
      } else if (!includeRaw) {
        delete row.meta;
      }
      return row;
    });
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Google spend endpoint
router.get('/api/google-spend', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM google_spend WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY date DESC';
    
    if (!start_date && !end_date) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching google spend:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Targets endpoint
router.get('/api/targets', async (req: Request, res: Response) => {
  try {
    const { start_month, end_month, source, segment, metric_type } = req.query;
    
    let query = 'SELECT * FROM targets WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;
    
    if (start_month) {
      paramCount++;
      query += ` AND month >= $${paramCount}`;
      params.push(start_month);
    }
    
    if (end_month) {
      paramCount++;
      query += ` AND month <= $${paramCount}`;
      params.push(end_month);
    }
    
    if (source) {
      paramCount++;
      query += ` AND source = $${paramCount}`;
      params.push(source);
    }
    
    if (segment) {
      paramCount++;
      query += ` AND segment = $${paramCount}`;
      params.push(segment);
    }
    
    if (metric_type) {
      paramCount++;
      query += ` AND metric_type = $${paramCount}`;
      params.push(metric_type);
    }
    
    query += ' ORDER BY month DESC, source, segment, metric_type';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching targets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
router.get('/api/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// ========== TEST ENDPOINTS FOR WORKIZ JOBS ==========

// Test endpoint: Fetch jobs from Workiz API (without saving)
router.get('/api/test/workiz/jobs', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'false' } = req.query;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizJobs = new SvcWorkizJobs();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Test fetch jobs: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    const jobs = await svcWorkizJobs.fetchJobs(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    // Return jobs with raw_data for first job to show structure
    const jobsWithRaw = jobs.slice(0, 10).map(job => ({
      ...job,
      raw_data: job.raw_data || null,
      raw_data_keys: job.raw_data ? Object.keys(job.raw_data) : [],
    }));

    res.json({
      success: true,
      count: jobs.length,
      jobs: jobsWithRaw,
      message: `Fetched ${jobs.length} jobs. Showing first 10 with raw data.`,
      sample_raw_structure: jobs.length > 0 && jobs[0].raw_data ? {
        keys: Object.keys(jobs[0].raw_data),
        sample: jobs[0].raw_data,
      } : null,
    });
  } catch (error: any) {
    console.error('Error in test fetch jobs:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Fetch single job by UUID
router.get('/api/test/workiz/jobs/:uuid', async (req: Request, res: Response) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({ error: 'UUID parameter is required' });
    }

    // TODO: implement fetchJobByUuid in SvcWorkizJobs
    return res.status(501).json({ 
      success: false,
      error: 'fetchJobByUuid not yet implemented in SvcWorkizJobs',
      uuid 
    });
  } catch (error: any) {
    console.error('Error in test fetch job by UUID:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Manual sync jobs (fetch and save)
router.post('/api/test/workiz/jobs/sync', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'false' } = req.body;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizJobs = new SvcWorkizJobs();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Manual sync jobs: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    // Fetch jobs
    const jobs = await svcWorkizJobs.fetchJobs(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    console.log(`Fetched ${jobs.length} jobs, starting save...`);

    // Save jobs
    await svcWorkizJobs.saveJobs(jobs);

    res.json({
      success: true,
      message: `Successfully synced ${jobs.length} jobs`,
      count: jobs.length,
    });
  } catch (error: any) {
    console.error('Error in manual sync jobs:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Trigger full sync (like scheduler does)
router.post('/api/test/workiz/jobs/sync-full', async (req: Request, res: Response) => {
  try {
    const svcWorkizJobs = new SvcWorkizJobs();
    console.log('Starting full jobs sync (last 30 days)...');

    await svcWorkizJobs.syncJobs();

    res.json({
      success: true,
      message: 'Full jobs sync completed successfully',
    });
  } catch (error: any) {
    console.error('Error in full sync jobs:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// ========== TEST ENDPOINTS FOR WORKIZ LEADS ==========

// Test endpoint: Fetch leads from Workiz API (without saving)
router.get('/api/test/workiz/leads', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'true' } = req.query;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizLeads = new SvcWorkizLeads();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Test fetch leads: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    const leads = await svcWorkizLeads.fetchLeads(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    // Return leads with raw_data for first lead to show structure
    const leadsWithRaw = leads.slice(0, 10).map(lead => ({
      ...lead,
      raw_data: lead.raw_data || null,
      raw_data_keys: lead.raw_data ? Object.keys(lead.raw_data) : [],
    }));

    res.json({
      success: true,
      count: leads.length,
      leads: leadsWithRaw,
      message: `Fetched ${leads.length} leads. Showing first 10 with raw data.`,
      sample_raw_structure: leads.length > 0 && leads[0].raw_data ? {
        keys: Object.keys(leads[0].raw_data),
        sample: leads[0].raw_data,
      } : null,
    });
  } catch (error: any) {
    console.error('Error in test fetch leads:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Fetch single lead by UUID
router.get('/api/test/workiz/leads/:uuid', async (req: Request, res: Response) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({ error: 'UUID parameter is required' });
    }

    // TODO: implement fetchLeadByUuid in SvcWorkizLeads
    return res.status(501).json({ 
      success: false,
      error: 'fetchLeadByUuid not yet implemented in SvcWorkizLeads',
      uuid 
    });
  } catch (error: any) {
    console.error('Error in test fetch lead by UUID:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Manual sync leads (fetch and save)
router.post('/api/test/workiz/leads/sync', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, only_open = 'false' } = req.body;
    
    if (!start_date) {
      return res.status(400).json({ 
        error: 'start_date parameter is required (format: YYYY-MM-DD)' 
      });
    }

    const svcWorkizLeads = new SvcWorkizLeads();
    const onlyOpenFlag = only_open === 'true';
    const endDate = end_date as string | undefined;

    console.log(`Manual sync leads: start_date=${start_date}, end_date=${endDate}, only_open=${onlyOpenFlag}`);

    // Fetch leads
    const leads = await svcWorkizLeads.fetchLeads(
      start_date as string,
      endDate,
      onlyOpenFlag
    );

    console.log(`Fetched ${leads.length} leads, starting save...`);

    // Save leads
    await svcWorkizLeads.saveLeads(leads);

    res.json({
      success: true,
      message: `Successfully synced ${leads.length} leads`,
      count: leads.length,
    });
  } catch (error: any) {
    console.error('Error in manual sync leads:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Trigger full sync (like scheduler does)
router.post('/api/test/workiz/leads/sync-full', async (req: Request, res: Response) => {
  try {
    const svcWorkizLeads = new SvcWorkizLeads();
    console.log('Starting full leads sync (last 30 days)...');

    await svcWorkizLeads.syncLeads();

    res.json({
      success: true,
      message: 'Full leads sync completed successfully',
    });
  } catch (error: any) {
    console.error('Error in full sync leads:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// ========== TEST ENDPOINTS FOR ELOCAL CALLS ==========

// Test endpoint: Test authentication only (via CSV fetch with small date range)
router.post('/api/test/elocal/calls/auth', async (req: Request, res: Response) => {
  try {
    console.log('Testing elocal.com authentication...');
    const svcElocalCalls = new SvcElocalCalls();
    
    // Test authentication by trying to fetch CSV for a small date range
    const today = new Date();
    const testDate = today.toISOString().split('T')[0];
    
    try {
      await svcElocalCalls.fetchCallsCsv(testDate, testDate);
      res.json({
        success: true,
        message: 'Authentication successful (able to access export endpoint)',
      });
    } catch (error: any) {
      if (error.message.includes('authentication') || error.message.includes('login')) {
        res.json({
          success: false,
          message: 'Authentication failed',
          error: error.message,
        });
      } else {
        // Other errors might still mean auth worked
        res.json({
          success: true,
          message: 'Authentication successful (but CSV fetch had other issues)',
          error: error.message,
        });
      }
    } finally {
      await svcElocalCalls.closeBrowser();
    }
  } catch (error: any) {
    console.error('Error in test authentication:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.stack 
    });
  }
});

// Test endpoint: Fetch calls CSV from elocal.com (without saving)
router.get('/api/test/elocal/calls', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ 
        error: 'start_date and end_date parameters are required (format: YYYY-MM-DD)' 
      });
    }

    const svcElocalCalls = new SvcElocalCalls();
    
    console.log(`Test fetch elocal calls: start_date=${start_date}, end_date=${end_date}`);

    // Fetch CSV (authentication happens inside fetchCallsCsv)
    let csvContent: string;
    try {
      csvContent = await svcElocalCalls.fetchCallsCsv(
        start_date as string,
        end_date as string
      );
    } finally {
      await svcElocalCalls.closeBrowser();
    }

    // Parse CSV to show structure
    const calls = svcElocalCalls.parseCallsCsv(csvContent);

    res.json({
      success: true,
      count: calls.length,
      calls: calls.slice(0, 10), // Show first 10
      csv_preview: csvContent.substring(0, 500), // First 500 chars of CSV
      message: `Fetched ${calls.length} calls. Showing first 10.`,
    });
  } catch (error: any) {
    console.error('Error in test fetch elocal calls:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

// Test endpoint: Manual sync calls (authenticate + fetch + save)
router.post('/api/test/elocal/calls/sync', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.body;
    
    // If dates not provided, use default (last 30 days excluding today)
    let startDate: string;
    let endDate: string;
    
    if (start_date && end_date) {
      startDate = start_date;
      endDate = end_date;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      endDate = yesterday.toISOString().split('T')[0];
      
      const startDateObj = new Date(yesterday);
      startDateObj.setDate(startDateObj.getDate() - 29);
      startDate = startDateObj.toISOString().split('T')[0];
    }

    const svcElocalCalls = new SvcElocalCalls();
    
    console.log(`Manual sync elocal calls: start_date=${startDate}, end_date=${endDate}`);

    // Run full sync
    try {
      await svcElocalCalls.syncCalls();
    } finally {
      await svcElocalCalls.closeBrowser();
    }

    // Get count of saved calls
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM calls 
       WHERE source = 'elocals' 
       AND date >= $1 AND date <= $2`,
      [startDate, endDate]
    );

    res.json({
      success: true,
      message: 'Sync completed successfully',
      date_range: {
        start: startDate,
        end: endDate,
      },
      calls_in_db: parseInt(result.rows[0].count, 10),
    });
  } catch (error: any) {
    console.error('Error in manual sync elocal calls:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data || error.stack 
    });
  }
});

export default router;

