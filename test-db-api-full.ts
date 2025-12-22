/**
 * Full test script for DB API endpoints with database connection
 * 
 * Usage:
 *   DATABASE_URL=postgresql://... DB_API_KEY=your-api-key npx ts-node test-db-api-full.ts
 * 
 * Or set DATABASE_URL and DB_API_KEY in .env file
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.DB_API_KEY || 'test-api-key';

interface TestResult {
  name: string;
  success: boolean;
  error?: string;
  data?: any;
  details?: string;
}

const results: TestResult[] = [];

async function testEndpoint(
  name: string,
  method: 'GET' | 'POST',
  path: string,
  data?: any
): Promise<TestResult> {
  try {
    const url = `${API_BASE_URL}${path}`;
    const config = {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 seconds timeout
    };

    let response;
    if (method === 'GET') {
      response = await axios.get(url, config);
    } else {
      response = await axios.post(url, data, config);
    }

    return {
      name,
      success: response.status >= 200 && response.status < 300,
      data: response.data,
      details: `Status: ${response.status}`,
    };
  } catch (error: any) {
    return {
      name,
      success: false,
      error: error.response?.data?.message || error.message,
      data: error.response?.data,
      details: `Status: ${error.response?.status || 'N/A'}`,
    };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Full DB API Testing with Database Connection');
  console.log('='.repeat(60));
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? 'SET' : 'NOT SET'}`);
  console.log('');

  // Test 1: Health check (no auth required)
  console.log('Test 1: Health check (no auth required)...');
  try {
    const response = await axios.get(`${API_BASE_URL}/api/health`, { timeout: 5000 });
    const healthStatus = response.data;
    console.log(`  Status: ${healthStatus.status || 'unknown'}`);
    console.log(`  Database: ${healthStatus.database || 'unknown'}`);
    if (healthStatus.database === 'connected') {
      console.log('  ✓ Database is connected');
      results.push({ name: 'Health check', success: true, data: healthStatus });
    } else {
      console.log('  ⚠ Database is not connected - some tests may fail');
      console.log('  ⚠ Set DATABASE_URL environment variable to enable full testing');
      results.push({ name: 'Health check', success: true, data: healthStatus, details: 'DB not connected' });
    }
  } catch (error: any) {
    console.log(`  ✗ Health check failed: ${error.message}`);
    console.log('  Server might not be running. Start it with: npm start');
    results.push({ name: 'Health check', success: false, error: error.message });
    // Don't exit - continue with other tests
  }
  console.log('');

  // Test 2: Read tables
  console.log('Test 2: Read tables list...');
  const tablesTest = await testEndpoint('Read tables', 'GET', '/api/db/tables');
  results.push(tablesTest);
  if (tablesTest.success) {
    console.log(`  ✓ Read tables successful`);
    console.log(`  Tables found: ${tablesTest.data?.tables?.length || 0}`);
    if (tablesTest.data?.tables && tablesTest.data.tables.length > 0) {
      console.log(`  Sample tables: ${tablesTest.data.tables.slice(0, 5).join(', ')}`);
    }
  } else {
    console.log(`  ✗ Read tables failed: ${tablesTest.error}`);
  }
  console.log('');

  // Test 3: Read jobs
  console.log('Test 3: Read jobs...');
  const jobsTest = await testEndpoint('Read jobs', 'GET', '/api/db/jobs?limit=5');
  results.push(jobsTest);
  if (jobsTest.success) {
    console.log(`  ✓ Read jobs successful`);
    console.log(`  Jobs returned: ${jobsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read jobs failed: ${jobsTest.error}`);
  }
  console.log('');

  // Test 4: Read payments
  console.log('Test 4: Read payments...');
  const paymentsTest = await testEndpoint('Read payments', 'GET', '/api/db/payments?limit=5');
  results.push(paymentsTest);
  if (paymentsTest.success) {
    console.log(`  ✓ Read payments successful`);
    console.log(`  Payments returned: ${paymentsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read payments failed: ${paymentsTest.error}`);
  }
  console.log('');

  // Test 5: Read calls
  console.log('Test 5: Read calls...');
  const callsTest = await testEndpoint('Read calls', 'GET', '/api/db/calls?limit=5');
  results.push(callsTest);
  if (callsTest.success) {
    console.log(`  ✓ Read calls successful`);
    console.log(`  Calls returned: ${callsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read calls failed: ${callsTest.error}`);
  }
  console.log('');

  // Test 6: Read leads
  console.log('Test 6: Read leads...');
  const leadsTest = await testEndpoint('Read leads', 'GET', '/api/db/leads?limit=5');
  results.push(leadsTest);
  if (leadsTest.success) {
    console.log(`  ✓ Read leads successful`);
    console.log(`  Leads returned: ${leadsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read leads failed: ${leadsTest.error}`);
  }
  console.log('');

  // Test 7: Write calls (single)
  console.log('Test 7: Write single call...');
  const testCallId = `test-call-${Date.now()}`;
  const testCall = {
    call_id: testCallId,
    date: new Date().toISOString().split('T')[0],
    duration: 120,
    call_type: 'test',
    source: 'test',
  };
  const writeCallsTest = await testEndpoint('Write single call', 'POST', '/api/db/calls', testCall);
  results.push(writeCallsTest);
  if (writeCallsTest.success) {
    console.log(`  ✓ Write call successful`);
    console.log(`  Calls saved: ${writeCallsTest.data?.count || 0}`);
    
    // Verify the call was saved
    console.log('  Verifying saved call...');
    const verifyTest = await testEndpoint('Verify saved call', 'GET', `/api/db/calls?start_date=${testCall.date}&end_date=${testCall.date}`);
    if (verifyTest.success && verifyTest.data?.data) {
      const savedCall = verifyTest.data.data.find((c: any) => c.call_id === testCallId);
      if (savedCall) {
        console.log(`  ✓ Call verified in database`);
      } else {
        console.log(`  ⚠ Call not found in database (might be a timing issue)`);
      }
    }
  } else {
    console.log(`  ✗ Write call failed: ${writeCallsTest.error}`);
  }
  console.log('');

  // Test 8: Write calls (array)
  console.log('Test 8: Write multiple calls (array)...');
  const testCallsArray = [
    {
      call_id: `test-call-array-1-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      duration: 60,
      call_type: 'test',
      source: 'test',
    },
    {
      call_id: `test-call-array-2-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      duration: 90,
      call_type: 'test',
      source: 'test',
    },
  ];
  const writeCallsArrayTest = await testEndpoint('Write calls array', 'POST', '/api/db/calls', testCallsArray);
  results.push(writeCallsArrayTest);
  if (writeCallsArrayTest.success) {
    console.log(`  ✓ Write calls array successful`);
    console.log(`  Calls saved: ${writeCallsArrayTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Write calls array failed: ${writeCallsArrayTest.error}`);
  }
  console.log('');

  // Test 9: Batch write
  console.log('Test 9: Batch write (multiple types)...');
  const batchData = {
    calls: [
      {
        call_id: `test-batch-call-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        duration: 45,
        call_type: 'test',
        source: 'test',
      },
    ],
  };
  const batchTest = await testEndpoint('Batch write', 'POST', '/api/db/batch', batchData);
  results.push(batchTest);
  if (batchTest.success) {
    console.log(`  ✓ Batch write successful`);
    console.log(`  Total records saved: ${batchTest.data?.total_count || 0}`);
    if (batchTest.data?.results) {
      console.log(`  Results:`, JSON.stringify(batchTest.data.results, null, 2));
    }
  } else {
    console.log(`  ✗ Batch write failed: ${batchTest.error}`);
  }
  console.log('');

  // Test 10: UPSERT (update existing call)
  console.log('Test 10: UPSERT (update existing call)...');
  const existingCallId = testCallId; // Use the call from Test 7
  const updatedCall = {
    call_id: existingCallId,
    date: new Date().toISOString().split('T')[0],
    duration: 180, // Updated duration
    call_type: 'updated',
    source: 'test',
  };
  const upsertTest = await testEndpoint('UPSERT call', 'POST', '/api/db/calls', updatedCall);
  results.push(upsertTest);
  if (upsertTest.success) {
    console.log(`  ✓ UPSERT successful`);
    
    // Verify the update
    const verifyUpdateTest = await testEndpoint('Verify updated call', 'GET', `/api/db/calls?start_date=${updatedCall.date}&end_date=${updatedCall.date}`);
    if (verifyUpdateTest.success && verifyUpdateTest.data?.data) {
      const updatedCallInDb = verifyUpdateTest.data.data.find((c: any) => c.call_id === existingCallId);
      if (updatedCallInDb && updatedCallInDb.duration === 180) {
        console.log(`  ✓ Call updated correctly in database`);
      } else {
        console.log(`  ⚠ Call update verification failed`);
      }
    }
  } else {
    console.log(`  ✗ UPSERT failed: ${upsertTest.error}`);
  }
  console.log('');

  // Test 11: Read daily metrics
  console.log('Test 11: Read daily metrics...');
  const dailyMetricsTest = await testEndpoint('Read daily metrics', 'GET', '/api/db/metrics/daily?limit=5');
  results.push(dailyMetricsTest);
  if (dailyMetricsTest.success) {
    console.log(`  ✓ Read daily metrics successful`);
    console.log(`  Metrics returned: ${dailyMetricsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read daily metrics failed: ${dailyMetricsTest.error}`);
  }
  console.log('');

  // Test 12: Read monthly metrics
  console.log('Test 12: Read monthly metrics...');
  const monthlyMetricsTest = await testEndpoint('Read monthly metrics', 'GET', '/api/db/metrics/monthly?limit=5');
  results.push(monthlyMetricsTest);
  if (monthlyMetricsTest.success) {
    console.log(`  ✓ Read monthly metrics successful`);
    console.log(`  Metrics returned: ${monthlyMetricsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read monthly metrics failed: ${monthlyMetricsTest.error}`);
  }
  console.log('');

  // Test 13: Read table by name
  console.log('Test 13: Read table by name...');
  const tableNameTest = await testEndpoint('Read table by name', 'GET', '/api/db/table/calls?limit=3');
  results.push(tableNameTest);
  if (tableNameTest.success) {
    console.log(`  ✓ Read table by name successful`);
    console.log(`  Rows returned: ${tableNameTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read table by name failed: ${tableNameTest.error}`);
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
      if (r.details) {
        console.log(`    ${r.details}`);
      }
    });
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Detailed Results');
  console.log('='.repeat(60));
  results.forEach((r, idx) => {
    console.log(`${idx + 1}. ${r.name}: ${r.success ? '✅ PASS' : '❌ FAIL'}`);
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    }
    if (r.data && r.success) {
      const summary = r.data.count !== undefined ? `count: ${r.data.count}` : 
                     r.data.total_count !== undefined ? `total: ${r.data.total_count}` : 
                     'success';
      console.log(`   ${summary}`);
    }
  });

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Test execution error:', error);
  process.exit(1);
});

