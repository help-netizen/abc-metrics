#!/usr/bin/env node
const axios = require('axios');
const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

async function inspectDB(dbId) {
    try {
        const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
            username: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        const sessionToken = loginResponse.data.id;

        const response = await axios.get(`${METABASE_URL}/api/database/${dbId}`, {
            headers: { 'X-Metabase-Session': sessionToken }
        });

        console.log('DB Details:');
        console.log('Name:', response.data.name);
        console.log('Host:', response.data.details.host);
        console.log('DB Name:', response.data.details.db);
        console.log('User:', response.data.details.user);
    } catch (error) {
        console.error('API Error:', error.response?.data?.message || error.message);
    }
}

inspectDB(2);
