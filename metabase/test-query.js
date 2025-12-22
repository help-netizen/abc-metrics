#!/usr/bin/env node
const axios = require('axios');
const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

async function testQuery() {
    try {
        const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
            username: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        const sessionToken = loginResponse.data.id;

        console.log('Testing query against mart_profit_mtd_v2...');
        const queryResponse = await axios.post(`${METABASE_URL}/api/dataset`, {
            database: 2,
            type: 'native',
            native: { query: 'SELECT * FROM mart_profit_mtd_v2 LIMIT 1' }
        }, {
            headers: { 'X-Metabase-Session': sessionToken }
        });

        console.log('Success! Data returned:', JSON.stringify(queryResponse.data.data.rows));
    } catch (error) {
        console.error('Query Failed:', error.response?.data?.message || error.message);
    }
}

testQuery();
