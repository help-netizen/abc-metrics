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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

      // Start scheduler only if DB is connected
      console.log('Starting scheduler...');
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

