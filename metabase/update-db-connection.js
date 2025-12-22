#!/usr/bin/env node
const axios = require('axios');
const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

async function updateDatabaseConnection() {
    try {
        const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
            username: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        const sessionToken = loginResponse.data.id;

        console.log('Updating Metabase Database Connection (ID 2)...');

        // Values from flyctl env
        const payload = {
            name: 'ABC Metrics PostgreSQL',
            engine: 'postgres',
            details: {
                host: 'pgbouncer.q49ypo4w4mpr17ln.flympg.net',
                port: 5432,
                db: 'fly-db',
                user: 'fly-user',
                password: 'C9rN1sqxoaoPDoBgWlSGY5yx',
                ssl: true,
                'additional-options': 'sslmode=require'
            }
        };

        const response = await axios.put(`${METABASE_URL}/api/database/2`, payload, {
            headers: { 'X-Metabase-Session': sessionToken }
        });

        console.log('Update successful! Result:', response.data.name);

        // Trigger sync
        console.log('Triggering schema sync...');
        await axios.post(`${METABASE_URL}/api/database/2/sync_schema`, {}, {
            headers: { 'X-Metabase-Session': sessionToken }
        });
        console.log('Sync triggered.');

    } catch (error) {
        console.error('Update Failed:', error.response?.data?.message || error.message);
        if (error.response?.data) {
            console.error('Details:', JSON.stringify(error.response.data));
        }
    }
}

updateDatabaseConnection();
