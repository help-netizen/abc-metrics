#!/usr/bin/env node

/**
 * Metabase Dashboard Diagnostic Script
 * Checks database data, Metabase connection, views visibility, and SQL query execution
 */

const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

// PostgreSQL connection details
const DB_HOST = process.env.MB_DB_HOST || process.env.DATABASE_URL?.match(/@([^:]+):/)?.[1] || 'pgbouncer.9g6y30w2qg60v5ml.flympg.net';
const DB_PORT = process.env.MB_DB_PORT || process.env.DATABASE_URL?.match(/:(\d+)\//)?.[1] || 5432;
const DB_NAME = process.env.MB_DB_DBNAME || process.env.DATABASE_URL?.match(/\/([^?]+)/)?.[1] || 'fly-db';
const DB_USER = process.env.MB_DB_USER || process.env.DATABASE_URL?.match(/:\/\/([^:]+):/)?.[1] || 'fly-user';
const DB_PASSWORD = process.env.MB_DB_PASS || process.env.DATABASE_URL?.match(/:[^:]+:([^@]+)@/)?.[1] || 'mJHdkZbWGckg31sOb5RASQo3';

// Use DATABASE_URL if available, otherwise construct from components
let DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Try to construct from individual components
  DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require`;
  
  // Check if we have undefined values
  if (DATABASE_URL.includes('undefined')) {
    console.log('⚠️  Warning: DATABASE_URL not found and cannot construct from components');
    console.log('\nTo get DATABASE_URL from Fly.io, run:');
    console.log('  export FLYCTL_INSTALL="/Users/rgareev91/.fly"');
    console.log('  export PATH="$FLYCTL_INSTALL/bin:$PATH"');
    console.log('  DATABASE_URL=$(flyctl ssh console -a abc-metrics -C "printenv DATABASE_URL" 2>/dev/null | grep -v Warning | grep -v Connecting | tail -1)');
    console.log('  export DATABASE_URL');
    console.log('  npm run diagnose-metabase');
    console.log('\nOr set it manually:');
    console.log('  export DATABASE_URL="postgresql://user:pass@host:port/db?sslmode=require"');
    console.log('');
  }
}

let sessionToken = null;
let pool = null;

const report = {
  database: {
    connection: { status: 'unknown', error: null },
    tables: {},
    views: {},
    sampleData: {}
  },
  metabase: {
    connection: { status: 'unknown', error: null },
    databases: [],
    viewsVisible: false,
    syncStatus: 'unknown'
  },
  sqlQueries: {
    status: 'unknown',
    results: []
  },
  recommendations: []
};

/**
 * Login to Metabase
 */
async function loginToMetabase() {
  try {
    const response = await axios.post(`${METABASE_URL}/api/session`, {
      username: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    const cookies = response.headers['set-cookie'];
    if (cookies) {
      const sessionCookie = cookies.find(c => c.startsWith('metabase.SESSION='));
      if (sessionCookie) {
        sessionToken = sessionCookie.split(';')[0].split('=')[1];
        return true;
      }
    }
    
    if (response.data.id) {
      sessionToken = response.data.id;
      return true;
    }
    
    return false;
  } catch (error) {
    report.metabase.connection.error = error.message;
    return false;
  }
}

/**
 * Check PostgreSQL connection
 */
async function checkDatabaseConnection() {
  try {
    console.log('🔍 Checking PostgreSQL connection...');
    
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    const result = await pool.query('SELECT 1 as test');
    
    if (result.rows[0].test === 1) {
      report.database.connection.status = '✅ Connected';
      console.log('✅ PostgreSQL connection: OK');
      return true;
    } else {
      report.database.connection.status = '❌ Failed';
      report.database.connection.error = 'Unexpected result from test query';
      console.log('❌ PostgreSQL connection: Failed');
      return false;
    }
  } catch (error) {
    report.database.connection.status = '❌ Failed';
    report.database.connection.error = error.message;
    console.log(`❌ PostgreSQL connection: Failed - ${error.message}`);
    return false;
  }
}

/**
 * Check data in tables
 */
async function checkDataTables() {
  console.log('\n📊 Checking data in tables...');
  
  const tables = [
    'fact_leads',
    'fact_jobs',
    'fact_payments',
    'dim_source',
    'dim_date',
    'leads', // legacy table
    'jobs', // legacy table
    'payments' // legacy table
  ];
  
  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      const count = parseInt(result.rows[0].count);
      report.database.tables[table] = { count, status: count > 0 ? '✅' : '⚠️  Empty' };
      console.log(`  ${table}: ${count} records ${count > 0 ? '✅' : '⚠️  Empty'}`);
    } catch (error) {
      report.database.tables[table] = { count: 0, status: '❌ Error', error: error.message };
      console.log(`  ${table}: ❌ Error - ${error.message}`);
    }
  }
}

/**
 * Check views existence and data
 */
async function checkViews() {
  console.log('\n👁️  Checking views...');
  
  // Check if views exist
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public' 
        AND table_name IN ('vw_daily_metrics', 'vw_monthly_metrics', 'vw_job_metrics')
      ORDER BY table_name
    `);
    
    const existingViews = result.rows.map(r => r.table_name);
    console.log(`  Views found: ${existingViews.join(', ') || 'None'}`);
    
    // Check data in each view
    const views = ['vw_job_metrics', 'vw_daily_metrics', 'vw_monthly_metrics'];
    
    for (const view of views) {
      if (existingViews.includes(view)) {
        try {
          const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${view}`);
          const count = parseInt(countResult.rows[0].count);
          
          // Get sample data
          let sampleData = [];
          if (count > 0) {
            const sampleResult = await pool.query(`SELECT * FROM ${view} LIMIT 3`);
            sampleData = sampleResult.rows;
          }
          
          report.database.views[view] = {
            exists: true,
            count,
            status: count > 0 ? '✅ Has data' : '⚠️  Empty',
            sampleData: sampleData.slice(0, 2) // Store first 2 rows
          };
          
          console.log(`  ${view}: ${count} records ${count > 0 ? '✅' : '⚠️  Empty'}`);
          if (count > 0 && sampleData.length > 0) {
            console.log(`    Sample columns: ${Object.keys(sampleData[0]).join(', ')}`);
          }
        } catch (error) {
          report.database.views[view] = {
            exists: true,
            count: 0,
            status: '❌ Error',
            error: error.message
          };
          console.log(`  ${view}: ❌ Error - ${error.message}`);
        }
      } else {
        report.database.views[view] = {
          exists: false,
          count: 0,
          status: '❌ Not found'
        };
        console.log(`  ${view}: ❌ Not found`);
      }
    }
  } catch (error) {
    console.log(`  ❌ Error checking views: ${error.message}`);
    report.database.views.error = error.message;
  }
}

/**
 * Check Metabase connection and database visibility
 */
async function checkMetabaseConnection() {
  console.log('\n🔗 Checking Metabase connection...');
  
  try {
    // Login
    const loggedIn = await loginToMetabase();
    if (!loggedIn) {
      report.metabase.connection.status = '❌ Login failed';
      console.log('❌ Metabase login: Failed');
      return false;
    }
    
    report.metabase.connection.status = '✅ Connected';
    console.log('✅ Metabase login: OK');
    
    // Get databases
    try {
      const dbResponse = await axios.get(`${METABASE_URL}/api/database`, {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`
        }
      });
      
      if (dbResponse.data.data && dbResponse.data.data.length > 0) {
        report.metabase.databases = dbResponse.data.data.map(db => ({
          id: db.id,
          name: db.name,
          engine: db.engine
        }));
        
        console.log(`✅ Found ${report.metabase.databases.length} database(s) in Metabase:`);
        report.metabase.databases.forEach(db => {
          console.log(`  - ${db.name} (${db.engine}, ID: ${db.id})`);
        });
        
        // Check if our PostgreSQL database is there
        const pgDb = report.metabase.databases.find(
          db => db.name === 'ABC Metrics PostgreSQL' || db.engine === 'postgres'
        );
        
        if (pgDb) {
          // Get metadata to check views visibility
          try {
            const metadataResponse = await axios.get(
              `${METABASE_URL}/api/database/${pgDb.id}/metadata`,
              {
                headers: {
                  'Cookie': `metabase.SESSION=${sessionToken}`
                }
              }
            );
            
            const tables = metadataResponse.data?.tables || [];
            const views = tables.filter(t => t.entity_type === 'entity/ViewTable');
            const viewNames = views.map(v => v.name);
            
            report.metabase.viewsVisible = viewNames.length > 0;
            
            console.log(`\n  Views visible in Metabase: ${viewNames.length > 0 ? viewNames.join(', ') : 'None'}`);
            
            const requiredViews = ['vw_daily_metrics', 'vw_monthly_metrics', 'vw_job_metrics'];
            const missingViews = requiredViews.filter(v => !viewNames.includes(v));
            
            if (missingViews.length > 0) {
              console.log(`  ⚠️  Missing views: ${missingViews.join(', ')}`);
              report.metabase.missingViews = missingViews;
            } else {
              console.log('  ✅ All required views are visible');
            }
            
          } catch (error) {
            console.log(`  ⚠️  Could not fetch metadata: ${error.message}`);
            report.metabase.metadataError = error.message;
          }
        } else {
          console.log('  ⚠️  PostgreSQL database not found in Metabase');
          report.metabase.pgDbNotFound = true;
        }
      } else {
        console.log('  ⚠️  No databases found in Metabase');
      }
      
    } catch (error) {
      console.log(`  ❌ Error fetching databases: ${error.message}`);
      report.metabase.connection.error = error.message;
    }
    
    return true;
  } catch (error) {
    report.metabase.connection.status = '❌ Failed';
    report.metabase.connection.error = error.message;
    console.log(`❌ Metabase connection: Failed - ${error.message}`);
    return false;
  }
}

