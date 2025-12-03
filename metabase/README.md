# Metabase для ABC Metrics

Metabase развернут на Fly.io для визуализации бизнес-метрик из PostgreSQL базы данных.

## Доступ

- URL: https://abc-metrics-metabase.fly.dev
- Первый вход: создайте административный аккаунт при первом запуске

## Подключение к базе данных

### Настройка PostgreSQL Data Source

1. Войдите в Metabase
2. Перейдите в **Admin** → **Databases** → **Add database**
3. Выберите **PostgreSQL**
4. Заполните параметры подключения:

```
Display name: ABC Metrics PostgreSQL
Host: pgbouncer.9g6y30w2qg60v5ml.flympg.net
Port: 5432
Database name: fly-db
Username: fly-user
Password: mJHdkZbWGckg31sOb5RASQo3
SSL: Required
```

### Альтернативный способ (через DATABASE_URL)

Если нужно получить актуальные данные подключения:

```bash
flyctl secrets list -a abc-metrics
# Или
flyctl config show -a abc-metrics
```

## Доступные Views для запросов

### vw_monthly_metrics
Агрегированные месячные метрики по источникам и сегментам.

**Колонки:**
- `month_start` - начало месяца (DATE)
- `source` - источник (TEXT)
- `segment` - сегмент: COD, INS, OTHER (TEXT)
- `leads` - количество лидов (INTEGER)
- `units` - количество юнитов (INTEGER)
- `repairs` - количество ремонтов (INTEGER)
- `net_revenue` - чистая выручка (NUMERIC)
- `cost` - затраты (NUMERIC)
- `conv_l_u` - конверсия лиды → юниты (NUMERIC)
- `conv_l_r` - конверсия лиды → ремонты (NUMERIC)
- `conv_u_r` - конверсия юниты → ремонты (NUMERIC)
- `rev_per_lead` - выручка на лид (NUMERIC)
- `rev_per_unit` - выручка на юнит (NUMERIC)
- `rev_per_repair` - выручка на ремонт (NUMERIC)
- `cpl` - стоимость привлечения лида (NUMERIC)
- `cpu` - стоимость привлечения юнита (NUMERIC)

### vw_daily_metrics
Агрегированные дневные метрики по источникам и сегментам.

**Колонки:**
- `d` - дата (DATE)
- `source` - источник (TEXT)
- `segment` - сегмент (TEXT)
- `leads` - количество лидов (INTEGER)
- `units` - количество юнитов (INTEGER)
- `repairs` - количество ремонтов (INTEGER)
- `conv_l_u`, `conv_l_r`, `conv_u_r` - конверсии (NUMERIC)
- `net_revenue` - чистая выручка (NUMERIC)
- `total_cost` - общие затраты (NUMERIC)
- `cpl`, `cpu` - метрики стоимости (NUMERIC)

### kpi_targets
Целевые показатели (KPI).

**Колонки:**
- `period_type` - тип периода: 'month' или 'day' (TEXT)
- `period_start` - начало периода (DATE)
- `source` - источник (TEXT, может быть NULL для всех источников)
- `metric` - название метрики (TEXT)
- `target_value` - целевое значение (NUMERIC)

## Примеры запросов

### Месячные метрики по источникам

```sql
SELECT 
  month_start,
  source,
  SUM(leads) as leads,
  SUM(units) as units,
  SUM(repairs) as repairs,
  SUM(net_revenue) as net_revenue,
  SUM(cost) as cost
FROM vw_monthly_metrics
GROUP BY month_start, source
ORDER BY month_start DESC, source
```

### Дневные кумулятивные метрики (текущий месяц)

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

### Сравнение с KPI

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
WHERE vm.source = {{source}}
ORDER BY vm.month_start
```

## Создание дашбордов

### Monthly Metrics Dashboard

1. Создайте новый дашборд "Monthly Metrics"
2. Добавьте панели:
   - **Leads, Units, Repairs by Source** - Stacked bar chart
   - **Conversion Rates** - Line chart (conv_l_u, conv_l_r, conv_u_r)
   - **Finance Metrics** - Line chart (net_revenue, cost, profit)
   - **Revenue per Lead vs CPL** - Line chart
   - **KPI Comparison** - Line chart (actual vs target)

3. Добавьте фильтр:
   - **Source** - Dropdown filter для выбора источника

### Daily Cumulative Dashboard

1. Создайте новый дашборд "Daily Cumulative (Current Month)"
2. Добавьте панели:
   - **Cumulative Repairs** - Line chart
   - **Cumulative Net Revenue** - Line chart
   - **Plan Overlay** (опционально) - Линейный рост от месячного таргета

3. Добавьте фильтр:
   - **Source** - Dropdown filter

## Управление приложением

### Просмотр логов

```bash
flyctl logs -a abc-metrics-metabase
```

### Перезапуск

```bash
flyctl restart -a abc-metrics-metabase
```

### Обновление секретов

```bash
flyctl secrets set MB_ENCRYPTION_SECRET_KEY="<new-key>" -a abc-metrics-metabase
```

### Масштабирование

```bash
flyctl scale count 1 -a abc-metrics-metabase
flyctl scale memory 1024 -a abc-metrics-metabase
```

## Troubleshooting

### Проблема: Не могу подключиться к базе данных

- Проверьте, что база данных `abc-metrics-db` запущена
- Убедитесь, что используете правильный хост и порт
- Проверьте SSL настройки (должен быть "Required")

### Проблема: Медленные запросы

- Используйте views `vw_monthly_metrics` и `vw_daily_metrics` вместо прямых запросов к fact таблицам
- Настройте кэширование в Metabase (Admin → Settings → Caching)

### Проблема: Потеря данных после перезапуска

- Убедитесь, что volume `metabase_data` примонтирован
- Проверьте: `flyctl volumes list -a abc-metrics-metabase`

## Дополнительные ресурсы

- [Metabase Documentation](https://www.metabase.com/docs/)
- [Metabase SQL Guide](https://www.metabase.com/learn/metabase-basics/querying-and-managing-data/sql-parameters)
- [Fly.io Volumes](https://fly.io/docs/reference/volumes/)

