#!/usr/bin/env node
const axios = require('axios');
const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

async function fixCard(cardId) {
    try {
        const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
            username: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        const sessionToken = loginResponse.data.id;

        console.log(`Fixing Question ${cardId} to use public. schema...`);
        await axios.put(`${METABASE_URL}/api/card/${cardId}`, {
            dataset_query: {
                type: 'native',
                native: { query: 'SELECT * FROM public.mart_profit_mtd_v2' },
                database: 2
            }
        }, {
            headers: { 'X-Metabase-Session': sessionToken }
        });

        console.log('Update successful. Testing query...');
        const response = await axios.post(`${METABASE_URL}/api/card/${cardId}/query`, {}, {
            headers: { 'X-Metabase-Session': sessionToken }
        });

        if (response.data.error) {
            console.error('STILL FAILING:', response.data.error);
        } else {
            console.log('IT WORKED!');
        }
    } catch (error) {
        console.error('API Error:', error.response?.data?.message || error.message);
    }
}

fixCard(115);
