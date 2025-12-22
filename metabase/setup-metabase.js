#!/usr/bin/env node

/**
 * Metabase Automated Setup Script
 * Configures Metabase with admin account and PostgreSQL data source via API
 */

const axios = require('axios');

const METABASE_URL = process.env.METABASE_URL || 'https://abc-metrics-metabase.fly.dev';
const ADMIN_EMAIL = process.env.METABASE_ADMIN_EMAIL || 'help@bostonmasters.com';
const ADMIN_PASSWORD = process.env.METABASE_ADMIN_PASSWORD || 'Alga!B@r2';
const ADMIN_FIRST_NAME = process.env.METABASE_ADMIN_FIRST_NAME || 'Admin';
const ADMIN_LAST_NAME = process.env.METABASE_ADMIN_LAST_NAME || 'User';

// PostgreSQL connection details
const DB_HOST = process.env.MB_DB_HOST || 'pgbouncer.9g6y30w2qg60v5ml.flympg.net';
const DB_PORT = process.env.MB_DB_PORT || 5432;
const DB_NAME = process.env.MB_DB_DBNAME || 'fly-db';
const DB_USER = process.env.MB_DB_USER || 'fly-user';
const DB_PASSWORD = process.env.MB_DB_PASS || 'mJHdkZbWGckg31sOb5RASQo3';

let sessionToken = null;

/**
 * Wait for Metabase to be ready
 */
async function waitForMetabase(maxRetries = 30, delay = 2000) {
  console.log('Waiting for Metabase to be ready...');
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(`${METABASE_URL}/api/session/properties`, {
        timeout: 5000,
        validateStatus: () => true
      });
      
      if (response.status === 200) {
        console.log('Metabase is ready!');
        return true;
      }
    } catch (error) {
      // Continue waiting
    }
    
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Metabase did not become ready in time');
}

/**
 * Check if setup is needed
 */
async function checkSetupStatus() {
  try {
    const response = await axios.get(`${METABASE_URL}/api/session/properties`);
    const data = response.data;
    
    if (data['has-user-setup']) {
      console.log('Metabase is already set up');
      return { needsSetup: false, setupToken: null };
    }
    
    console.log('Metabase needs initial setup');
    return { needsSetup: true, setupToken: data['setup-token'] };
  } catch (error) {
    console.error('Error checking setup status:', error.message);
    throw error;
  }
}

/**
 * Create admin account
 */
