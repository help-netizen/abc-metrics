# ABC Metrics

Database API and metrics aggregation service deployed on Fly.io. Provides RESTful API for database operations and aggregates metrics from stored data for dashboards.

**Architecture Note:** Data synchronization from external sources (Workiz, Elocal.com, CSV) is handled by `rely-lead-processor`. This application focuses on database management and metrics aggregation.

## Features

- 🗄️ PostgreSQL database storage and management
- 🌐 RESTful JSON API for database operations (read/write)
- 🔄 Scheduled metrics aggregation (daily and monthly)
- 🔐 API key authentication for database access
- 📊 Metrics endpoints for dashboards (daily/monthly metrics)

**Note:** Data synchronization from external sources (Workiz, Elocal.com, CSV) has been moved to `rely-lead-processor`. This application now focuses on:
- Database API layer (read/write operations)
- Metrics aggregation from stored data
- Serving aggregated metrics to dashboards

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

# Database API Authentication
flyctl secrets set DB_API_KEY="your-secure-api-key" -a abc-metrics
```

**Note:** Workiz, Elocal, and CSV synchronization credentials are now configured in `rely-lead-processor`. This application only needs database connection and API key for authentication.

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
DB_API_KEY=your-secure-api-key
PORT=3001
NODE_ENV=development
```

**Note:** For local testing, you can use the same `DB_API_KEY` that is configured in `rely-lead-processor` to allow API access.

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

- **Daily Aggregation**: Every day at 1 AM (aggregates previous day's metrics)
- **Monthly Aggregation**: 1st of each month at 2 AM (aggregates previous month's metrics)
- **Full Re-aggregation**: Every day at 3 AM (re-aggregates all metrics for data corrections)

**Note:** Data synchronization (Workiz, Elocal, CSV) is now handled by `rely-lead-processor`. This application only performs metrics aggregation from data stored in the database.

## Data Synchronization

Data synchronization from external sources is handled by `rely-lead-processor`:
- Workiz API (jobs, leads, payments)
- Elocal.com (calls)
- CSV file processing

All data is saved to this database via the `/api/db/*` endpoints.

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

