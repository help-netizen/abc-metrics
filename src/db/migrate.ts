import pool from './connection';
import { ensureSchemaMigrationsTable, isMigrationApplied, markMigrationApplied } from './migrations/schema';

async function migrate() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Создать таблицу для отслеживания миграций
    await ensureSchemaMigrationsTable();

    // ========== MIGRATION 1: Initial Schema ==========
    if (!(await isMigrationApplied(1))) {
      console.log('Applying migration 1: Initial schema...');
      
      // ========== DIMENSIONS (SPRAVOCHNIKI) ==========
      
      // dim_source - справочник источников
      await client.query(`
        CREATE TABLE IF NOT EXISTS dim_source (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT
        )
      `);

      // Заполнить dim_source начальными данными
      await client.query(`
        INSERT INTO dim_source (code, name) VALUES
          ('elocals', 'eLocals'),
          ('google', 'Google'),
          ('rely', 'Rely'),
          ('nsa', 'NSA'),
          ('liberty', 'Liberty'),
          ('retention', 'Retention'),
          ('pro_referral', 'Pro Referral'),
          ('website', 'Website'),
          ('workiz', 'Workiz')
        ON CONFLICT (code) DO NOTHING
      `);

      // dim_date - справочник дат
      await client.query(`
        CREATE TABLE IF NOT EXISTS dim_date (
          d DATE PRIMARY KEY
        )
      `);
      
      // Удалить колонку month_start если она существует (миграция с GENERATED ALWAYS AS)
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'dim_date' 
            AND column_name = 'month_start'
          ) THEN
            ALTER TABLE dim_date DROP COLUMN month_start;
          END IF;
        END $$;
      `);

      // Заполнить dim_date датами на год вперед и назад
      await client.query(`
        INSERT INTO dim_date (d)
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '1 year',
          CURRENT_DATE + INTERVAL '1 year',
          '1 day'::interval
        )::date
        ON CONFLICT (d) DO NOTHING
      `);

      // ========== FACTS (FAKTY) ==========

      // fact_leads - лиды из Workiz
      await client.query(`
        CREATE TABLE IF NOT EXISTS fact_leads (
          lead_id VARCHAR(255) PRIMARY KEY,
          created_at TIMESTAMP NOT NULL,
          source_id INTEGER REFERENCES dim_source(id),
          phone_hash TEXT,
          raw_source TEXT,
          cost NUMERIC(10,2) DEFAULT 0,
          meta JSONB,
          created_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // fact_jobs - работы из Workiz
      await client.query(`
        CREATE TABLE IF NOT EXISTS fact_jobs (
          job_id VARCHAR(255) PRIMARY KEY,
          lead_id VARCHAR(255) REFERENCES fact_leads(lead_id),
          created_at TIMESTAMP NOT NULL,
          scheduled_at TIMESTAMP,
          source_id INTEGER REFERENCES dim_source(id),
          type TEXT,
          client_id VARCHAR(255),
          meta JSONB,
          created_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // fact_payments - платежи из Workiz
      await client.query(`
        CREATE TABLE IF NOT EXISTS fact_payments (
          payment_id VARCHAR(255) PRIMARY KEY,
          job_id VARCHAR(255) REFERENCES fact_jobs(job_id),
          paid_at TIMESTAMP,
          amount NUMERIC(10,2) NOT NULL,
          method TEXT,
          meta JSONB,
          created_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // ========== LEGACY TABLES (для обратной совместимости) ==========
      
      // Jobs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id SERIAL PRIMARY KEY,
          job_id VARCHAR(255) UNIQUE,
          date DATE NOT NULL,
          type VARCHAR(100) NOT NULL,
          source VARCHAR(100),
          segment VARCHAR(50),
          unit VARCHAR(255),
          repair_type VARCHAR(255),
          cost DECIMAL(10, 2),
          revenue DECIMAL(10, 2),
          status VARCHAR(50),
          raw_data JSONB,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Payments table
      await client.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          payment_id VARCHAR(255) UNIQUE,
          job_id VARCHAR(255) NOT NULL,
          date DATE NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          payment_type VARCHAR(100),
          source VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
        )
      `);

      // Calls table
      await client.query(`
        CREATE TABLE IF NOT EXISTS calls (
          id SERIAL PRIMARY KEY,
          call_id VARCHAR(255) UNIQUE NOT NULL,
          date DATE NOT NULL,
          duration INTEGER,
          call_type VARCHAR(100),
          source VARCHAR(100) NOT NULL DEFAULT 'elocals',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT calls_call_id_key UNIQUE (call_id)
        )
      `);

      // Elocals leads table
      await client.query(`
        CREATE TABLE IF NOT EXISTS elocals_leads (
          id SERIAL PRIMARY KEY,
          lead_id VARCHAR(255) UNIQUE,
          date DATE NOT NULL,
          lead_type VARCHAR(100),
          status VARCHAR(50),
          cost DECIMAL(10, 2) DEFAULT 0,
          current_status VARCHAR(50),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Leads table (universal table for all Workiz leads)
      await client.query(`
        CREATE TABLE IF NOT EXISTS leads (
          lead_id VARCHAR(255) PRIMARY KEY,
          source VARCHAR(100) NOT NULL,
          status VARCHAR(100) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ,
          job_id VARCHAR(255),
          client_phone VARCHAR(50),
          client_name VARCHAR(255),
          raw_payload JSONB,
          created_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Google spend table
      await client.query(`
        CREATE TABLE IF NOT EXISTS google_spend (
          id SERIAL PRIMARY KEY,
          date DATE NOT NULL,
          month DATE NOT NULL,
          campaign VARCHAR(255),
          amount DECIMAL(10, 2) NOT NULL,
          impressions INTEGER,
          clicks INTEGER,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(date, campaign)
        )
      `);

      // Daily metrics table
      await client.query(`
        CREATE TABLE IF NOT EXISTS daily_metrics (
          id SERIAL PRIMARY KEY,
          date DATE NOT NULL,
          source VARCHAR(100),
          segment VARCHAR(50),
          leads INTEGER DEFAULT 0,
          units INTEGER DEFAULT 0,
          repairs INTEGER DEFAULT 0,
          revenue_gross DECIMAL(10, 2) DEFAULT 0,
          revenue40 DECIMAL(10, 2) DEFAULT 0,
          cost DECIMAL(10, 2) DEFAULT 0,
          profit DECIMAL(10, 2) DEFAULT 0,
          calls INTEGER DEFAULT 0,
          google_spend DECIMAL(10, 2) DEFAULT 0,
          cpl DECIMAL(10, 2),
          conv_l_to_r DECIMAL(5, 4),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(date, source, segment)
        )
      `);

      // Monthly metrics table
      await client.query(`
        CREATE TABLE IF NOT EXISTS monthly_metrics (
          id SERIAL PRIMARY KEY,
          month DATE NOT NULL,
          source VARCHAR(100),
          segment VARCHAR(50),
          leads INTEGER DEFAULT 0,
          units INTEGER DEFAULT 0,
          repairs INTEGER DEFAULT 0,
          revenue_gross DECIMAL(10, 2) DEFAULT 0,
          revenue40 DECIMAL(10, 2) DEFAULT 0,
          cost DECIMAL(10, 2) DEFAULT 0,
          profit DECIMAL(10, 2) DEFAULT 0,
          calls INTEGER DEFAULT 0,
          google_spend DECIMAL(10, 2) DEFAULT 0,
          cpl DECIMAL(10, 2),
          conv_l_to_r DECIMAL(5, 4),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(month, source, segment)
        )
      `);

      // Targets table
      await client.query(`
        CREATE TABLE IF NOT EXISTS targets (
          id SERIAL PRIMARY KEY,
          month DATE NOT NULL,
          source VARCHAR(100),
          segment VARCHAR(50),
          metric_type VARCHAR(50) NOT NULL,
          target_value DECIMAL(10, 2) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(month, source, segment, metric_type)
        )
      `);

      // KPI Targets table
      await client.query(`
        CREATE TABLE IF NOT EXISTS kpi_targets (
          id SERIAL PRIMARY KEY,
          period_type TEXT CHECK (period_type IN ('month','day')) NOT NULL,
          period_start DATE NOT NULL,
          source TEXT,
          metric TEXT NOT NULL,
          target_value NUMERIC NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for fact tables
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_leads_created_at ON fact_leads(created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_leads_source_id ON fact_leads(source_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_leads_phone_hash ON fact_leads(phone_hash)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_leads_meta ON fact_leads USING GIN (meta)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_jobs_created_at ON fact_jobs(created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_jobs_scheduled_at ON fact_jobs(scheduled_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_jobs_lead_id ON fact_jobs(lead_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_jobs_source_id ON fact_jobs(source_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_jobs_type ON fact_jobs(type)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_jobs_meta ON fact_jobs USING GIN (meta)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_payments_paid_at ON fact_payments(paid_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_payments_job_id ON fact_payments(job_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_fact_payments_meta ON fact_payments USING GIN (meta)');

      // Legacy indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_date ON jobs(date)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_segment ON jobs(segment)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_date_source_segment ON jobs(date, source, segment)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_raw_data ON jobs USING GIN (raw_data)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_payments_job_id ON payments(job_id)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_calls_call_id ON calls(call_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_calls_date ON calls(date)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_calls_source ON calls(source)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_calls_date_source ON calls(date, source)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_elocals_leads_date ON elocals_leads(date)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_leads_source_created_at ON leads(source, created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_leads_job_id ON leads(job_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_leads_raw_payload ON leads USING GIN (raw_payload)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_google_spend_date ON google_spend(date)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_google_spend_month ON google_spend(month)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_daily_metrics_source ON daily_metrics(source)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_daily_metrics_segment ON daily_metrics(segment)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_daily_metrics_date_source_segment ON daily_metrics(date, source, segment)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_monthly_metrics_month ON monthly_metrics(month)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_monthly_metrics_source ON monthly_metrics(source)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_monthly_metrics_segment ON monthly_metrics(segment)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_monthly_metrics_month_source_segment ON monthly_metrics(month, source, segment)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_targets_month ON targets(month)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_targets_metric_type ON targets(metric_type)');

      // Create indexes for kpi_targets
      await client.query('CREATE INDEX IF NOT EXISTS idx_kpi_targets_period ON kpi_targets(period_type, period_start)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_kpi_targets_source ON kpi_targets(source)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_kpi_targets_metric ON kpi_targets(metric)');

      await markMigrationApplied(1, 'Initial schema');
      console.log('Migration 1 completed');
    }

    // ========== MIGRATION 2: Add columns to fact_jobs ==========
    if (!(await isMigrationApplied(2))) {
      console.log('Applying migration 2: Add columns to fact_jobs...');
      
      const existingColumnsResult = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'fact_jobs'
      `);
      const existingColumns = existingColumnsResult.rows.map(row => row.column_name);

      if (!existingColumns.includes('serial_id')) {
        console.log('Adding column: serial_id');
        await client.query('ALTER TABLE fact_jobs ADD COLUMN serial_id INTEGER');
      }
      if (!existingColumns.includes('technician_name')) {
        console.log('Adding column: technician_name');
        await client.query('ALTER TABLE fact_jobs ADD COLUMN technician_name TEXT');
      }
      if (!existingColumns.includes('job_amount_due')) {
        console.log('Adding column: job_amount_due');
        await client.query('ALTER TABLE fact_jobs ADD COLUMN job_amount_due NUMERIC(10,2)');
      }
      if (!existingColumns.includes('job_total_price')) {
        console.log('Adding column: job_total_price');
        await client.query('ALTER TABLE fact_jobs ADD COLUMN job_total_price NUMERIC(10,2)');
      }
      if (!existingColumns.includes('job_end_date_time')) {
        console.log('Adding column: job_end_date_time');
        await client.query('ALTER TABLE fact_jobs ADD COLUMN job_end_date_time TIMESTAMP');
      }
      if (!existingColumns.includes('last_status_update')) {
        console.log('Adding column: last_status_update');
        await client.query('ALTER TABLE fact_jobs ADD COLUMN last_status_update TIMESTAMP');
      }

      await markMigrationApplied(2, 'Add columns to fact_jobs');
      console.log('Migration 2 completed');
    }

    // ========== MIGRATION 3: Create Views ==========
    if (!(await isMigrationApplied(3))) {
      console.log('Applying migration 3: Create views...');
      
      // View for job metrics (Units/Repairs/Net Revenue)
      await client.query(`
        CREATE OR REPLACE VIEW vw_job_metrics AS
        SELECT
          j.job_id,
          j.source_id,
          date_trunc('day', j.created_at)::date AS d,
          j.type,
          COALESCE(p.total_amount, 0) AS gross_revenue,
          COALESCE(p.total_amount, 0) * 0.40 AS net_revenue,
          -- Unit: Type IN ('COD Service','INS Service')
          (j.type IN ('COD Service','INS Service')) AS is_unit,
          -- Repair: Type IN ('COD Repair','INS Repair') OR (Type = 'COD Service' AND payments > 100)
          (
            j.type IN ('COD Repair','INS Repair') OR
            (j.type = 'COD Service' AND COALESCE(p.total_amount, 0) > 100)
          ) AS is_repair
        FROM fact_jobs j
        LEFT JOIN (
          SELECT 
            job_id,
            SUM(amount) AS total_amount
          FROM fact_payments
          GROUP BY job_id
        ) p ON p.job_id = j.job_id
      `);
      console.log('Created VIEW vw_job_metrics');

      // View for daily metrics (by date, source, and segment)
      await client.query(`
        CREATE OR REPLACE VIEW vw_daily_metrics AS
        SELECT
          dd.d,
          s.code AS source,
          CASE 
            WHEN m.type LIKE '%COD%' THEN 'COD'
            WHEN m.type LIKE '%INS%' THEN 'INS'
            ELSE 'OTHER'
          END AS segment,
          COUNT(DISTINCT l.lead_id) AS leads,
          SUM(CASE WHEN m.is_unit THEN 1 ELSE 0 END) AS units,
          SUM(CASE WHEN m.is_repair THEN 1 ELSE 0 END) AS repairs,
          -- Conversions
          CASE WHEN COUNT(DISTINCT l.lead_id) > 0
               THEN SUM(CASE WHEN m.is_unit THEN 1 ELSE 0 END)::numeric
                    / COUNT(DISTINCT l.lead_id)
               ELSE 0 END AS conv_l_u,
          CASE WHEN COUNT(DISTINCT l.lead_id) > 0
               THEN SUM(CASE WHEN m.is_repair THEN 1 ELSE 0 END)::numeric
                    / COUNT(DISTINCT l.lead_id)
               ELSE 0 END AS conv_l_r,
          CASE WHEN SUM(CASE WHEN m.is_unit THEN 1 ELSE 0 END) > 0
               THEN SUM(CASE WHEN m.is_repair THEN 1 ELSE 0 END)::numeric
                    / SUM(CASE WHEN m.is_unit THEN 1 ELSE 0 END)
               ELSE 0 END AS conv_u_r,
          SUM(m.net_revenue) AS net_revenue,
          -- CPL/CPU: sum(cost) / leads/units
          SUM(l.cost) AS total_cost,
          CASE WHEN COUNT(DISTINCT l.lead_id) > 0
               THEN SUM(l.cost) / COUNT(DISTINCT l.lead_id)
               ELSE 0 END AS cpl,
          CASE WHEN SUM(CASE WHEN m.is_unit THEN 1 ELSE 0 END) > 0
               THEN SUM(l.cost) / SUM(CASE WHEN m.is_unit THEN 1 ELSE 0 END)
               ELSE 0 END AS cpu
        FROM dim_date dd
        LEFT JOIN fact_leads l ON date_trunc('day', l.created_at)::date = dd.d
        LEFT JOIN fact_jobs j ON j.lead_id = l.lead_id
        LEFT JOIN vw_job_metrics m ON m.job_id = j.job_id
        LEFT JOIN dim_source s ON s.id = COALESCE(j.source_id, l.source_id)
        GROUP BY dd.d, s.code, 
          CASE 
            WHEN m.type LIKE '%COD%' THEN 'COD'
            WHEN m.type LIKE '%INS%' THEN 'INS'
            ELSE 'OTHER'
          END
      `);
      console.log('Created VIEW vw_daily_metrics');

      // View for monthly metrics (aggregated from vw_daily_metrics)
      await client.query(`
        CREATE OR REPLACE VIEW vw_monthly_metrics AS
        SELECT
          date_trunc('month', d)::date AS month_start,
          source,
          segment,
          SUM(leads) AS leads,
          SUM(units) AS units,
          SUM(repairs) AS repairs,
          SUM(net_revenue) AS net_revenue,
          SUM(total_cost) AS cost,
          SUM(units)::numeric / NULLIF(SUM(leads), 0) AS conv_l_u,
          SUM(repairs)::numeric / NULLIF(SUM(leads), 0) AS conv_l_r,
          SUM(repairs)::numeric / NULLIF(SUM(units), 0) AS conv_u_r,
          SUM(net_revenue) / NULLIF(SUM(leads), 0) AS rev_per_lead,
          SUM(net_revenue) / NULLIF(SUM(units), 0) AS rev_per_unit,
          SUM(net_revenue) / NULLIF(SUM(repairs), 0) AS rev_per_repair,
          SUM(total_cost) / NULLIF(SUM(leads), 0) AS cpl,
          SUM(total_cost) / NULLIF(SUM(units), 0) AS cpu
        FROM vw_daily_metrics
        GROUP BY date_trunc('month', d), source, segment
      `);
      console.log('Created VIEW vw_monthly_metrics');

      await markMigrationApplied(3, 'Create views');
      console.log('Migration 3 completed');
    }

    // ========== MIGRATION 4: Rate Me Tables ==========
    if (!(await isMigrationApplied(4))) {
      console.log('Applying migration 4: Rate Me tables...');
      
      // job_tokens - токены для работ в Rate Me системе
      await client.query(`
        CREATE TABLE IF NOT EXISTS job_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_uuid VARCHAR(255) NOT NULL,
          job_serial_id INTEGER,
          customer_id VARCHAR(255) NOT NULL,
          token TEXT NOT NULL,
          customer_email VARCHAR(255),
          customer_phone VARCHAR(255),
          customer_first_name VARCHAR(255),
          customer_last_name VARCHAR(255),
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          sent_via VARCHAR(50),
          sent_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          meta JSONB,
          lead_id VARCHAR(255),
          source_id VARCHAR(255),
          created_at_db TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at_db TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT chk_status CHECK (status IN ('pending', 'sent', 'expired', 'used')),
          CONSTRAINT chk_sent_via CHECK (sent_via IN ('email', 'sms', 'both') OR sent_via IS NULL)
        )
      `);
      
      // Если таблица уже существует с FOREIGN KEY - удаляем его (миграция для существующих установок)
      const fkCheckResult = await client.query(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'job_tokens' 
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%job_uuid%'
      `);
      
      if (fkCheckResult.rows.length > 0) {
        for (const row of fkCheckResult.rows) {
          console.log(`Removing FOREIGN KEY constraint: ${row.constraint_name}`);
          await client.query(`ALTER TABLE job_tokens DROP CONSTRAINT IF EXISTS ${row.constraint_name}`);
        }
      }

      // referral_links - реферальные ссылки для клиентов
      await client.query(`
        CREATE TABLE IF NOT EXISTS referral_links (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id VARCHAR(255) NOT NULL UNIQUE,
          referral_slug VARCHAR(255) NOT NULL UNIQUE,
          customer_first_name VARCHAR(255),
          customer_last_name VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // referral_shares - информация об отправленных реферальных ссылках
      await client.query(`
        CREATE TABLE IF NOT EXISTS referral_shares (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          referral_link_id UUID NOT NULL,
          recipient_phone VARCHAR(255) NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_referral_link FOREIGN KEY (referral_link_id) REFERENCES referral_links(id) ON DELETE CASCADE
        )
      `);

      // rewards - награды (perks) для клиентов
      await client.query(`
        CREATE TABLE IF NOT EXISTS rewards (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id VARCHAR(255) NOT NULL,
          job_id VARCHAR(255),
          new_job_id VARCHAR(255),
          type VARCHAR(50) NOT NULL,
          amount DECIMAL(10, 2) NOT NULL,
          currency VARCHAR(3) NOT NULL DEFAULT 'USD',
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT chk_reward_type CHECK (type IN ('review_perk', 'share_perk', 'referral_payout')),
          CONSTRAINT chk_reward_status CHECK (status IN ('pending', 'approved', 'paid', 'cancelled'))
        )
      `);

      // rate_me_events - события Rate Me системы для аналитики
      await client.query(`
        CREATE TABLE IF NOT EXISTS rate_me_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_type VARCHAR(255) NOT NULL,
          job_id VARCHAR(255),
          customer_id VARCHAR(255),
          data JSONB,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes for Rate Me tables
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_job_tokens_job_uuid ON job_tokens (job_uuid)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_job_tokens_job_serial_id ON job_tokens (job_serial_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_job_tokens_customer_id ON job_tokens (customer_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_job_tokens_status ON job_tokens (status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_job_tokens_expires_at ON job_tokens (expires_at)');
      
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_links_slug ON referral_links (referral_slug)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_referral_links_customer_id ON referral_links (customer_id)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_referral_shares_link_id ON referral_shares (referral_link_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_referral_shares_phone ON referral_shares (recipient_phone)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_referral_shares_sent_at ON referral_shares (sent_at)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_rewards_customer_id ON rewards (customer_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rewards_job_id ON rewards (job_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rewards_type ON rewards (type)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rewards_status ON rewards (status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rewards_created_at ON rewards (created_at)');
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_rate_me_events_type ON rate_me_events (event_type)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rate_me_events_job_id ON rate_me_events (job_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rate_me_events_customer_id ON rate_me_events (customer_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rate_me_events_created_at ON rate_me_events (created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_rate_me_events_data ON rate_me_events USING GIN (data)');

      await markMigrationApplied(4, 'Rate Me tables');
      console.log('Migration 4 completed');
    }

    // ========== MIGRATION 5: Extend elocals_leads table ==========
    if (!(await isMigrationApplied(5))) {
      console.log('Applying migration 5: Extend elocals_leads table...');

      // Основные поля из CSV
      await client.query(`
        ALTER TABLE elocals_leads
        ADD COLUMN IF NOT EXISTS unique_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS time TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS duration INTEGER,
        ADD COLUMN IF NOT EXISTS forwarding_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS caller_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS caller_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS profile VARCHAR(255),
        ADD COLUMN IF NOT EXISTS service_city VARCHAR(100),
        ADD COLUMN IF NOT EXISTS service_state VARCHAR(50),
        ADD COLUMN IF NOT EXISTS service_zip VARCHAR(20),
        ADD COLUMN IF NOT EXISTS recording_url TEXT,
        ADD COLUMN IF NOT EXISTS profile_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS dispositions TEXT,
        ADD COLUMN IF NOT EXISTS dollar_value DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS notes TEXT
      `);

      // Контактные данные
      await client.query(`
        ALTER TABLE elocals_leads
        ADD COLUMN IF NOT EXISTS contact_first_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS contact_last_name VARCHAR(100),
        ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS contact_extension VARCHAR(20),
        ADD COLUMN IF NOT EXISTS contact_cell_phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
        ADD COLUMN IF NOT EXISTS contact_address TEXT,
        ADD COLUMN IF NOT EXISTS contact_city VARCHAR(100),
        ADD COLUMN IF NOT EXISTS contact_state VARCHAR(50),
        ADD COLUMN IF NOT EXISTS contact_zip VARCHAR(20)
      `);

      // JSONB поле для всех данных из CSV
      await client.query(`
        ALTER TABLE elocals_leads
        ADD COLUMN IF NOT EXISTS raw_data JSONB
      `);

      await markMigrationApplied(5, 'Extend elocals_leads table');
      console.log('Migration 5 completed');
    }

    await client.query('COMMIT');
    console.log('All migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration error:', error);
      process.exit(1);
    });
}

export default migrate;
