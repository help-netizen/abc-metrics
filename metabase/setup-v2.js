#!/usr/bin/env node

const axios = require('axios');

const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';

let sessionToken = null;

async function login() {
    console.log('Logging in to Metabase...');
    try {
        const response = await axios.post(`${METABASE_URL}/api/session`, {
            username: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        sessionToken = response.data.id;
        console.log('Login successful');
        return sessionToken;
    } catch (error) {
        console.error('Login failed:', error.message);
        process.exit(1);
    }
}

async function createCollection(name, parentId = null) {
    try {
        const response = await axios.post(`${METABASE_URL}/api/collection`, {
            name: name,
            color: '#509EE3',
            parent_id: parentId
        }, {
            headers: { 'X-Metabase-Session': sessionToken }
        });
        console.log(`Collection "${name}" created with ID: ${response.data.id}`);
        return response.data;
    } catch (error) {
        if (error.response?.data?.message?.includes('already exists')) {
            console.log(`Collection "${name}" already exists`);
            const list = await axios.get(`${METABASE_URL}/api/collection`, {
                headers: { 'X-Metabase-Session': sessionToken }
            });
            return list.data.find(c => c.name === name);
        }
        console.error(`Error creating collection "${name}":`, error.message);
    }
}

async function createDashboard(name, collectionId) {
    try {
        const response = await axios.post(`${METABASE_URL}/api/dashboard`, {
            name: name,
            collection_id: collectionId
        }, {
            headers: { 'X-Metabase-Session': sessionToken }
        });
        console.log(`Dashboard "${name}" created with ID: ${response.data.id}`);
        return response.data;
    } catch (error) {
        if (error.response?.data?.message?.includes('already exists')) {
            const list = await axios.get(`${METABASE_URL}/api/dashboard`, {
                headers: { 'X-Metabase-Session': sessionToken }
            });
            return list.data.find(d => d.name === name);
        }
        console.error(`Error creating dashboard "${name}":`, error.message);
    }
}

async function createOrUpdateQuestion(name, description, sql, collectionId, visualizationType = 'table', display = 'table') {
    try {
        const listResponse = await axios.get(`${METABASE_URL}/api/card`, {
            headers: { 'X-Metabase-Session': sessionToken }
        });
        const existing = listResponse.data.find(q => q.name === name);

        const payload = {
            name: name,
            description: description,
            dataset_query: {
                type: 'native',
                native: { query: sql },
                database: 2
            },
            display: display,
            collection_id: collectionId,
            visualization_settings: {}
        };

        if (existing) {
            console.log(`Updating existing question "${name}" (ID: ${existing.id})...`);
            await axios.put(`${METABASE_URL}/api/card/${existing.id}`, payload, {
                headers: { 'X-Metabase-Session': sessionToken }
            });
            return existing;
        } else {
            const response = await axios.post(`${METABASE_URL}/api/card`, payload, {
                headers: { 'X-Metabase-Session': sessionToken }
            });
            console.log(`Question "${name}" created with ID: ${response.data.id}`);
            return response.data;
        }
    } catch (error) {
        console.error(`Error creating/updating question "${name}":`, error.message);
    }
}

async function addCardToDashboard(dashboardId, cardId, row = 0, col = 0, sizeX = 8, sizeY = 4) {
    try {
        // First check if already added
        const dash = await axios.get(`${METABASE_URL}/api/dashboard/${dashboardId}`, {
            headers: { 'X-Metabase-Session': sessionToken }
        });
        const cardsOnDash = dash.data.ordered_cards || [];
        if (cardsOnDash.find(c => c.card_id === cardId)) {
            console.log(`Card ${cardId} already on dashboard ${dashboardId}`);
            return;
        }

        await axios.post(`${METABASE_URL}/api/dashboard/${dashboardId}/cards`, {
            cardId: cardId,
            row: row,
            col: col,
            size_x: sizeX,
            size_y: sizeY
        }, {
            headers: { 'X-Metabase-Session': sessionToken }
        });
        console.log(`Added card ${cardId} to dashboard ${dashboardId}`);
    } catch (error) {
        console.error(`Error adding card ${cardId} to dashboard:`, error.message);
    }
}

async function setup() {
    await login();

    // 1. Collections
    const collections = ['10_Executive', '20_Operations', '30_Marketing'];
    const colMap = {};
    for (const name of collections) {
        const col = await createCollection(name);
        if (col) colMap[name] = col.id;
    }

    // 2. Questions
    const cards = {};

    cards.daily = await createOrUpdateQuestion(
        'Daily Metrics - Last 30 Days',
        'Daily summary with conversions',
        `SELECT d AS date, source, segment, leads, units, repairs, net_revenue, total_cost, ROUND(100.0 * conv_l_r, 2) AS conv_to_repair_pct, cpl FROM vw_daily_metrics WHERE d >= CURRENT_DATE - INTERVAL '30 days' ORDER BY d DESC, source, segment;`,
        colMap['10_Executive']
    );

    cards.forecast = await createOrUpdateQuestion(
        '[mart] Profit - MTD + Forecast',
        'Profit MTD with Month-End projection',
        `SELECT month_start, mtd_revenue, mtd_expenses, mtd_profit, avg_daily_profit_14d, projected_profit, ROUND(100.0 * (projected_profit - mtd_profit) / NULLIF(ABS(mtd_profit), 0), 2) AS forecast_variance_pct FROM mart_profit_mtd_v2 ORDER BY month_start DESC;`,
        colMap['10_Executive']
    );

    cards.pl_trend = await createOrUpdateQuestion(
        'Profit & Loss - Daily Trend',
        'Daily revenue, expenses and profit',
        `SELECT d AS date, gross_revenue, total_expenses, net_profit FROM mart_profit_mtd WHERE d >= CURRENT_DATE - INTERVAL '30 days' ORDER BY d;`,
        colMap['10_Executive']
    );

    cards.monthly = await createOrUpdateQuestion(
        'Monthly Metrics - Summary',
        'Monthly summary metrics',
        `SELECT month_start, source, SUM(leads) as total_leads, SUM(units) as total_units, SUM(repairs) as total_repairs, SUM(net_revenue) as total_revenue, SUM(cost) as total_cost, SUM(net_revenue) - SUM(cost) as profit, ROUND(AVG(conv_l_r) * 100, 2) as avg_conv_to_repair_pct, ROUND(AVG(cpl), 2) as avg_cpl FROM vw_monthly_metrics WHERE month_start >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months') GROUP BY month_start, source ORDER BY month_start DESC, source;`,
        colMap['10_Executive']
    );

    cards.tech = await createOrUpdateQuestion(
        '[mart] Tech - Performance MTD',
        'Technician Success Rate and Revenue',
        `SELECT technician_name, month_start, total_jobs, repairs_count, gross_revenue, avg_revenue_per_job, ROUND(100.0 * same_day_rate, 2) AS same_day_rate_pct FROM mart_tech_mtd WHERE month_start >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months') AND technician_name IS NOT NULL ORDER BY month_start DESC, gross_revenue DESC;`,
        colMap['20_Operations']
    );

    cards.heatmap = await createOrUpdateQuestion(
        '[mart] Geo - ZIP Heatmap',
        'Job distribution by ZIP code',
        `SELECT zip, lat, lon, SUM(job_count) as total_jobs, SUM(total_revenue) as total_revenue FROM mart_zip_mtd WHERE month_start >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months') AND lat IS NOT NULL AND lon IS NOT NULL GROUP BY zip, lat, lon ORDER BY total_revenue DESC;`,
        colMap['20_Operations']
    );

    cards.channel = await createOrUpdateQuestion(
        '[mart] Channel - Efficiency MTD',
        'Cost per Lead by Channel',
        `SELECT channel_name, month_start, total_leads, valid_leads, total_spend, repairs_completed, cost_per_valid_lead, cost_per_repair, ROUND(100.0 * valid_leads / NULLIF(total_leads, 0), 2) AS valid_leads_rate FROM mart_channel_mtd WHERE month_start >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months') ORDER BY month_start DESC, channel_name;`,
        colMap['30_Marketing']
    );

    cards.funnel = await createOrUpdateQuestion(
        '[mart] Lead - Funnel MTD',
        'Leads to Repairs funnel conversion',
        `SELECT channel_name, month_start, leads_total, diagnostics_booked, repairs_completed, ROUND(100.0 * diagnostics_booked / NULLIF(leads_total, 0), 2) AS conv_to_diagnostic_pct, ROUND(100.0 * repairs_completed / NULLIF(leads_total, 0), 2) AS conv_to_repair_pct FROM mart_lead_funnel_mtd WHERE month_start >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months') ORDER BY month_start DESC, channel_name;`,
        colMap['30_Marketing']
    );

    // 3. Dashboards
    const dashExec = await createDashboard('ABC Metrics - Executive Dashboard', colMap['10_Executive']);
    if (dashExec) {
        if (cards.forecast) await addCardToDashboard(dashExec.id, cards.forecast.id, 0, 0, 12, 4);
        if (cards.pl_trend) await addCardToDashboard(dashExec.id, cards.pl_trend.id, 4, 0, 12, 6);
        if (cards.monthly) await addCardToDashboard(dashExec.id, cards.monthly.id, 10, 0, 12, 6);
    }

    const dashMarket = await createDashboard('ABC Metrics - Marketing Dashboard', colMap['30_Marketing']);
    if (dashMarket) {
        if (cards.channel) await addCardToDashboard(dashMarket.id, cards.channel.id, 0, 0, 12, 6);
        if (cards.funnel) await addCardToDashboard(dashMarket.id, cards.funnel.id, 6, 0, 12, 6);
    }

    const dashOps = await createDashboard('ABC Metrics - Operations Dashboard', colMap['20_Operations']);
    if (dashOps) {
        if (cards.tech) await addCardToDashboard(dashOps.id, cards.tech.id, 0, 0, 12, 6);
        if (cards.heatmap) await addCardToDashboard(dashOps.id, cards.heatmap.id, 6, 0, 12, 8);
    }

    console.log('\nMetabase structure V2 setup complete with Dashboards!');
}

setup();
