# Metabase Setup Instructions

## Automated Setup (Recommended)

Metabase can be configured automatically using the setup script:

```bash
npm run setup-metabase
```

This script will:
1. Wait for Metabase to be ready
2. Create admin account (if not exists)
3. Add PostgreSQL data source
4. Configure sync schedules

### Environment Variables

You can customize the setup using environment variables:

```bash
export METABASE_URL="https://abc-metrics-metabase.fly.dev"
export METABASE_ADMIN_EMAIL="help@bostonmasters.com"
export METABASE_ADMIN_PASSWORD="Alga!B@r2"
export MB_DB_HOST="pgbouncer.9g6y30w2qg60v5ml.flympg.net"
export MB_DB_PORT="5432"
export MB_DB_DBNAME="fly-db"
export MB_DB_USER="fly-user"
export MB_DB_PASS="mJHdkZbWGckg31sOb5RASQo3"

npm run setup-metabase
```

## Manual Setup

If you prefer to set up Metabase manually:

### 1. Create Admin Account

1. Open https://abc-metrics-metabase.fly.dev
2. Fill in the setup form:
   - First name: Admin
   - Last name: User
   - Email: help@bostonmasters.com
   - Password: Alga!B@r2
   - Company name: ABC Metrics

### 2. Add PostgreSQL Data Source

1. Go to **Admin** → **Databases** → **Add database**
2. Select **PostgreSQL**
3. Enter connection details:
   - Display name: ABC Metrics PostgreSQL
   - Host: pgbouncer.9g6y30w2qg60v5ml.flympg.net
   - Port: 5432
   - Database name: fly-db
   - Username: fly-user
   - Password: mJHdkZbWGckg31sOb5RASQo3
   - SSL: Required
4. Click **Save**

### 3. Verify Connection

After adding the database, Metabase will:
- Test the connection
- Sync database schema
- Discover tables and views

You should see:
- `vw_monthly_metrics` view
- `vw_daily_metrics` view
- `kpi_targets` table
- Other fact and dimension tables

## Creating Dashboards

### Monthly Metrics Dashboard

1. Go to **Browse Data** → **ABC Metrics PostgreSQL**
2. Select **vw_monthly_metrics** view
3. Create questions for:
   - Leads, Units, Repairs by Source (Stacked Bar)
   - Conversion Rates (Line Chart)
   - Finance Metrics (Line Chart)
   - Revenue per Lead vs CPL (Line Chart)
   - KPI Comparison (Line Chart with target overlay)
4. Create a new dashboard and add all questions

### Daily Cumulative Dashboard

1. Create a new question using SQL:
   ```sql
   SELECT
     d as date,
     SUM(leads) OVER (ORDER BY d) AS leads_cum,
     SUM(units) OVER (ORDER BY d) AS units_cum,
     SUM(repairs) OVER (ORDER BY d) AS repairs_cum,
     SUM(net_revenue) OVER (ORDER BY d) AS net_rev_cum
   FROM vw_daily_metrics
   WHERE d >= date_trunc('month', current_date)
     AND d <= current_date
     AND source = {{source}}
   ORDER BY d
   ```
2. Add filters for source selection
3. Create visualizations for cumulative metrics
4. Add to dashboard

## Troubleshooting

### Script fails with "Metabase is not ready"

- Wait a few minutes after deployment
- Check Metabase logs: `flyctl logs -a abc-metrics-metabase`
- Ensure Metabase is accessible: `curl https://abc-metrics-metabase.fly.dev`

### Database connection fails

- Verify database credentials are correct
- Check that PostgreSQL database is running
- Ensure SSL is set to "Required"
- Check network connectivity from Metabase to database

### Admin account already exists

- The script will skip admin creation if account exists
- Use existing credentials to log in
- Script will still add data source if missing





