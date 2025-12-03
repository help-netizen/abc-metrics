# ABC Metrics

Business metrics collector deployed on Fly.io. Collects data from Workiz and CSV sources, aggregates metrics, and provides JSON API for dashboards.

## Features

- 📊 Automatic data collection from Workiz API
  - Jobs (заявки) - синхронизация каждый час
  - Leads (лиды) - синхронизация каждый час
  - Payments (платежи) - синхронизация каждый час
  - Calls (звонки) - синхронизация каждые 6 часов (опционально)
- 📞 Automatic data collection from Elocal.com
  - Calls (звонки) - синхронизация раз в день (последние 30 дней)
- 📁 CSV file processing (eLocals leads, Google spend)
- 🔄 Scheduled data aggregation (daily and monthly)
- 🗄️ PostgreSQL database storage
- 🌐 RESTful JSON API for dashboards
- ⏰ Cron-based task scheduling

## Database Schema

The application uses the following tables:
- `jobs` - Job records from Workiz and CSV
- `payments` - Payment transactions
- `calls` - Call records
- `leads` - Universal leads table from Workiz (Pro Referral, Google, Website, etc.)
- `elocals_leads` - Leads from Elocals (CSV)
- `google_spend` - Google Ads spending data
- `daily_metrics` - Aggregated daily metrics (by source and segment)
- `monthly_metrics` - Aggregated monthly metrics (by source and segment)
- `targets` - Business targets

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Set Up PostgreSQL Database

#### Option A: Fly.io PostgreSQL

```bash
# Create a PostgreSQL database
flyctl postgres create --name abc-metrics-db

# Attach it to your app
flyctl postgres attach abc-metrics-db -a abc-metrics
```

#### Option B: Supabase

1. Create a project on [Supabase](https://supabase.com)
2. Get the connection string from the project settings
3. Set it as `DATABASE_URL` environment variable

### 4. Configure Environment Variables

Set the following environment variables on Fly.io:

```bash
# Database
flyctl secrets set DATABASE_URL="postgresql://..." -a abc-metrics

# Workiz API (required for Workiz integration)
flyctl secrets set WORKIZ_API_KEY="api_scw87tvl56jom24qrph08ktc52ly3pti" -a abc-metrics
flyctl secrets set WORKIZ_API_SECRET="sec_1974068835629754589542939595" -a abc-metrics
flyctl secrets set WORKIZ_API_URL="https://api.workiz.com" -a abc-metrics

# Elocal.com credentials (required for Elocal calls integration)
flyctl secrets set ELOCAL_USERNAME="help@bostonmasters.com" -a abc-metrics
flyctl secrets set ELOCAL_PASSWORD="Alga!B@r2" -a abc-metrics

# CSV Directory (optional, for CSV processing)
flyctl secrets set CSV_DIRECTORY="./csv-data" -a abc-metrics
```

### 5. Run Database Migrations

After deployment, migrations will run automatically on startup. To run manually:

```bash
flyctl ssh console -a abc-metrics
npm run migrate
```

### 6. Deploy to Fly.io

```bash
export FLYCTL_INSTALL="/Users/rgareev91/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
flyctl deploy -a abc-metrics
```

## Development

### Run in Development Mode

```bash
npm run dev
```

### Local Environment Setup

1. Create a `.env` file:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/abc_metrics
WORKIZ_API_KEY=api_scw87tvl56jom24qrph08ktc52ly3pti
WORKIZ_API_SECRET=sec_1974068835629754589542939595
WORKIZ_API_URL=https://api.workiz.com
ELOCAL_USERNAME=help@bostonmasters.com
ELOCAL_PASSWORD=Alga!B@r2
CSV_DIRECTORY=./csv-data
PORT=3000
NODE_ENV=development
```

2. Run migrations:
```bash
npm run migrate
```

3. Start the server:
```bash
npm run dev
```

## API Endpoints

### Health Check
```
GET /api/health
```

### Metrics
```
GET /api/metrics/daily?start_date=2024-01-01&end_date=2024-01-31
GET /api/metrics/monthly?year=2024
```

### Data Sources
```
GET /api/jobs?start_date=2024-01-01&end_date=2024-01-31
GET /api/payments?start_date=2024-01-01&end_date=2024-01-31
GET /api/calls?start_date=2024-01-01&end_date=2024-01-31
GET /api/leads/elocals?start_date=2024-01-01&end_date=2024-01-31
GET /api/leads/proref?start_date=2024-01-01&end_date=2024-01-31
GET /api/google-spend?start_date=2024-01-01&end_date=2024-01-31
GET /api/targets?year=2024&month=1
```

## Scheduled Tasks

The application runs the following scheduled tasks:

- **Workiz Sync**: Every hour (syncs jobs, leads, and payments from Workiz API)
- **Elocal Calls Sync**: Every day at 4 AM (syncs calls from elocal.com for last 30 days, excluding today)
- **CSV Processing**: Every 6 hours (processes CSV files from configured directory)
- **Daily Aggregation**: Every day at 1 AM (aggregates previous day's metrics)
- **Monthly Aggregation**: 1st of each month at 2 AM (aggregates previous month's metrics)
- **Full Re-aggregation**: Every day at 3 AM (re-aggregates all metrics for data corrections)

## CSV File Format

Place CSV files in the directory specified by `CSV_DIRECTORY`. The service automatically detects table type based on filename:

- Files containing "job" or "work" → `jobs` table
- Files containing "payment" → `payments` table
- Files containing "call" → `calls` table
- Files containing "elocal" → `elocals_leads` table
- Files containing "proref" → `proref_leads` table
- Files containing "google" or "spend" → `google_spend` table

## Data Normalization

The system normalizes data to common rules:
- **Lead**: Count of leads from all sources
- **Unit**: Distinct units from jobs
- **Repair**: Count of jobs with repair_type
- **Cost**: Sum of costs from jobs, leads, and Google spend

## Configuration

The application is configured via `fly.toml` for deployment on Fly.io. Key settings:
- Primary region: `iad` (Washington, D.C.)
- Memory: 512 MB
- CPU: 1 shared CPU
- Port: 3000

## Project Structure

```
src/
├── api/
│   └── routes.ts          # API endpoints
├── db/
│   ├── connection.ts      # PostgreSQL connection
│   └── migrate.ts         # Database migrations
├── services/
│   ├── workiz.service.ts  # Workiz API integration
│   │                       # - Jobs, Leads, Payments, Calls
│   ├── svc-workiz-jobs.ts  # Workiz jobs service
│   ├── svc-workiz-leads.ts  # Workiz leads service
│   ├── svc-workiz-payments.ts  # Workiz payments service
│   ├── svc-elocal-calls.ts  # Elocal.com calls service
│   ├── csv.service.ts     # CSV file processing
│   └── aggregation.service.ts  # Metrics aggregation
├── scheduler.ts           # Cron job scheduler
└── metrics-collector.ts   # Main application entry point
```

## Workiz API Resources

Через Workiz API доступны следующие данные:
- ✅ **Jobs** - заявки (реализовано)
- ✅ **Leads** - лиды (реализовано)
- ✅ **Payments** - платежи (реализовано)
- ✅ **Calls** - звонки (реализовано, опционально)
- ⚠️ **Clients** - клиенты (не реализовано)
- ⚠️ **Invoices** - счета (не реализовано)
- ⚠️ **Schedules** - расписания (не реализовано)
- ⚠️ **Users** - пользователи (не реализовано)
- ⚠️ **Reports** - отчёты (не реализовано)

Подробнее см. [WORKIZ_API_REFERENCE.md](./WORKIZ_API_REFERENCE.md)

