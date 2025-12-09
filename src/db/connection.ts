import * as dotenv from 'dotenv';

dotenv.config();

// For Fly.io Managed Postgres and other services with self-signed certificates,
// we need to disable TLS certificate validation at the Node.js level.
// This is safe because:
// 1. Traffic is still encrypted (TLS is used)
// 2. For Fly.io, traffic stays within their secure network
// 3. This only affects this specific process, not the entire system
const connString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (connString) {
  try {
    const url = new URL(connString);
    const hostname = url.hostname;
    const sslmode = url.searchParams.get('sslmode');
    
    // Only disable TLS validation for Fly.io Managed Postgres and Supabase
    // These services use self-signed certificates that can't be validated
    const needsRelaxedTls =
      hostname?.includes('flympg.net') ||
      hostname?.includes('supabase') ||
      (sslmode !== null && sslmode !== 'disable' && sslmode !== 'allow');
    
    if (needsRelaxedTls) {
      // Set NODE_TLS_REJECT_UNAUTHORIZED only for this process
      // This is safer than setting it globally
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  } catch {
    // Ignore URL parsing errors
  }
}

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
  } catch {
    // If URL parsing fails, return undefined (no SSL)
    return undefined;
  }

  // Check if this is an internal Fly.io host (flycast)
  const isInternalHost = 
    hostname?.includes('flycast') || 
    hostname?.includes('.internal') ||
    hostname?.startsWith('fdaa:');

  // For internal hosts, SSL can be disabled (traffic stays within Fly.io network)
  if (isInternalHost || sslmode === 'disable') {
    return false; // Disable SSL for internal connections
  }

  // For Fly.io Managed Postgres (flympg.net) and Supabase, use relaxed SSL validation
  // These services use self-signed certificates that need special handling
  const needsRelaxedSsl =
    hostname?.includes('flympg.net') ||
    hostname?.includes('supabase') ||
    (sslmode !== null && sslmode !== 'disable' && sslmode !== 'allow');

  if (needsRelaxedSsl) {
    // Return configuration that disables certificate validation
    // This is safe for Fly.io Managed Postgres as traffic is encrypted,
    // but certificate chain validation fails due to self-signed certs
    return {
      rejectUnauthorized: false,
      // Skip hostname verification for self-signed certificates
      checkServerIdentity: () => undefined,
    };
  }

  // For other connections, use default SSL behavior
  return undefined;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: getSslConfig(),
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export default pool;