/**
 * Test SQL queries from dashboard questions
 */
async function testSQLQueries() {
  console.log('\n📝 Testing SQL queries from dashboard questions...');
  
  const queries = [
    {
      name: 'Monthly: Leads, Units, Repairs by Source',
      sql: `SELECT 
        month_start,
        source,
        SUM(leads) as leads,
        SUM(units) as units,
        SUM(repairs) as repairs
      FROM vw_monthly_metrics
      GROUP BY month_start, source
      ORDER BY month_start DESC, source
      LIMIT 10`
    },
    {
      name: 'Monthly: Conversion Rates',
      sql: `SELECT 
        month_start,
        source,
        conv_l_u,
        conv_l_r,
        conv_u_r
      FROM vw_monthly_metrics
      ORDER BY month_start DESC, source
      LIMIT 10`
    },
    {
      name: 'Daily Cumulative: Repairs',
      sql: `SELECT
        d as date,
        SUM(repairs) OVER (ORDER BY d) AS repairs_cum
      FROM vw_daily_metrics
      WHERE d >= date_trunc('month', current_date)
        AND d <= current_date
      ORDER BY d`
    },
    {
      name: 'Daily Cumulative: All Metrics',
      sql: `SELECT
        d as date,
        SUM(leads) OVER (ORDER BY d) AS leads_cum,
        SUM(units) OVER (ORDER BY d) AS units_cum,
        SUM(repairs) OVER (ORDER BY d) AS repairs_cum
      FROM vw_daily_metrics
      WHERE d >= date_trunc('month', current_date)
        AND d <= current_date
      ORDER BY d`
    }
  ];
  
  for (const query of queries) {
    try {
      const result = await pool.query(query.sql);
      const rowCount = result.rows.length;
      
      report.sqlQueries.results.push({
        name: query.name,
        status: '✅ OK',
        rowCount,
        hasData: rowCount > 0,
        sampleRow: rowCount > 0 ? result.rows[0] : null
      });
      
      console.log(`  ${query.name}: ${rowCount} rows ${rowCount > 0 ? '✅' : '⚠️  No data'}`);
      if (rowCount > 0) {
        console.log(`    Sample: ${JSON.stringify(result.rows[0]).substring(0, 100)}...`);
      }
    } catch (error) {
      report.sqlQueries.results.push({
        name: query.name,
        status: '❌ Error',
        error: error.message,
        hasData: false
      });
      console.log(`  ${query.name}: ❌ Error - ${error.message}`);
    }
  }
  
  const allQueriesOk = report.sqlQueries.results.every(q => q.status === '✅ OK');
  const allQueriesHaveData = report.sqlQueries.results.every(q => q.hasData);
  
  if (allQueriesOk && allQueriesHaveData) {
    report.sqlQueries.status = '✅ All queries work and return data';
  } else if (allQueriesOk) {
    report.sqlQueries.status = '⚠️  Queries work but some return no data';
  } else {
    report.sqlQueries.status = '❌ Some queries have errors';
  }
}

