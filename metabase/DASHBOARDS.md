# Metabase Dashboards Documentation

## Overview

Two main dashboards have been created for ABC Metrics:

1. **Monthly Metrics Dashboard** - Aggregated monthly business metrics
2. **Daily Cumulative Dashboard** - Daily cumulative metrics for the current month

## Monthly Metrics Dashboard

**URL:** https://abc-metrics-metabase.fly.dev/dashboard/19

### Questions (Cards)

#### 1. Monthly: Leads, Units, Repairs by Source
- **Type:** Stacked Bar Chart
- **Description:** Shows leads, units, and repairs by source for each month
- **SQL Query:**
  ```sql
  SELECT 
    month_start,
    source,
    SUM(leads) as leads,
    SUM(units) as units,
    SUM(repairs) as repairs
  FROM vw_monthly_metrics
  GROUP BY month_start, source
  ORDER BY month_start DESC, source
  ```

#### 2. Monthly: Conversion Rates
- **Type:** Line Chart
- **Description:** Conversion rates: Leads to Units, Leads to Repairs, Units to Repairs
- **SQL Query:**
  ```sql
  SELECT 
    month_start,
    source,
    conv_l_u,
    conv_l_r,
    conv_u_r
  FROM vw_monthly_metrics
  ORDER BY month_start DESC, source
  ```

#### 3. Monthly: Finance Metrics
- **Type:** Line Chart
- **Description:** Net revenue, cost, and profit by month
- **SQL Query:**
  ```sql
  SELECT 
    month_start,
    source,
    net_revenue,
    cost,
    (net_revenue - cost) as profit
  FROM vw_monthly_metrics
  ORDER BY month_start DESC, source
  ```

#### 4. Monthly: Revenue per Lead vs CPL
- **Type:** Line Chart
- **Description:** Comparison of revenue per lead and cost per lead
- **SQL Query:**
  ```sql
  SELECT 
    month_start,
    source,
    rev_per_lead,
    cpl
  FROM vw_monthly_metrics
  WHERE rev_per_lead IS NOT NULL AND cpl IS NOT NULL
  ORDER BY month_start DESC, source
  ```

#### 5. Monthly: Net Revenue vs Target
- **Type:** Line Chart
- **Description:** Comparison of actual net revenue with target values from kpi_targets
- **SQL Query:**
  ```sql
  SELECT 
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
  ORDER BY vm.month_start DESC, vm.source
  ```

## Daily Cumulative Dashboard

**URL:** https://abc-metrics-metabase.fly.dev/dashboard/20

### Questions (Cards)

#### 1. Daily Cumulative: Repairs
- **Type:** Line Chart
- **Description:** Cumulative repairs for current month
- **SQL Query:**
  ```sql
  SELECT
    d as date,
    SUM(repairs) OVER (ORDER BY d) AS repairs_cum
  FROM vw_daily_metrics
  WHERE d >= date_trunc('month', current_date)
    AND d <= current_date
  ORDER BY d
  ```

#### 2. Daily Cumulative: Net Revenue
- **Type:** Line Chart
- **Description:** Cumulative net revenue for current month
- **SQL Query:**
  ```sql
  SELECT
    d as date,
    SUM(net_revenue) OVER (ORDER BY d) AS net_rev_cum
  FROM vw_daily_metrics
  WHERE d >= date_trunc('month', current_date)
    AND d <= current_date
  ORDER BY d
  ```

#### 3. Daily Cumulative: All Metrics
- **Type:** Line Chart
- **Description:** Cumulative leads, units, and repairs for current month
- **SQL Query:**
  ```sql
  SELECT
    d as date,
    SUM(leads) OVER (ORDER BY d) AS leads_cum,
    SUM(units) OVER (ORDER BY d) AS units_cum,
    SUM(repairs) OVER (ORDER BY d) AS repairs_cum
  FROM vw_daily_metrics
  WHERE d >= date_trunc('month', current_date)
    AND d <= current_date
  ORDER BY d
  ```

## Customization

### Adding Filters

You can add filters to dashboards to filter by:
- **Source** - Filter by data source (e.g., 'elocals', 'google', 'rely')
- **Date Range** - Filter by specific date ranges
- **Segment** - Filter by segment (COD, INS, OTHER)

### Modifying Queries

All questions use SQL queries that can be edited in Metabase:
1. Open the dashboard
2. Click on a card/question
3. Click "Edit" to modify the SQL query
4. Save changes

### Adding New Questions

To add new questions to a dashboard:
1. Create a new question in Metabase
2. Add it to the dashboard
3. Position it as needed

## Data Sources

All dashboards use the following database views:
- `vw_monthly_metrics` - Pre-aggregated monthly metrics
- `vw_daily_metrics` - Pre-aggregated daily metrics
- `kpi_targets` - Target values for KPIs

## Troubleshooting

### Dashboards not showing data

1. Check that data exists in the database views
2. Verify database connection is working
3. Check that views are synced in Metabase (Admin → Databases → Sync now)

### Questions not displaying correctly

1. Verify SQL queries are valid
2. Check that required columns exist in views
3. Ensure data types match expected visualization types

### Performance issues

1. Consider adding indexes to underlying tables
2. Use materialized views for large datasets
3. Enable caching in Metabase settings

