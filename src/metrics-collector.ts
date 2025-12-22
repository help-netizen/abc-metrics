/**
 * ABC Business Metrics Collector
 * Collects and processes business metrics
 */

import express from 'express';
import * as dotenv from 'dotenv';
import path from 'path';
import pool from './db/connection';
import migrate from './db/migrate';
import routes from './api/routes';
import { Scheduler } from './scheduler';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || process.env.METRICS_PORT || '3001', 10);

// Middleware
// Configure body parser with increased limits for batch operations
// Default Express limit is 100kb, which is too small for batch requests from rely-lead-processor
// Set to 10MB to handle large batches (jobs, leads, payments, calls)
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '10mb';
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || '10mb';

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));

// Error handler for payload size errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.too.large' || err instanceof Error && err.message.includes('request entity too large')) {
    console.error(`[PayloadTooLarge] Request from ${req.ip} to ${req.path} exceeded size limit (${JSON_BODY_LIMIT})`);
    console.error(`[PayloadTooLarge] Request method: ${req.method}, Content-Type: ${req.headers['content-type']}`);
    return res.status(413).json({
      success: false,
      error: 'Payload Too Large',
      message: `Request body exceeds maximum size of ${JSON_BODY_LIMIT}. Please split large batches into smaller requests.`,
      limit: JSON_BODY_LIMIT,
    });
  }
  next(err);
});

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Static files (must be before API routes)
// In production (dist/), __dirname is dist/, so public is at ../public
// In development, __dirname is src/, so public is at ../public
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use(routes);

// Rate Me API routes (v1)
import rateMeRoutes from './api/rate-me-routes';
app.use('/api/v1', rateMeRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'ABC Metrics API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      dailyMetrics: '/api/metrics/daily',
      monthlyMetrics: '/api/metrics/monthly',
      jobs: '/api/jobs',
      payments: '/api/payments',
      calls: '/api/calls',
      elocalsLeads: '/api/leads/elocals',
      leads: '/api/leads',
      googleSpend: '/api/google-spend',
      targets: '/api/targets',
      testWorkizJobs: '/api/test/workiz/jobs',
      testWorkizJobByUuid: '/api/test/workiz/jobs/:uuid',
      testWorkizSyncJobs: 'POST /api/test/workiz/jobs/sync',
      testWorkizSyncFull: 'POST /api/test/workiz/jobs/sync-full',
      testWorkizLeads: '/api/test/workiz/leads',
      testWorkizLeadByUuid: '/api/test/workiz/leads/:uuid',
      testWorkizSyncLeads: 'POST /api/test/workiz/leads/sync',
      testWorkizSyncLeadsFull: 'POST /api/test/workiz/leads/sync-full',
    },
  });
});

// Start the application
async function main(): Promise<void> {
  try {
    // Test database connection (non-blocking for testing)
    console.log('Testing database connection...');
    try {
      await pool.query('SELECT 1');
      console.log('Database connected successfully');

      // Run migrations
      console.log('Running database migrations...');
      await migrate();
      console.log('Migrations completed');

      // Start aggregation scheduler only if DB is connected
      // Note: Data synchronization is handled by rely-lead-processor
      console.log('Starting metrics aggregation scheduler...');
      const scheduler = new Scheduler();
      scheduler.start();
    } catch (dbError: any) {
      console.warn('Database connection failed:', dbError.message);
      console.warn('Server will start in test mode (API endpoints available, but DB operations will fail)');
      console.warn('Set DATABASE_URL environment variable to enable full functionality');
    }

    // Start API server (always start, even without DB for testing)
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`ABC Metrics API server is running on port ${PORT}`);
      console.log(`Health check: http://0.0.0.0:${PORT}/api/health`);
      console.log(`Test endpoints: http://0.0.0.0:${PORT}/api/test/workiz/jobs`);
    });
  } catch (error) {
    console.error('Error starting application:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

// Start the application
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