async function createAdminAccount(setupToken) {
  try {
    console.log('Creating admin account...');
    
    const response = await axios.post(`${METABASE_URL}/api/setup`, {
      token: setupToken,
      user: {
        first_name: ADMIN_FIRST_NAME,
        last_name: ADMIN_LAST_NAME,
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      },
      database: null,
      invite: null,
      prefs: {
        site_name: 'ABC Metrics',
        site_locale: 'en'
      }
    });
    
    console.log('Admin account created successfully');
    return response.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.message?.includes('already set up')) {
      console.log('Metabase is already set up, skipping admin creation');
      return null;
    }
    console.error('Error creating admin account:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Login to get session token
 */
async function login() {
  try {
    console.log('Logging in...');
    
    const response = await axios.post(`${METABASE_URL}/api/session`, {
      username: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    // Extract session token from Set-Cookie header
    const cookies = response.headers['set-cookie'];
    if (cookies) {
      const sessionCookie = cookies.find(c => c.startsWith('metabase.SESSION='));
      if (sessionCookie) {
        sessionToken = sessionCookie.split(';')[0].split('=')[1];
        console.log('Login successful');
        return sessionToken;
      }
    }
    
    // Alternative: use the session ID from response
    if (response.data.id) {
      sessionToken = response.data.id;
      console.log('Login successful (using session ID)');
      return sessionToken;
    }
    
    throw new Error('Could not extract session token');
  } catch (error) {
    console.error('Error logging in:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Check if database already exists
 */
async function checkDatabaseExists() {
  try {
    const response = await axios.get(`${METABASE_URL}/api/database`, {
      headers: {
        'Cookie': `metabase.SESSION=${sessionToken}`
      },
      validateStatus: () => true
    });
    
    if (response.status === 200 && response.data.data) {
      const existingDb = response.data.data.find(
        db => db.name === 'ABC Metrics PostgreSQL' || 
              (db.details?.host === DB_HOST && db.details?.db === DB_NAME)
      );
      
      if (existingDb) {
        console.log(`Database already exists with ID: ${existingDb.id}`);
        return existingDb;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error checking existing databases:', error.message);
    return null;
  }
}

/**
 * Add PostgreSQL data source
 */
async function addPostgreSQLDataSource() {
  try {
    // Check if database already exists
    const existingDb = await checkDatabaseExists();
    if (existingDb) {
      console.log('PostgreSQL data source already exists, skipping creation');
      return existingDb;
    }
    
    console.log('Adding PostgreSQL data source...');
    
    const response = await axios.post(
      `${METABASE_URL}/api/database`,
      {
        engine: 'postgres',
        name: 'ABC Metrics PostgreSQL',
        details: {
          host: DB_HOST,
          port: DB_PORT,
          db: DB_NAME,
          user: DB_USER,
          password: DB_PASSWORD,
          ssl: true,
          'ssl-mode': 'require'
        },
        auto_run_queries: true,
        is_full_sync: true,
        schedules: {
          metadata_sync: {
            schedule_type: 'hourly'
          },
          cache_field_values: {
            schedule_type: 'daily',
            schedule_day: null,
            schedule_hour: 0
          }
        }
      },
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('PostgreSQL data source added successfully');
    console.log(`Database ID: ${response.data.id}`);
    
    return response.data;
  } catch (error) {
    if (error.response?.status === 400) {
      const errorMsg = error.response?.data?.message || 'Unknown error';
      if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
        console.log('Database already exists, skipping creation');
        return await checkDatabaseExists();
      }
    }
    console.error('Error adding PostgreSQL data source:', error.response?.data || error.message);
    throw error;
  }
}

let databaseId = null;

/**
 * Get database ID
 */
async function getDatabaseId() {
  try {
    const response = await axios.get(`${METABASE_URL}/api/database`, {
      headers: {
        'Cookie': `metabase.SESSION=${sessionToken}`
      }
    });
    
    if (response.data.data && response.data.data.length > 0) {
      const db = response.data.data.find(
        d => d.name === 'ABC Metrics PostgreSQL' || d.engine === 'postgres'
      );
      if (db) {
        databaseId = db.id;
        return db.id;
      }
    }
    
    throw new Error('PostgreSQL database not found');
  } catch (error) {
    console.error('Error getting database ID:', error.message);
    throw error;
  }
}

/**
 * Create a question (query) in Metabase
 */
async function createQuestion(name, description, sql, visualizationType = 'table', display = 'table') {
  try {
    console.log(`Creating question: ${name}...`);
    
    if (!databaseId) {
      await getDatabaseId();
    }
    
    const response = await axios.post(
      `${METABASE_URL}/api/card`,
      {
        name: name,
        description: description,
        dataset_query: {
          type: 'native',
          native: {
            query: sql
          },
          database: databaseId
        },
        display: display,
        visualization_settings: {},
        parameters: []
      },
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Question "${name}" created with ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.message?.includes('already exists')) {
      console.log(`Question "${name}" may already exist, skipping...`);
      return null;
    }
    console.error(`Error creating question "${name}":`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create a dashboard
 */
async function createDashboard(name, description) {
  try {
    console.log(`Creating dashboard: ${name}...`);
    
    // Check if dashboard already exists
    const listResponse = await axios.get(`${METABASE_URL}/api/dashboard`, {
      headers: {
        'Cookie': `metabase.SESSION=${sessionToken}`
      }
    });
    
    if (listResponse.data.data) {
      const existing = listResponse.data.data.find(d => d.name === name);
      if (existing) {
        console.log(`Dashboard "${name}" already exists with ID: ${existing.id}`);
        return existing;
      }
    }
    
    const response = await axios.post(
      `${METABASE_URL}/api/dashboard`,
      {
        name: name,
        description: description,
        parameters: []
      },
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Dashboard "${name}" created with ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    console.error(`Error creating dashboard "${name}":`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Add a card (question) to a dashboard
 */
async function addCardToDashboard(dashboardId, questionId, row = 0, col = 0, sizeX = 6, sizeY = 4) {
  try {
    // First, get the dashboard to get its current cards
    const dashboardResponse = await axios.get(
      `${METABASE_URL}/api/dashboard/${dashboardId}`,
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`
        }
      }
    );
    
    const dashboard = dashboardResponse.data;
    const existingCardIds = dashboard.ordered_cards?.map(c => c.card_id) || [];
    
    // Check if card already exists
    if (existingCardIds.includes(questionId)) {
      console.log(`Card ${questionId} already in dashboard`);
      return { id: questionId, success: true };
    }
    
    // Try the correct Metabase API endpoint for adding cards
    // Metabase uses /api/dashboard/:id/cards endpoint
    const response = await axios.post(
      `${METABASE_URL}/api/dashboard/${dashboardId}/cards`,
      {
        cardId: questionId,
        row: row,
        col: col,
        sizeX: sizeX,
        sizeY: sizeY,
        parameter_mappings: [],
        visualization_settings: {}
      },
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    // Card might already be added or endpoint might be different
    if (error.response?.status === 400 || error.response?.status === 404) {
      // Try alternative endpoint format
      return null;
    }
    console.error(`Error adding card ${questionId}:`, error.response?.data || error.message);
    return null;
  }
}

/**
 * Update dashboard with cards (alternative method)
 */
async function updateDashboardCards(dashboardId, cardIds, positions = []) {
  try {
    // Get current dashboard
    const dashboardResponse = await axios.get(
      `${METABASE_URL}/api/dashboard/${dashboardId}`,
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`
        }
      }
    );
    
    const dashboard = dashboardResponse.data;
    const existingCardIds = dashboard.ordered_cards?.map(c => c.card_id) || [];
    
    // Filter out cards that already exist
    const newCardIds = cardIds.filter(id => !existingCardIds.includes(id));
    
    if (newCardIds.length === 0) {
      console.log('All cards already in dashboard');
      return dashboard;
    }
    
    // Create cards array with positions
    // Use negative IDs for new cards
    let nextTempId = -1;
    const cards = newCardIds.map((cardId, index) => {
      const pos = positions[index] || { row: Math.floor(index / 2) * 6, col: (index % 2) * 6, sizeX: 6, sizeY: 6 };
      return {
        id: nextTempId--, // Temporary negative ID
        card_id: cardId,
        row: pos.row,
        col: pos.col,
        sizeX: pos.sizeX || 6,
        sizeY: pos.sizeY || 6,
        series: [],
        parameter_mappings: [],
        visualization_settings: {}
      };
    });
    
    // Prepare dashboard update payload
    const updatePayload = {
      name: dashboard.name,
      description: dashboard.description,
      parameters: dashboard.parameters || [],
      ordered_cards: [...(dashboard.ordered_cards || []), ...cards],
      dashcards: [...(dashboard.ordered_cards || []), ...cards] // Some API versions use dashcards
    };
    
    // Update dashboard
    const response = await axios.put(
      `${METABASE_URL}/api/dashboard/${dashboardId}`,
      updatePayload,
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Successfully added ${newCardIds.length} cards to dashboard ${dashboardId}`);
    return response.data;
  } catch (error) {
    console.error('Error updating dashboard cards:', error.response?.data || error.message);
    // Try alternative: add cards one by one using dashboard card endpoint
    throw error;
  }
}

/**
 * Add card to dashboard using dashboard card endpoint (alternative method)
 * This method directly updates the dashboard's ordered_cards array
 */
async function addCardToDashboardDirect(dashboardId, questionId, row = 0, col = 0, sizeX = 6, sizeY = 6) {
  try {
    // Get current dashboard
    const dashboardResponse = await axios.get(
      `${METABASE_URL}/api/dashboard/${dashboardId}`,
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`
        }
      }
    );
    
    const dashboard = dashboardResponse.data;
    const existingCards = dashboard.ordered_cards || [];
    
    // Check if card already exists
    if (existingCards.some(c => c.card_id === questionId)) {
      return { id: questionId, success: true, message: 'already exists' };
    }
    
    // Find the next available temporary ID (negative numbers)
    const existingTempIds = existingCards
      .filter(c => c.id < 0)
      .map(c => Math.abs(c.id));
    const nextTempId = existingTempIds.length > 0 
      ? -(Math.max(...existingTempIds) + 1)
      : -1;
    
    // Create new card object
    const newCard = {
      id: nextTempId,
      card_id: questionId,
      row: row,
      col: col,
      sizeX: sizeX,
      sizeY: sizeY,
      series: [],
      parameter_mappings: [],
      visualization_settings: {}
    };
    
    // Update dashboard with new card
    const updateResponse = await axios.put(
      `${METABASE_URL}/api/dashboard/${dashboardId}`,
      {
        name: dashboard.name,
        description: dashboard.description,
        parameters: dashboard.parameters || [],
        ordered_cards: [...existingCards, newCard]
      },
      {
        headers: {
          'Cookie': `metabase.SESSION=${sessionToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return updateResponse.data;
  } catch (error) {
    console.error(`Error in addCardToDashboardDirect for card ${questionId}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create Monthly Metrics Dashboard
 */
async function createMonthlyDashboard() {
  try {
    console.log('\n=== Creating Monthly Metrics Dashboard ===');
    
    if (!databaseId) {
      await getDatabaseId();
    }
    
    // Create questions
    const questions = [];
    
    // 1. Leads, Units, Repairs by Source (Stacked Bar)
    const q1 = await createQuestion(
      'Monthly: Leads, Units, Repairs by Source',
      'Stacked bar chart showing leads, units, and repairs by source for each month',
      `SELECT 
        month_start,
        source,
        SUM(leads) as leads,
        SUM(units) as units,
        SUM(repairs) as repairs
      FROM vw_monthly_metrics
      GROUP BY month_start, source
      ORDER BY month_start DESC, source`,
      'bar',
      'bar'
    );
    if (q1) questions.push({ question: q1, row: 0, col: 0, sizeX: 12, sizeY: 6 });
    
    // 2. Conversion Rates (Line Chart)
    const q2 = await createQuestion(
      'Monthly: Conversion Rates',
      'Conversion rates: Leads to Units, Leads to Repairs, Units to Repairs',
      `SELECT 
        month_start,
        source,
        conv_l_u,
        conv_l_r,
        conv_u_r
      FROM vw_monthly_metrics
      ORDER BY month_start DESC, source`,
      'line',
      'line'
    );
    if (q2) questions.push({ question: q2, row: 6, col: 0, sizeX: 12, sizeY: 6 });
    
    // 3. Finance Metrics (Line Chart)
    const q3 = await createQuestion(
      'Monthly: Finance Metrics',
      'Net revenue, cost, and profit by month',
      `SELECT 
        month_start,
        source,
        net_revenue,
        cost,
        (net_revenue - cost) as profit
      FROM vw_monthly_metrics
      ORDER BY month_start DESC, source`,
      'line',
      'line'
    );
    if (q3) questions.push({ question: q3, row: 12, col: 0, sizeX: 12, sizeY: 6 });
    
    // 4. Revenue per Lead vs CPL (Line Chart)
    const q4 = await createQuestion(
      'Monthly: Revenue per Lead vs CPL',
      'Comparison of revenue per lead and cost per lead',
      `SELECT 
        month_start,
        source,
        rev_per_lead,
        cpl
      FROM vw_monthly_metrics
      WHERE rev_per_lead IS NOT NULL AND cpl IS NOT NULL
      ORDER BY month_start DESC, source`,
      'line',
      'line'
    );
    if (q4) questions.push({ question: q4, row: 18, col: 0, sizeX: 12, sizeY: 6 });
    
    // 5. KPI Comparison (Actual vs Target)
    const q5 = await createQuestion(
      'Monthly: Net Revenue vs Target',
      'Comparison of actual net revenue with target values from kpi_targets',
      `SELECT 
        vm.month_start,
        vm.source,
        vm.net_revenue as actual_revenue,
        kt.target_value as target_revenue
      FROM vw_monthly_metrics vm
      LEFT JOIN kpi_targets kt ON 
        kt.period_type = 'month' 
        AND kt.period_start = vm.month_start
        AND kt.metric = 'net_revenue'
        AND (kt.source = vm.source OR kt.source IS NULL)
      ORDER BY vm.month_start DESC, vm.source`,
      'line',
      'line'
    );
    if (q5) questions.push({ question: q5, row: 24, col: 0, sizeX: 12, sizeY: 6 });
    
    // Create dashboard
    const dashboard = await createDashboard(
      'Monthly Metrics Dashboard',
      'Monthly aggregated business metrics by source and segment'
    );
    
    // Add questions to dashboard
    if (dashboard && questions.length > 0) {
      console.log(`Adding ${questions.length} questions to dashboard...`);
      
      // Use direct method (PUT update) - this is more reliable
      const addedCards = [];
      console.log('Using direct card addition method (PUT update)...');
      for (const { question, row, col, sizeX, sizeY } of questions) {
        if (question) {
          try {
            const result = await addCardToDashboardDirect(dashboard.id, question.id, row, col, sizeX, sizeY);
            if (result && !result.message) {
              addedCards.push(question.id);
              console.log(`  ✓ Added card ${question.id}`);
            } else if (result && result.message === 'already exists') {
              addedCards.push(question.id);
              console.log(`  ✓ Card ${question.id} already exists`);
            }
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error) {
            console.log(`  ✗ Could not add card ${question.id}: ${error.message}`);
          }
        }
      }
      
      // If direct method failed, try batch update
      if (addedCards.length === 0 && questions.length > 0) {
        console.log('Trying batch update method...');
        const cardIds = questions.filter(q => q.question).map(q => q.question.id);
        const positions = questions.filter(q => q.question).map(q => ({
          row: q.row,
          col: q.col,
          sizeX: q.sizeX,
          sizeY: q.sizeY
        }));
        try {
          await updateDashboardCards(dashboard.id, cardIds, positions);
          console.log('✅ Cards added via batch update');
          addedCards.push(...cardIds);
        } catch (error) {
          console.log('⚠️  Warning: Could not automatically add cards to dashboard');
          console.log(`Dashboard ID: ${dashboard.id}`);
          console.log(`Question IDs: ${cardIds.join(', ')}`);
          console.log(`Please add them manually at: ${METABASE_URL}/dashboard/${dashboard.id}`);
          console.log('Or run the script again to retry');
        }
      } else if (addedCards.length > 0) {
        console.log(`✅ Successfully added ${addedCards.length} cards to dashboard`);
      }
      
      console.log(`✅ Monthly Metrics Dashboard created: ${METABASE_URL}/dashboard/${dashboard.id}`);
    }
    
    return dashboard;
  } catch (error) {
    console.error('Error creating Monthly Metrics Dashboard:', error.message);
    throw error;
  }
}

/**
 * Create Daily Cumulative Dashboard
 */
async function createDailyCumulativeDashboard() {
  try {
    console.log('\n=== Creating Daily Cumulative Dashboard ===');
    
    if (!databaseId) {
      await getDatabaseId();
    }
    
    // Create questions
    const questions = [];
    
    // 1. Cumulative Repairs
    const q1 = await createQuestion(
      'Daily Cumulative: Repairs',
      'Cumulative repairs for current month',
      `SELECT
        d as date,
        SUM(repairs) OVER (ORDER BY d) AS repairs_cum
      FROM vw_daily_metrics
      WHERE d >= date_trunc('month', current_date)
        AND d <= current_date
      ORDER BY d`,
      'line',
      'line'
    );
    if (q1) questions.push({ question: q1, row: 0, col: 0, sizeX: 12, sizeY: 6 });
    
    // 2. Cumulative Net Revenue
    const q2 = await createQuestion(
      'Daily Cumulative: Net Revenue',
      'Cumulative net revenue for current month',
      `SELECT
        d as date,
        SUM(net_revenue) OVER (ORDER BY d) AS net_rev_cum
      FROM vw_daily_metrics
      WHERE d >= date_trunc('month', current_date)
        AND d <= current_date
      ORDER BY d`,
      'line',
      'line'
    );
    if (q2) questions.push({ question: q2, row: 6, col: 0, sizeX: 12, sizeY: 6 });
    
    // 3. Cumulative Leads, Units, Repairs (all together)
    const q3 = await createQuestion(
      'Daily Cumulative: All Metrics',
      'Cumulative leads, units, and repairs for current month',
      `SELECT
        d as date,
        SUM(leads) OVER (ORDER BY d) AS leads_cum,
        SUM(units) OVER (ORDER BY d) AS units_cum,
        SUM(repairs) OVER (ORDER BY d) AS repairs_cum
      FROM vw_daily_metrics
      WHERE d >= date_trunc('month', current_date)
        AND d <= current_date
      ORDER BY d`,
      'line',
      'line'
    );
    if (q3) questions.push({ question: q3, row: 12, col: 0, sizeX: 12, sizeY: 6 });
    
    // Create dashboard
    const dashboard = await createDashboard(
      'Daily Cumulative Dashboard',
      'Daily cumulative metrics for the current month'
    );
    
    // Add questions to dashboard
    if (dashboard && questions.length > 0) {
      console.log(`Adding ${questions.length} questions to dashboard...`);
      
      // Try adding cards one by one
      const addedCards = [];
      for (const { question, row, col, sizeX, sizeY } of questions) {
        if (question) {
          const result = await addCardToDashboard(dashboard.id, question.id, row, col, sizeX, sizeY);
          if (result) {
            addedCards.push(question.id);
          }
          await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
        }
      }
      
      // If individual card addition failed, try direct method (PUT update)
      if (addedCards.length === 0 && questions.length > 0) {
        console.log('Trying direct card addition method (PUT update)...');
        for (const { question, row, col, sizeX, sizeY } of questions) {
          if (question) {
            try {
              const result = await addCardToDashboardDirect(dashboard.id, question.id, row, col, sizeX, sizeY);
              if (result && !result.message) {
                addedCards.push(question.id);
                console.log(`  ✓ Added card ${question.id}`);
              } else if (result && result.message === 'already exists') {
                addedCards.push(question.id);
                console.log(`  ✓ Card ${question.id} already exists`);
              }
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
              console.log(`  ✗ Could not add card ${question.id}: ${error.message}`);
            }
          }
        }
      }
      
      // If still no cards added, try batch update
      if (addedCards.length === 0 && questions.length > 0) {
        console.log('Trying batch update method...');
        const cardIds = questions.filter(q => q.question).map(q => q.question.id);
        const positions = questions.filter(q => q.question).map(q => ({
          row: q.row,
          col: q.col,
          sizeX: q.sizeX,
          sizeY: q.sizeY
        }));
        try {
          await updateDashboardCards(dashboard.id, cardIds, positions);
          console.log('✅ Cards added via batch update');
          addedCards.push(...cardIds);
        } catch (error) {
          console.log('⚠️  Warning: Could not automatically add cards to dashboard');
          console.log(`Dashboard ID: ${dashboard.id}`);
          console.log(`Question IDs: ${cardIds.join(', ')}`);
          console.log(`Please add them manually at: ${METABASE_URL}/dashboard/${dashboard.id}`);
          console.log('Or run the script again to retry');
        }
      } else if (addedCards.length > 0) {
        console.log(`✅ Successfully added ${addedCards.length} cards to dashboard`);
      }
      
      console.log(`✅ Daily Cumulative Dashboard created: ${METABASE_URL}/dashboard/${dashboard.id}`);
    }
    
    return dashboard;
  } catch (error) {
    console.error('Error creating Daily Cumulative Dashboard:', error.message);
    throw error;
  }
}

/**
 * Main setup function
 */
async function main() {
  try {
    console.log('Starting Metabase automated setup...');
    console.log(`Metabase URL: ${METABASE_URL}`);
    
    // Wait for Metabase to be ready
    await waitForMetabase();
    
    // Check if setup is needed
    const { needsSetup, setupToken } = await checkSetupStatus();
    
    if (needsSetup && setupToken) {
      // Create admin account
      await createAdminAccount(setupToken);
      
      // Wait a bit for account to be created
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Login to get session token
    await login();
    
    if (!sessionToken) {
      throw new Error('Failed to obtain session token');
    }
    
    // Add PostgreSQL data source
    const db = await addPostgreSQLDataSource();
    if (db && db.id) {
      databaseId = db.id;
    }
    
    // Wait for database sync
    console.log('Waiting for database schema sync...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Create dashboards
    await createMonthlyDashboard();
    await createDailyCumulativeDashboard();
    
    console.log('\n✅ Metabase setup completed successfully!');
    console.log(`\nYou can now access Metabase at: ${METABASE_URL}`);
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
    console.log('\nDashboards created:');
    console.log('- Monthly Metrics Dashboard');
    console.log('- Daily Cumulative Dashboard');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run setup
if (require.main === module) {
  main();
}

module.exports = { main };

