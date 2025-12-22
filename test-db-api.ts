/**
 * Test script for DB API endpoints
 * 
 * Usage:
 *   DB_API_KEY=your-api-key npx ts-node test-db-api.ts
 * 
 * Or set DB_API_KEY in .env file
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
    };
  } catch (error: any) {
    return {
      name,
      success: false,
      error: error.response?.data?.message || error.message,
      data: error.response?.data,
    };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Testing DB API Endpoints');
  console.log('='.repeat(60));
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 10)}...`);
  console.log('');

  // Test 1: Health check (should work without auth for comparison)
  console.log('Test 1: Health check (no auth required)...');
  try {
    const response = await axios.get(`${API_BASE_URL}/api/health`);
    console.log(`  ✓ Health check: ${response.status} ${response.statusText}`);
  } catch (error: any) {
    console.log(`  ✗ Health check failed: ${error.message}`);
    console.log('  Server might not be running. Start it with: npm start');
    process.exit(1);
  }
  console.log('');

  // Test 2: Authentication - should fail without API key
  console.log('Test 2: Authentication (without API key - should fail)...');
  try {
    await axios.get(`${API_BASE_URL}/api/db/tables`);
    results.push({
      name: 'Auth test (no key)',
      success: false,
      error: 'Should have failed without API key',
    });
    console.log('  ✗ Should have failed without API key');
  } catch (error: any) {
    if (error.response?.status === 401) {
      results.push({
        name: 'Auth test (no key)',
        success: true,
      });
      console.log('  ✓ Correctly rejected request without API key');
    } else {
      results.push({
        name: 'Auth test (no key)',
        success: false,
        error: `Unexpected error: ${error.message}`,
      });
      console.log(`  ✗ Unexpected error: ${error.message}`);
    }
  }
  console.log('');

  // Test 3: Authentication - should succeed with API key
  console.log('Test 3: Authentication (with API key - should succeed)...');
  const authTest = await testEndpoint('Auth test (with key)', 'GET', '/api/db/tables');
  results.push(authTest);
  if (authTest.success) {
    console.log(`  ✓ Authentication successful`);
    console.log(`  Tables found: ${authTest.data?.tables?.length || 0}`);
  } else {
    console.log(`  ✗ Authentication failed: ${authTest.error}`);
  }
  console.log('');

  // Test 4: Read jobs
  console.log('Test 4: Read jobs...');
  const jobsTest = await testEndpoint('Read jobs', 'GET', '/api/db/jobs?limit=5');
  results.push(jobsTest);
  if (jobsTest.success) {
    console.log(`  ✓ Read jobs successful`);
    console.log(`  Jobs returned: ${jobsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read jobs failed: ${jobsTest.error}`);
  }
  console.log('');

  // Test 5: Read payments
  console.log('Test 5: Read payments...');
  const paymentsTest = await testEndpoint('Read payments', 'GET', '/api/db/payments?limit=5');
  results.push(paymentsTest);
  if (paymentsTest.success) {
    console.log(`  ✓ Read payments successful`);
    console.log(`  Payments returned: ${paymentsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read payments failed: ${paymentsTest.error}`);
  }
  console.log('');

  // Test 6: Read calls
  console.log('Test 6: Read calls...');
  const callsTest = await testEndpoint('Read calls', 'GET', '/api/db/calls?limit=5');
  results.push(callsTest);
  if (callsTest.success) {
    console.log(`  ✓ Read calls successful`);
    console.log(`  Calls returned: ${callsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read calls failed: ${callsTest.error}`);
  }
  console.log('');

  // Test 7: Read leads
  console.log('Test 7: Read leads...');
  const leadsTest = await testEndpoint('Read leads', 'GET', '/api/db/leads?limit=5');
  results.push(leadsTest);
  if (leadsTest.success) {
    console.log(`  ✓ Read leads successful`);
    console.log(`  Leads returned: ${leadsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read leads failed: ${leadsTest.error}`);
  }
  console.log('');

  // Test 8: Read daily metrics
  console.log('Test 8: Read daily metrics...');
  const dailyMetricsTest = await testEndpoint('Read daily metrics', 'GET', '/api/db/metrics/daily?limit=5');
  results.push(dailyMetricsTest);
  if (dailyMetricsTest.success) {
    console.log(`  ✓ Read daily metrics successful`);
    console.log(`  Metrics returned: ${dailyMetricsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Read daily metrics failed: ${dailyMetricsTest.error}`);
  }
  console.log('');

  // Test 9: Write calls (test write operation)
  console.log('Test 9: Write calls (test data)...');
  const testCall = {
    call_id: `test-${Date.now()}`,
    date: new Date().toISOString().split('T')[0],
    duration: 120,
    call_type: 'test',
    source: 'test',
  };
  const writeCallsTest = await testEndpoint('Write calls', 'POST', '/api/db/calls', testCall);
  results.push(writeCallsTest);
  if (writeCallsTest.success) {
    console.log(`  ✓ Write calls successful`);
    console.log(`  Calls saved: ${writeCallsTest.data?.count || 0}`);
  } else {
    console.log(`  ✗ Write calls failed: ${writeCallsTest.error}`);
  }
  console.log('');

  // Test 10: Batch write
  console.log('Test 10: Batch write (test data)...');
  const batchData = {
    calls: [
      {
        call_id: `test-batch-1-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        duration: 60,
        call_type: 'test',
        source: 'test',
      },
      {
        call_id: `test-batch-2-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        duration: 90,
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
  } else {
    console.log(`  ✗ Batch write failed: ${batchTest.error}`);
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Test execution error:', error);
  process.exit(1);
});



