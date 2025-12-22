#!/usr/bin/env node
const axios = require('axios');
const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

async function testQuestion(cardId) {
    try {
        const loginResponse = await axios.post(`${METABASE_URL}/api/session`, {
            username: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        const sessionToken = loginResponse.data.id;

        console.log(`Running Question ${cardId}...`);
        const response = await axios.post(`${METABASE_URL}/api/card/${cardId}/query`, {}, {
            headers: { 'X-Metabase-Session': sessionToken }
        });

        if (response.data.error) {
            console.error('Question Error:', response.data.error);
        } else {
            console.log('Success! Results:', response.data.data.rows.length, 'rows');
        }
    } catch (error) {
        console.error('API Error:', error.response?.data?.message || error.message);
        if (error.response?.data) {
            console.error('Full Error:', JSON.stringify(error.response.data));
        }
    }
}

testQuestion(115); // Profit question
