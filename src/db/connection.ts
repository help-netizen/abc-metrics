import * as dotenv from 'dotenv';

dotenv.config();

import { Pool } from 'pg';

// SSL configuration type for pg library
type SslConfig = 
  | { rejectUnauthorized: false; checkServerIdentity?: () => undefined }
  | boolean
  | undefined;

// Determine SSL configuration based on connection string
function getSslConfig(): SslConfig {
  const connString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

  if (!connString) {
    console.log('[SSL Config] No connection string provided, SSL disabled');
    return undefined;
  }

  // Parse connection string
  let url: URL;
  let sslmode: string | null = null;
  let hostname: string | null = null;
  
  try {
    url = new URL(connString);
    sslmode = url.searchParams.get('sslmode');
    hostname = url.hostname;
  } catch (error) {
    // If URL parsing fails, use relaxed SSL by default for safety
    console.log(`[SSL Config] URL parsing failed, using relaxed SSL. Error: ${error}`);
    return {
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    };
  }

  console.log(`[SSL Config] Parsing connection: hostname=${hostname}, sslmode=${sslmode || 'not set'}`);

  // Check if this is an internal Fly.io host (flycast) - IPv6 addresses starting with fdaa:
  // Internal connections don't require SSL as traffic stays within Fly.io network
  const isInternalHost = 
    hostname?.includes('flycast') || 
    hostname?.includes('.internal') ||
    (hostname?.startsWith('fdaa:') || hostname?.match(/^fdaa:/));

  // If explicitly disabled, respect that
  if (sslmode === 'disable') {
    console.log('[SSL Config] SSL explicitly disabled via sslmode=disable');
    return false;
  }

  // For internal Fly.io hosts (flycast), disable SSL
  if (isInternalHost) {
    console.log(`[SSL Config] Internal Fly.io host detected (${hostname}), disabling SSL`);
    return false;
  }

  // For all external connections (Fly.io Managed Postgres, Supabase, etc.),
  // use relaxed SSL validation to handle self-signed certificates
  // This prevents "self-signed certificate in certificate chain" errors
  // Traffic is still encrypted, but certificate chain validation is relaxed
  console.log(`[SSL Config] External connection detected (${hostname}), using relaxed SSL`);
  return {
    rejectUnauthorized: false,
    // Skip hostname verification for self-signed certificates
    checkServerIdentity: () => undefined,
  };
}

// Get SSL configuration
const sslConfig = getSslConfig();

// Prepare connection string - remove sslmode parameter if present to use our SSL config
let connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (connectionString) {
  try {
    const url = new URL(connectionString);
    // Remove sslmode parameter to use our programmatic SSL configuration
    url.searchParams.delete('sslmode');
    connectionString = url.toString();
  } catch {
    // If URL parsing fails, use original connection string
  }
}

// Create connection pool with SSL configuration and optimized settings for Fly.io Managed Postgres
const pool = new Pool({
  connectionString: connectionString,
  ssl: sslConfig,
  // Optimize pool settings for Fly.io Managed Postgres
  max: parseInt(process.env.DB_POOL_MAX || '15', 10), // Maximum number of clients in the pool (10-20 for Fly.io)
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10), // Close idle clients after 30 seconds
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '10000', 10), // Return an error after 10 seconds if connection could not be established
  // Allow pool to create connections on demand
  allowExitOnIdle: false, // Keep pool alive even when idle
});

// Log pool configuration (without sensitive data)
const connString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (connString) {
  try {
    const url = new URL(connString);
    const maskedUrl = `${url.protocol}//${url.hostname}:${url.port}${url.pathname}?ssl=${sslConfig === false ? 'disabled' : sslConfig ? 'relaxed' : 'default'}`;
    console.log(`[DB Connection] Pool created with SSL config: ${maskedUrl}`);
  } catch {
    console.log(`[DB Connection] Pool created with SSL config: ${sslConfig === false ? 'disabled' : sslConfig ? 'relaxed' : 'default'}`);
  }
}

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export default pool;
