# Примеры SQL-запросов для Grafana

## 1. Месяц к месяцу по Source (из monthly_metrics)

```sql
SELECT 
  month,
  source,
  leads,
  units,
  repairs,
  revenue40,
  cost,
  profit,
  cpl,
  conv_l_to_r
FROM monthly_metrics
WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
  AND source = 'Google'  -- или другой source
ORDER BY month DESC, source;
```

### С группировкой по всем источникам:

```sql
SELECT 
  month,
  source,
  SUM(leads) as total_leads,
  SUM(units) as total_units,
  SUM(repairs) as total_repairs,
  SUM(revenue40) as total_revenue40,
  SUM(cost) as total_cost,
  SUM(profit) as total_profit,
  AVG(cpl) as avg_cpl,
  AVG(conv_l_to_r) as avg_conv_l_to_r
FROM monthly_metrics
WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
GROUP BY month, source
ORDER BY month DESC, source;
```

## 2. Ежедневный накопительный Repairs vs Target (из daily_metrics + targets)

### Накопительные Repairs по дням:

```sql
SELECT 
  date,
  source,
  segment,
  repairs,
  SUM(repairs) OVER (
    PARTITION BY source, segment 
    ORDER BY date 
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) as cumulative_repairs
FROM daily_metrics
WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
  AND source = 'Google'  -- или другой source
ORDER BY date;
```

### Repairs vs Target по месяцам:

```sql
WITH monthly_actual AS (
  SELECT 
    DATE_TRUNC('month', date) as month,
    source,
    segment,
    SUM(repairs) as actual_repairs
  FROM daily_metrics
  WHERE date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')
  GROUP BY DATE_TRUNC('month', date), source, segment
),
monthly_targets AS (
  SELECT 
    month,
    source,
    segment,
    target_value as target_repairs
  FROM targets
  WHERE metric_type = 'repairs'
    AND month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')
)
SELECT 
  COALESCE(a.month, t.month) as month,
  COALESCE(a.source, t.source) as source,
  COALESCE(a.segment, t.segment) as segment,
  COALESCE(a.actual_repairs, 0) as actual_repairs,
  COALESCE(t.target_repairs, 0) as target_repairs,
  COALESCE(a.actual_repairs, 0) - COALESCE(t.target_repairs, 0) as variance
FROM monthly_actual a
FULL OUTER JOIN monthly_targets t 
  ON a.month = t.month 
  AND a.source = t.source 
  AND a.segment = t.segment
ORDER BY month DESC, source, segment;
```

## 3. Дополнительные полезные запросы

### Revenue40 по месяцам и источникам:

```sql
SELECT 
  month,
  source,
  segment,
  revenue40,
  revenue_gross,
  cost,
  profit
FROM monthly_metrics
WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
ORDER BY month DESC, source, segment;
```

### CPL (Cost Per Lead) по источникам:

```sql
SELECT 
  month,
  source,
  leads,
  cost,
  cpl,
  CASE 
    WHEN cpl IS NULL THEN 'N/A'
    WHEN cpl <= 50 THEN 'Good'
    WHEN cpl <= 100 THEN 'Acceptable'
    ELSE 'High'
  END as cpl_status
FROM monthly_metrics
WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')
  AND leads > 0
ORDER BY month DESC, cpl DESC;
```

### Conversion Rate (Leads to Repairs):

```sql
SELECT 
  month,
  source,
  leads,
  repairs,
  conv_l_to_r as conversion_rate,
  CASE 
    WHEN conv_l_to_r >= 0.3 THEN 'Excellent'
    WHEN conv_l_to_r >= 0.2 THEN 'Good'
    WHEN conv_l_to_r >= 0.1 THEN 'Acceptable'
    ELSE 'Low'
  END as conversion_status
FROM monthly_metrics
WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')
  AND leads > 0
ORDER BY month DESC, conv_l_to_r DESC;
```

### Сравнение фактических метрик с целями:

```sql
SELECT 
  m.month,
  m.source,
  m.segment,
  t.metric_type,
  CASE t.metric_type
    WHEN 'repairs' THEN m.repairs
    WHEN 'revenue40' THEN m.revenue40
    WHEN 'conv_l_to_r' THEN m.conv_l_to_r
    WHEN 'cpl' THEN m.cpl
    ELSE NULL
  END as actual_value,
  t.target_value,
  CASE t.metric_type
    WHEN 'repairs' THEN m.repairs - t.target_value
    WHEN 'revenue40' THEN m.revenue40 - t.target_value
    WHEN 'conv_l_to_r' THEN m.conv_l_to_r - t.target_value
    WHEN 'cpl' THEN t.target_value - m.cpl  -- для CPL меньше = лучше
    ELSE NULL
  END as variance
FROM monthly_metrics m
INNER JOIN targets t 
  ON m.month = t.month 
  AND COALESCE(m.source, 'Unknown') = COALESCE(t.source, 'Unknown')
  AND COALESCE(m.segment, 'OTHER') = COALESCE(t.segment, 'OTHER')
WHERE m.month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')
ORDER BY m.month DESC, m.source, m.segment, t.metric_type;
```

### Тренд Units и Repairs по дням:

```sql
SELECT 
  date,
  source,
  units,
  repairs,
  LAG(units) OVER (PARTITION BY source ORDER BY date) as prev_units,
  LAG(repairs) OVER (PARTITION BY source ORDER BY date) as prev_repairs,
  units - LAG(units) OVER (PARTITION BY source ORDER BY date) as units_change,
  repairs - LAG(repairs) OVER (PARTITION BY source ORDER BY date) as repairs_change
FROM daily_metrics
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC, source;
```

### Топ источников по Revenue40 за последние 3 месяца:

```sql
SELECT 
  source,
  SUM(revenue40) as total_revenue40,
  SUM(cost) as total_cost,
  SUM(profit) as total_profit,
  SUM(leads) as total_leads,
  SUM(repairs) as total_repairs,
  AVG(cpl) as avg_cpl,
  AVG(conv_l_to_r) as avg_conversion_rate
FROM monthly_metrics
WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months')
GROUP BY source
ORDER BY total_revenue40 DESC;
```

