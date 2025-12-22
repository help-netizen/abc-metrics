#!/usr/bin/env node
const axios = require('axios');
const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

async function listDatabases() {
    try {
        const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
            username: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        const sessionToken = loginResponse.data.id;

        const dbResponse = await axios.get(`${METABASE_URL}/api/database`, {
            headers: { 'X-Metabase-Session': sessionToken }
        });

        console.log('Available Databases:');
        dbResponse.data.data.forEach(db => {
            console.log(`ID: ${db.id} | Name: ${db.name} | Engine: ${db.engine}`);
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
}

listDatabases();
