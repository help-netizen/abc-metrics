/**
 * Test script for Elocal Calls service
 * Usage: ts-node test-elocal-calls.ts
 */

import * as dotenv from 'dotenv';
import { SvcElocalCalls } from './src/services/svc-elocal-calls';

dotenv.config();

async function testElocalCalls() {
  console.log('=== Testing Elocal Calls Service ===\n');

  const svcElocalCalls = new SvcElocalCalls();

  // Test 1: Authentication (will be tested during CSV fetch)
  console.log('1. Testing authentication (via CSV fetch)...');
  console.log('   Note: Authentication happens automatically during CSV fetch\n');

  // Test 2: Fetch CSV for a small date range (even if auth failed)
  console.log('2. Testing CSV fetch (will try even if auth returned false)...');
  try {
    // Test with the date range from the example URL
    const startDateStr = '2024-11-04';
    const endDateStr = '2024-12-03';

    console.log(`   Date range: ${startDateStr} to ${endDateStr}`);
    console.log('   Note: Will attempt to fetch CSV even if authentication returned false');
    
    const csvContent = await svcElocalCalls.fetchCallsCsv(startDateStr, endDateStr);
    
    if (csvContent && csvContent.trim().length > 0) {
      console.log(`✅ CSV fetched successfully (${csvContent.length} characters)`);
      console.log(`   First 500 chars: ${csvContent.substring(0, 500)}...\n`);
    } else {
      console.log('⚠️  CSV content is empty\n');
    }
  } catch (error: any) {
    console.error('❌ CSV fetch error:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response preview:', error.response.data?.substring?.(0, 300));
    }
    // Don't return - continue to parsing test
  }

  // Test 3: Parse CSV
  console.log('3. Testing CSV parsing...');
  try {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    const startDateStr = startDate.toISOString().split('T')[0];

    const csvContent = await svcElocalCalls.fetchCallsCsv(startDateStr, endDateStr);
    const calls = svcElocalCalls.parseCallsCsv(csvContent);
    
    console.log(`✅ Parsed ${calls.length} calls from CSV`);
    if (calls.length > 0) {
      console.log(`   Sample call:`, calls[0]);
    }
    console.log('');
  } catch (error: any) {
    console.error('❌ CSV parsing error:', error.message);
    console.error(error.stack);
    return;
  }

  // Test 4: Cleanup
  console.log('4. Cleaning up...');
  try {
    await svcElocalCalls.closeBrowser();
    console.log('✅ Browser closed\n');
  } catch (error: any) {
    console.error('⚠️  Error closing browser:', error.message);
  }

  // Test 5: Full sync (optional - uncomment to test saving to DB)
  console.log('5. Full sync test skipped');
  console.log('   To test full sync, use: POST /api/test/elocal/calls/sync\n');

  console.log('=== All tests completed ===');
}

// Run tests
testElocalCalls()
  .then(() => {
    console.log('\n✅ Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test script failed:', error);
    process.exit(1);
  });

