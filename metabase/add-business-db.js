#!/usr/bin/env node

/**
 * Add ABC Metrics Business Database as a new data source in Metabase
 * This connects to abc-metrics-db (not the Metabase system database)
 */

const axios = require('axios');

const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

// Get DATABASE_URL from abc-metrics app or use provided connection string
// Format: postgresql://user:password@host:port/database
const DATABASE_URL = process.env.ABC_METRICS_DATABASE_URL || process.env.DATABASE_URL;

let sessionToken = null;

/**
 * Parse DATABASE_URL into connection components
 */
function parseDatabaseUrl(url) {
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  
  // Parse postgresql://user:password@host:port/database?params
  // Also handle format without port: postgresql://user:password@host/database
  let match = url.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  
  if (!match) {
    // Try without port (defaults to 5432)
    match = url.match(/^postgresql:\/\/([^:]+):([^@]+)@([^\/]+)\/([^?]+)/);
    if (match) {
      return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: 5432,
        database: match[4]
      };
    }
    throw new Error(`Invalid DATABASE_URL format: ${url.substring(0, 50)}...`);
  }
  
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: parseInt(match[4]),
    database: match[5]
  };
}

/**
 * Login to Metabase
 */
async function login() {
  try {
    console.log('Logging in to Metabase...');
    
    const response = await axios.post(`${METABASE_URL}/api/session`, {
      username: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    const cookies = response.headers['set-cookie'];
    if (cookies) {
      const sessionCookie = cookies.find(c => c.startsWith('metabase.SESSION='));
      if (sessionCookie) {
        sessionToken = sessionCookie.split(';')[0].split('=')[1];
        console.log('✅ Login successful');
        return true;
      }
    }
    
    if (response.data.id) {
      sessionToken = response.data.id;
      console.log('✅ Login successful (using session ID)');
      return true;
    }
    
    throw new Error('Could not extract session token');
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Check if database already exists
 */
async function checkDatabaseExists(dbName) {
  try {
    const response = await axios.get(`${METABASE_URL}/api/database`, {
      headers: {
        'Cookie': `metabase.SESSION=${sessionToken}`
      }
    });
    
    if (response.data.data) {
      const existing = response.data.data.find(db => db.name === dbName);
      if (existing) {
        return existing;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error checking databases:', error.message);
    return null;
  }
}

/**
 * Add ABC Metrics Business Database as data source
 */
async function addBusinessDatabase() {
  try {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or ABC_METRICS_DATABASE_URL must be set');
    }
    
    const dbConfig = parseDatabaseUrl(DATABASE_URL);
    const dbName = 'ABC Metrics Business DB';
    
    console.log(`\nAdding data source: ${dbName}`);
    console.log(`  Host: ${dbConfig.host}`);
    console.log(`  Port: ${dbConfig.port}`);
    console.log(`  Database: ${dbConfig.database}`);
    console.log(`  User: ${dbConfig.user}`);
    
    // Check if already exists
    const existing = await checkDatabaseExists(dbName);
    if (existing) {
      console.log(`\n⚠️  Database "${dbName}" already exists with ID: ${existing.id}`);
      console.log('   Updating connection details...');
      
      // Update existing database
      const updateResponse = await axios.put(
        `${METABASE_URL}/api/database/${existing.id}`,
        {
          name: dbName,
          engine: 'postgres',
          details: {
            host: dbConfig.host,
            port: dbConfig.port,
            db: dbConfig.database,
            user: dbConfig.user,
            password: dbConfig.password,
            ssl: true,
            'ssl-mode': 'require'
          },
          auto_run_queries: true,
          is_full_sync: true,
          schedules: {
            metadata_sync: {
              schedule_type: 'hourly'
            },
            cache_field_values: {
              schedule_type: 'daily',
              schedule_day: null,
              schedule_hour: 0
            }
          }
        },
        {
          headers: {
            'Cookie': `metabase.SESSION=${sessionToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('✅ Database connection updated');
      console.log(`   Database ID: ${updateResponse.data.id}`);
      
      // Trigger schema sync
      console.log('\nTriggering schema sync...');
      await axios.post(
        `${METABASE_URL}/api/database/${existing.id}/sync_schema`,
        {},
        {
          headers: {
            'Cookie': `metabase.SESSION=${sessionToken}`
          }
        }
      );
      
      console.log('✅ Schema sync triggered');
      return updateResponse.data;
    }
    
    // Create new database
    console.log('\nCreating new database connection...');
    const response = await axios.post(
      `${METABASE_URL}/api/database`,
      {
        engine: 'postgres',
        name: dbName,
        details: {
          host: dbConfig.host,
          port: dbConfig.port,
          db: dbConfig.database,
          user: dbConfig.user,
          password: dbConfig.password,
          ssl: true,
          'ssl-mode': 'require'
        },
        auto_run_queries: true,
        is_full_sync: true,
        schedules: {
          metadata_sync: {
            schedule_type: 'hourly'
          },
          cache_field_values: {
            schedule_type: 'daily',
            schedule_day: null,
            schedule_hour: 0
          }
        }
      },
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Database connection created');
    console.log(`   Database ID: ${response.data.id}`);
    
    // Trigger initial schema sync
    console.log('\nTriggering initial schema sync...');
    await axios.post(
      `${METABASE_URL}/api/database/${response.data.id}/sync_schema`,
      {},
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`
        }
      }
    );
    
    console.log('✅ Schema sync triggered');
    console.log('\n💡 Note: Schema sync may take a few minutes. Views will appear after sync completes.');
    
    return response.data;
  } catch (error) {
    console.error('❌ Error adding database:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('   Details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('🔗 Adding ABC Metrics Business Database to Metabase...\n');
    
    // Login
    await login();
    
    // Add database
    const db = await addBusinessDatabase();
    
    console.log('\n✅ Success!');
    console.log(`\nYou can now access the database in Metabase:`);
    console.log(`  ${METABASE_URL}/browse/databases/${db.id}`);
    console.log(`\nDatabase name: ${db.name}`);
    console.log(`Database ID: ${db.id}`);
    
  } catch (error) {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  main();
}

module.exports = { main };