/**
 * Generate recommendations
 */
function generateRecommendations() {
  console.log('\n💡 Generating recommendations...');
  
  // Check if database has no data
  const factTablesEmpty = 
    (report.database.tables.fact_leads?.count || 0) === 0 &&
    (report.database.tables.fact_jobs?.count || 0) === 0 &&
    (report.database.tables.fact_payments?.count || 0) === 0;
  
  if (factTablesEmpty) {
    report.recommendations.push({
      priority: 'HIGH',
      issue: 'No data in fact tables',
      solution: 'Run data synchronization from Workiz API. Execute: POST /api/test/workiz/jobs/sync and POST /api/test/workiz/leads/sync'
    });
  }
  
  // Check if views are empty
  const viewsEmpty = 
    (report.database.views.vw_daily_metrics?.count || 0) === 0 &&
    (report.database.views.vw_monthly_metrics?.count || 0) === 0;
  
  if (viewsEmpty && !factTablesEmpty) {
    report.recommendations.push({
      priority: 'MEDIUM',
      issue: 'Views are empty but fact tables have data',
      solution: 'Views might need data in dim_date table. Check if dim_date is populated for the date range of your data.'
    });
  }
  
  // Check if views are not visible in Metabase
  if (report.metabase.missingViews && report.metabase.missingViews.length > 0) {
    report.recommendations.push({
      priority: 'HIGH',
      issue: `Views not visible in Metabase: ${report.metabase.missingViews.join(', ')}`,
      solution: 'Sync database schema in Metabase: Admin → Databases → ABC Metrics PostgreSQL → Sync database schema now'
    });
  }
  
  // Check if SQL queries fail
  const queriesWithErrors = report.sqlQueries.results.filter(q => q.status === '❌ Error');
  if (queriesWithErrors.length > 0) {
    report.recommendations.push({
      priority: 'HIGH',
      issue: 'Some SQL queries have errors',
      solution: `Fix SQL queries in dashboard questions. Errors: ${queriesWithErrors.map(q => q.name).join(', ')}`
    });
  }
  
  // Check if queries return no data
  const queriesWithoutData = report.sqlQueries.results.filter(q => q.status === '✅ OK' && !q.hasData);
  if (queriesWithoutData.length > 0 && !factTablesEmpty) {
    report.recommendations.push({
      priority: 'MEDIUM',
      issue: 'Queries work but return no data',
      solution: 'Check date ranges in queries. Current month might not have data yet.'
    });
  }
  
  if (report.recommendations.length === 0) {
    report.recommendations.push({
      priority: 'INFO',
      issue: 'All checks passed',
      solution: 'System appears to be working correctly. If dashboards are still empty, check Metabase dashboard configuration.'
    });
  }
}

