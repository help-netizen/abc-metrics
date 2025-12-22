/**
 * Metrics Routes for Metrics Module
 * 
 * API endpoints for metrics module with prefix /api/metrics/*
 * All endpoints are read-only (data fetching) - writes go through AbcMetricsClient
 */

import { Router, Request, Response } from 'express';
import { SvcWorkizLeads } from './services/svc-workiz-leads';
import { SvcWorkizJobs } from './services/svc-workiz-jobs';
import { SvcWorkizPayments } from './services/svc-workiz-payments';
import { SvcElocalCalls } from './services/svc-elocal-calls';
import { CsvService } from './services/csv.service';

const router = Router();

/**
 * GET /api/metrics/test/workiz/jobs
 * Test endpoint to fetch Workiz jobs (without saving)
 */
router.get('/api/metrics/test/workiz/jobs', async (req: Request, res: Response) => {
  const svcWorkizJobs = new SvcWorkizJobs();
  try {
    const { start_date, end_date } = req.query;
    const startDate = (start_date as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = (end_date as string) || new Date().toISOString().split('T')[0];

    const jobs = await svcWorkizJobs.fetchJobs(startDate, endDate, false);
    res.json({
      success: true,
      count: jobs.length,
      start_date: startDate,
      end_date: endDate,
      jobs: jobs.slice(0, 10), // Return first 10 for testing
    });
  } catch (error: any) {
    console.error('Error fetching Workiz jobs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/metrics/test/workiz/leads
 * Test endpoint to fetch Workiz leads (without saving)
 */
router.get('/api/metrics/test/workiz/leads', async (req: Request, res: Response) => {
  const svcWorkizLeads = new SvcWorkizLeads();
  try {
    const { start_date } = req.query;
    const startDate = (start_date as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const leads = await svcWorkizLeads.fetchLeads(startDate, undefined, false);
    res.json({
      success: true,
      count: leads.length,
      start_date: startDate,
      leads: leads.slice(0, 10), // Return first 10 for testing
    });
  } catch (error: any) {
    console.error('Error fetching Workiz leads:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/metrics/test/workiz/payments
 * Test endpoint to fetch Workiz payments (without saving)
 */
router.get('/api/metrics/test/workiz/payments', async (req: Request, res: Response) => {
  const svcWorkizPayments = new SvcWorkizPayments();
  try {
    const { start_date, end_date } = req.query;
    const startDate = (start_date as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = (end_date as string) || new Date().toISOString().split('T')[0];

    const payments = await svcWorkizPayments.fetchPayments(startDate, endDate);
    res.json({
      success: true,
      count: payments.length,
      start_date: startDate,
      end_date: endDate,
      payments: payments.slice(0, 10), // Return first 10 for testing
    });
  } catch (error: any) {
    console.error('Error fetching Workiz payments:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/metrics/test/elocal/calls
 * Test endpoint to fetch Elocal calls (without saving)
 */
router.get('/api/metrics/test/elocal/calls', async (req: Request, res: Response) => {
  const svcElocalCalls = new SvcElocalCalls();
  try {
    const { start_date, end_date } = req.query;

    let startDate: string;
    let endDate: string;

    if (start_date && end_date) {
      startDate = start_date as string;
      endDate = end_date as string;
    } else {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      endDate = yesterday.toISOString().split('T')[0];

      const startDateObj = new Date(yesterday);
      startDateObj.setDate(startDateObj.getDate() - 29);
      startDate = startDateObj.toISOString().split('T')[0];
    }

    console.log(`Fetching elocal calls via API: start=${startDate}, end=${endDate}`);

    const csvContent = await svcElocalCalls.fetchCallsCsv(startDate, endDate);
    const calls = svcElocalCalls.parseCallsCsv(csvContent);

    res.json({
      success: true,
      start_date: startDate,
      end_date: endDate,
      count: calls.length,
      calls: calls.slice(0, 10), // Return first 10 for testing
    });
  } catch (error: any) {
    console.error('Error fetching elocal calls via API:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack,
    });
  } finally {
    await svcElocalCalls.closeBrowser();
  }
});

/**
 * POST /api/metrics/sync/workiz/jobs
 * Manual trigger for Workiz jobs sync
 */
router.post('/api/metrics/sync/workiz/jobs', async (req: Request, res: Response) => {
  const svcWorkizJobs = new SvcWorkizJobs();
  try {
    await svcWorkizJobs.syncJobs();
    res.json({
      success: true,
      message: 'Workiz jobs sync completed',
    });
  } catch (error: any) {
    console.error('Error in Workiz jobs sync:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/metrics/sync/workiz/leads
 * Manual trigger for Workiz leads sync
 */
router.post('/api/metrics/sync/workiz/leads', async (req: Request, res: Response) => {
  const svcWorkizLeads = new SvcWorkizLeads();
  try {
    await svcWorkizLeads.syncLeads();
    res.json({
      success: true,
      message: 'Workiz leads sync completed',
    });
  } catch (error: any) {
    console.error('Error in Workiz leads sync:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/metrics/sync/workiz/payments
 * Manual trigger for Workiz payments sync
 */
router.post('/api/metrics/sync/workiz/payments', async (req: Request, res: Response) => {
  const svcWorkizPayments = new SvcWorkizPayments();
  try {
    await svcWorkizPayments.syncPayments();
    res.json({
      success: true,
      message: 'Workiz payments sync completed',
    });
  } catch (error: any) {
    console.error('Error in Workiz payments sync:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/metrics/sync/elocal/calls
 * Manual trigger for Elocal calls sync
 */
router.post('/api/metrics/sync/elocal/calls', async (req: Request, res: Response) => {
  const svcElocalCalls = new SvcElocalCalls();
  try {
    await svcElocalCalls.syncCalls();
    res.json({
      success: true,
      message: 'Elocal calls sync completed',
    });
  } catch (error: any) {
    console.error('Error in Elocal calls sync:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/metrics/process/csv
 * Manual trigger for CSV processing
 */
router.post('/api/metrics/process/csv', async (req: Request, res: Response) => {
  const csvService = new CsvService();
  try {
    await csvService.processCsvFiles();
    res.json({
      success: true,
      message: 'CSV processing completed',
    });
  } catch (error: any) {
    console.error('Error processing CSV files:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;



