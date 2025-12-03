/**
 * Test script for Elocal Calls save to database
 * Usage: ts-node test-elocal-save.ts
 */

import * as dotenv from 'dotenv';
import { SvcElocalCalls } from './src/services/svc-elocal-calls';

dotenv.config();

async function testElocalCallsSave() {
  console.log('=== Testing Elocal Calls Save to Database ===\n');

  const svcElocalCalls = new SvcElocalCalls();

  try {
    // Test with a small date range
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    const startDateStr = startDate.toISOString().split('T')[0];

    console.log(`1. Fetching calls: ${startDateStr} to ${endDateStr}`);
    const csvContent = await svcElocalCalls.fetchCallsCsv(startDateStr, endDateStr);
    
    if (!csvContent || csvContent.trim().length === 0) {
      console.log('❌ No CSV content received');
      return;
    }
    
    console.log(`✅ CSV fetched (${csvContent.length} characters)\n`);

    console.log('2. Parsing CSV...');
    const calls = svcElocalCalls.parseCallsCsv(csvContent);
    console.log(`✅ Parsed ${calls.length} calls\n`);

    if (calls.length === 0) {
      console.log('⚠️  No calls to save');
      return;
    }

    console.log('3. Saving to database...');
    console.log(`   Sample call:`, calls[0]);
    await svcElocalCalls.saveCalls(calls);
    console.log('✅ Calls saved to database\n');

    console.log('4. Testing idempotency - running save again...');
    await svcElocalCalls.saveCalls(calls);
    console.log('✅ Second save completed (should update existing records, not create duplicates)\n');

    console.log('=== All tests completed successfully ===');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await svcElocalCalls.closeBrowser();
  }
}

// Run tests
testElocalCallsSave()
  .then(() => {
    console.log('\n✅ Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test script failed:', error);
    process.exit(1);
  });