/**
 * Print final report
 */
function printReport() {
  console.log('\n' + '='.repeat(80));
  console.log('📋 DIAGNOSTIC REPORT');
  console.log('='.repeat(80));
  
  console.log('\n📊 DATABASE STATUS:');
  console.log(`  Connection: ${report.database.connection.status}`);
  if (report.database.connection.error) {
    console.log(`  Error: ${report.database.connection.error}`);
  }
  
  console.log('\n  Tables:');
  Object.entries(report.database.tables).forEach(([table, info]) => {
    console.log(`    ${table}: ${info.count} records ${info.status}`);
  });
  
  console.log('\n  Views:');
  Object.entries(report.database.views).forEach(([view, info]) => {
    if (info.exists !== undefined) {
      console.log(`    ${view}: ${info.exists ? '✅ Exists' : '❌ Not found'}, ${info.count} records ${info.status}`);
    }
  });
  
  console.log('\n🔗 METABASE STATUS:');
  console.log(`  Connection: ${report.metabase.connection.status}`);
  if (report.metabase.connection.error) {
    console.log(`  Error: ${report.metabase.connection.error}`);
  }
  console.log(`  Databases found: ${report.metabase.databases.length}`);
  console.log(`  Views visible: ${report.metabase.viewsVisible ? '✅ Yes' : '❌ No'}`);
  
  console.log('\n📝 SQL QUERIES STATUS:');
  console.log(`  Overall: ${report.sqlQueries.status}`);
  report.sqlQueries.results.forEach(q => {
    console.log(`    ${q.name}: ${q.status} (${q.rowCount || 0} rows)`);
    if (q.error) {
      console.log(`      Error: ${q.error}`);
    }
  });
  
  console.log('\n💡 RECOMMENDATIONS:');
  if (report.recommendations.length === 0) {
    console.log('  No issues found!');
  } else {
    report.recommendations.forEach((rec, idx) => {
      console.log(`\n  ${idx + 1}. [${rec.priority}] ${rec.issue}`);
      console.log(`     Solution: ${rec.solution}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
}

/**
 * Main diagnostic function
 */
async function main() {
  try {
    console.log('🔍 Starting Metabase Dashboard Diagnostic...\n');
    
    // 1. Check database connection
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      console.log('\n❌ Cannot proceed without database connection');
      printReport();
      process.exit(1);
    }
    
    // 2. Check data in tables
    await checkDataTables();
    
    // 3. Check views
    await checkViews();
    
    // 4. Check Metabase connection
    await checkMetabaseConnection();
    
    // 5. Test SQL queries
    await testSQLQueries();
    
    // 6. Generate recommendations
    generateRecommendations();
    
    // 7. Print report
    printReport();
    
    // Close database connection
    if (pool) {
      await pool.end();
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    printReport();
    process.exit(1);
  }
}

// Run diagnostics
if (require.main === module) {
  main();
}

module.exports = { main };

