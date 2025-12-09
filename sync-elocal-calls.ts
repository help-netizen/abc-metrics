/**
 * Script to sync Elocal calls data
 * Usage: ts-node sync-elocal-calls.ts
 */

import * as dotenv from 'dotenv';
import { SvcElocalCalls } from './src/services/svc-elocal-calls';

dotenv.config();

async function syncElocalCalls() {
  console.log('=== Starting Elocal Calls Sync ===\n');

  const svcElocalCalls = new SvcElocalCalls();

  try {
    await svcElocalCalls.syncCalls();
    console.log('\n✅ Sync completed successfully');
  } catch (error: any) {
    console.error('\n❌ Sync failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await svcElocalCalls.closeBrowser();
  }
}

// Run sync
syncElocalCalls()
  .then(() => {
    console.log('\n✅ Script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

