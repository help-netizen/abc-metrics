# Документация базы данных abc-metrics для Metabase

## Цель

Данная документация описывает структуру базы данных `abc-metrics` на продакшн окружении и содержит инструкции по подключению и работе через Metabase.

## Информация о базе данных

### Тип базы данных

- **PostgreSQL** (управляемая база данных Fly.io Managed Postgres)
- **Версия**: PostgreSQL 13+ (проверить через `SELECT version()`)

### Расположение

- **Регион**: `iad` (Washington, D.C.)
- **Провайдер**: Fly.io Managed Postgres
- **Приложение**: abc-metrics

### Получение строки подключения

Строка подключения хранится в секретах Fly.io как `DATABASE_URL`.

**Способ 1: Через Fly.io Dashboard**

1. Открыть https://fly.io/apps/abc-metrics
2. Перейти в раздел "Secrets"
3. Найти `DATABASE_URL`
4. Скопировать значение

**Способ 2: Через CLI**

```bash
# Установить flyctl если не установлен
# https://fly.io/docs/hands-on/install-flyctl/

# Войти в аккаунт
flyctl auth login

# Получить значение DATABASE_URL (будет показан только hash, для реального значения нужны права)
flyctl secrets list -a abc-metrics | grep DATABASE_URL

# Для получения реального значения (требуется доступ к базе)
flyctl ssh console -a abc-metrics
echo $DATABASE_URL
```

**Способ 3: Прямое подключение к кластеру**

```bash
# Получить информацию о кластере
flyctl mpg list

# Получить connection string напрямую (если есть доступ)
flyctl mpg connect -a abc-metrics
```

### Формат строки подключения

Примерный формат (фактическое значение нужно получить из секретов):

```
postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=require
```

**Важно для Metabase:**

- SSL требуется (`sslmode=require`)
- Возможно потребуется добавить параметры: `?sslmode=require&sslcert=&sslkey=&sslrootcert=`

## Структура базы данных

### Схема данных (Data Model)

База использует схему **Star Schema** (звездообразная схема) с фактами и измерениями:

#### Dimension Tables (Измерения/Справочники)

##### 1. `dim_source` - справочник источников лидов

- `id` (SERIAL PRIMARY KEY)
- `code` (TEXT UNIQUE) - код источника (elocals, google, rely, nsa, liberty, retention, pro_referral, website, workiz)
- `name` (TEXT) - название источника

**Пример данных:**
```
id | code        | name
---|-------------|------------
1  | elocals     | eLocals
2  | google      | Google
3  | rely        | Rely
4  | nsa         | NSA
5  | liberty     | Liberty
6  | retention   | Retention
7  | pro_referral| Pro Referral
8  | website     | Website
9  | workiz      | Workiz
```

##### 2. `dim_date` - справочник дат (для календарных вычислений)

- `d` (DATE PRIMARY KEY)

Используется для календарных джойнов и агрегаций. Заполняется датами на год назад и вперед от текущей даты.

##### 3. `dim_zip` - география (почтовые индексы)

- `zip` (VARCHAR(10) PRIMARY KEY)
- `city` (TEXT)
- `state` (TEXT)
- `lat` (NUMERIC(9,6)) - широта
- `lon` (NUMERIC(9,6)) - долгота
- `service_zone` (TEXT) - зона обслуживания

#### Fact Tables (Факты/Транзакции)

##### 1. `fact_leads` - лиды из Workiz

- `lead_id` (VARCHAR(255) PRIMARY KEY) - уникальный идентификатор лида
- `created_at` (TIMESTAMP) - дата создания лида
- `source_id` (INTEGER REFERENCES dim_source(id)) - источник лида
- `phone_hash` (TEXT) - хэш телефона для дедупликации
- `raw_source` (TEXT) - оригинальный источник
- `cost` (NUMERIC(10,2)) - стоимость лида
- `meta` (JSONB) - дополнительные данные в формате JSON
- `created_at_db` (TIMESTAMPTZ) - дата создания записи в БД
- `updated_at_db` (TIMESTAMPTZ) - дата последнего обновления

**Индексы:**
- `idx_fact_leads_created_at` - по дате создания
- `idx_fact_leads_source_id` - по источнику
- `idx_fact_leads_phone_hash` - по хэшу телефона
- `idx_fact_leads_meta` - GIN индекс по JSONB полю

##### 2. `fact_jobs` - работы/заявки из Workiz

- `job_id` (VARCHAR(255) PRIMARY KEY) - уникальный идентификатор работы
- `lead_id` (VARCHAR(255) REFERENCES fact_leads(lead_id)) - связанный лид
- `created_at` (TIMESTAMP) - дата создания работы
- `scheduled_at` (TIMESTAMP) - запланированная дата
- `job_end_date_time` (TIMESTAMP) - дата завершения работы
- `last_status_update` (TIMESTAMP) - последнее обновление статуса
- `source_id` (INTEGER REFERENCES dim_source(id)) - источник
- `type` (TEXT) - тип работы:
  - `COD Service` - сервис с оплатой на месте
  - `INS Service` - сервис по страховке
  - `COD Repair` - ремонт с оплатой на месте
  - `INS Repair` - ремонт по страховке
- `client_id` (VARCHAR(255)) - идентификатор клиента
- `serial_id` (INTEGER) - серийный номер работы
- `technician_name` (TEXT) - имя техника
- `job_amount_due` (NUMERIC(10,2)) - сумма к оплате
- `job_total_price` (NUMERIC(10,2)) - общая стоимость работы
- `meta` (JSONB) - дополнительные данные
- `created_at_db`, `updated_at_db` (TIMESTAMPTZ) - служебные поля

**Индексы:**
- По датам создания, планирования, завершения
- По lead_id, source_id, type
- GIN индекс по meta (JSONB)

##### 3. `fact_payments` - платежи

- `payment_id` (VARCHAR(255) PRIMARY KEY) - уникальный идентификатор платежа
- `job_id` (VARCHAR(255) REFERENCES fact_jobs(job_id)) - связанная работа
- `paid_at` (TIMESTAMP) - дата платежа
- `amount` (NUMERIC(10,2)) - сумма платежа
- `method` (TEXT) - метод оплаты
- `meta` (JSONB) - дополнительные данные
- `created_at_db`, `updated_at_db` (TIMESTAMPTZ) - служебные поля

**Индексы:**
- По paid_at, job_id
- GIN индекс по meta

##### 4. `fact_parts` - запчасти по работам

- `part_id` (SERIAL PRIMARY KEY)
- `job_id` (VARCHAR(255) REFERENCES fact_jobs(job_id))
- `part_sku` (TEXT) - артикул запчасти
- `part_name` (TEXT) - название запчасти
- `part_cost` (NUMERIC(10,2)) - стоимость запчасти
- `part_revenue` (NUMERIC(10,2)) - выручка от запчасти
- `ordered_at` (TIMESTAMP) - дата заказа
- `created_at_db` (TIMESTAMPTZ)

##### 5. `fact_expense` - расходы

- `expense_id` (SERIAL PRIMARY KEY)
- `expense_date` (DATE) - дата расхода
- `expense_category` (TEXT) - категория расхода
- `amount` (NUMERIC(10,2)) - сумма расхода
- `vendor` (TEXT) - поставщик
- `channel_id` (INTEGER REFERENCES dim_source(id)) - канал расхода
- `job_id` (VARCHAR(255) REFERENCES fact_jobs(job_id)) - связанная работа
- `meta` (JSONB) - дополнительные данные
- `created_at_db` (TIMESTAMPTZ)

#### Legacy Tables (для обратной совместимости)

Эти таблицы используются для хранения старых данных и данных из других источников:

##### 1. `jobs` - устаревшая таблица работ

Используется для работ, импортированных из CSV и старых данных.

##### 2. `payments` - устаревшая таблица платежей

Для платежей из старых источников.

##### 3. `calls` - звонки

- `id` (SERIAL PRIMARY KEY)
- `date` (DATE) - дата звонка
- `time` (TIMESTAMPTZ) - время звонка
- `duration` (INTEGER) - длительность в секундах
- `from_name`, `from_number` (VARCHAR) - от кого
- `to_name`, `to_number` (VARCHAR) - кому
- `flow` (VARCHAR) - поток звонка
- `ad_group` (VARCHAR) - группа объявлений
- `answered` (VARCHAR) - был ли отвечен
- `job`, `job_id` (VARCHAR) - связанная работа
- `raw_data` (JSONB) - оригинальные данные

##### 4. `leads` - универсальная таблица лидов

Для лидов из различных источников.

##### 5. `elocals_leads` - лиды из eLocals (CSV импорт)

Расширенная таблица с полями:
- `lead_id`, `date`, `time`, `duration`
- `cost`, `status`, `lead_type`, `current_status`
- Контактные данные: `contact_first_name`, `contact_last_name`, `contact_phone`, `contact_email`, и др.
- Данные об услуге: `service_city`, `service_state`, `service_zip`
- `raw_data` (JSONB) - все оригинальные данные

##### 6. `servicedirect_leads` - лиды из Service Direct

- `lead_id` (VARCHAR(255) UNIQUE NOT NULL)
- `date`, `time` (TIMESTAMPTZ)
- `campaign`, `campaign_type` - информация о кампании
- `lead_name`, `lead_phone`, `lead_email` - контактные данные
- `call_duration`, `call_answered`, `booked_appointment` - статус звонка
- `lead_status`, `job_status` - статусы
- `revenue`, `cost` (DECIMAL) - финансовые показатели
- `address`, `unit`, `city`, `state`, `zip_code` - адрес
- `raw_data` (JSONB)

##### 7. `google_spend` - расходы на Google Ads

- `id` (SERIAL PRIMARY KEY)
- `date` (DATE) - дата расхода
- `month` (DATE) - месяц
- `campaign` (VARCHAR(255)) - название кампании
- `amount` (DECIMAL(10,2)) - сумма расхода
- `impressions` (INTEGER) - показы
- `clicks` (INTEGER) - клики
- UNIQUE(date, campaign)

#### Aggregation Tables (Агрегированные метрики)

##### 1. `daily_metrics` - дневные метрики по источникам и сегментам

- `id` (SERIAL PRIMARY KEY)
- `date` (DATE) - дата
- `source` (VARCHAR(100)) - источник
- `segment` (VARCHAR(50)) - сегмент (COD, INS, OTHER)
- `leads` (INTEGER) - количество лидов
- `units` (INTEGER) - количество units (сервисов)
- `repairs` (INTEGER) - количество ремонтов
- `revenue_gross` (DECIMAL(10,2)) - валовая выручка
- `revenue40` (DECIMAL(10,2)) - выручка с коэффициентом 0.4
- `cost` (DECIMAL(10,2)) - стоимость
- `profit` (DECIMAL(10,2)) - прибыль
- `calls` (INTEGER) - количество звонков
- `google_spend` (DECIMAL(10,2)) - расходы на Google
- `cpl` (DECIMAL(10,2)) - cost per lead
- `conv_l_to_r` (DECIMAL(5,4)) - конверсия из лида в ремонт
- UNIQUE(date, source, segment)

**Обновление:** Агрегация выполняется ежедневно автоматически.

##### 2. `monthly_metrics` - месячные метрики

Аналогичная структура, но с полем `month` (DATE) вместо `date`.

##### 3. `targets` - целевые значения метрик

- `id` (SERIAL PRIMARY KEY)
- `month` (DATE) - месяц
- `source` (VARCHAR(100)) - источник
- `segment` (VARCHAR(50)) - сегмент
- `metric_type` (VARCHAR(50)) - тип метрики
- `target_value` (DECIMAL(10,2)) - целевое значение
- UNIQUE(month, source, segment, metric_type)

##### 4. `kpi_targets` - KPI цели

- `id` (SERIAL PRIMARY KEY)
- `period_type` (TEXT) - тип периода ('month' или 'day')
- `period_start` (DATE) - начало периода
- `source` (TEXT) - источник (опционально)
- `metric` (TEXT) - название метрики
- `target_value` (NUMERIC) - целевое значение

#### Views (Представления для аналитики)

Представления созданы для упрощения аналитических запросов. **Рекомендуется использовать views вместо прямых запросов к fact-таблицам.**

##### 1. `vw_job_metrics` - метрики по работам

Вычисляет Units/Repairs/Net Revenue на основе типа работы и платежей.

**Логика:**
- **Unit**: Type IN ('COD Service', 'INS Service')
- **Repair**: Type IN ('COD Repair', 'INS Repair') OR (Type = 'COD Service' AND payments > 100)
- **Net Revenue**: total_amount * 0.40

##### 2. `vw_daily_metrics` - дневные метрики с конверсиями

Агрегирует данные по дням, источникам и сегментам с расчетом конверсий:
- `conv_l_u` - конверсия лид → unit
- `conv_l_r` - конверсия лид → repair
- `conv_u_r` - конверсия unit → repair
- `cpl`, `cpu` - cost per lead/unit

##### 3. `vw_monthly_metrics` - месячные метрики

Агрегирует `vw_daily_metrics` по месяцам с дополнительными метриками:
- `rev_per_lead`, `rev_per_unit`, `rev_per_repair`

##### 4. `stg_jobs` - нормализованные работы (staging)

Нормализует данные из `fact_jobs`:
- Извлекает zip из `meta->>'PostalCode'`
- Вычисляет `same_day_repair_flag`
- Определяет `job_category` (Repair/Diagnostic/Other)
- Вычисляет `is_repair_canonical`

##### 5. `mart_profit_mtd` - витрина прибыли (P&L) на текущий месяц

Дневные данные по прибыли:
- `gross_revenue` - из `fact_payments`
- `total_expenses` - из `fact_expense`
- `net_profit` - разница

##### 6. `mart_profit_mtd_v2` - улучшенная витрина с прогнозом

Добавляет к `mart_profit_mtd`:
- `mtd_revenue`, `mtd_expenses`, `mtd_profit` - фактические данные за месяц
- `avg_daily_profit_14d` - средний дневной профит за последние 14 дней
- `projected_profit` - прогнозируемая прибыль до конца месяца

##### 7. `mart_tech_mtd` - эффективность техников

Метрики по техникам по месяцам:
- `total_jobs`, `repairs_count`
- `gross_revenue`, `avg_revenue_per_job`
- `same_day_rate` - доля same-day ремонтов

##### 8. `mart_zip_mtd` - теплокарта по почтовым индексам

Агрегация по почтовым индексам:
- `job_count`, `total_revenue`
- Координаты из `dim_zip` (lat, lon)

##### 9. `mart_channel_mtd` - эффективность каналов

Метрики по каналам привлечения:
- `total_leads`, `valid_leads`
- `total_spend`
- `diagnostics_done`, `repairs_completed`
- `cost_per_valid_lead`, `cost_per_diagnostic`, `cost_per_repair`

##### 10. `mart_lead_funnel_mtd` - воронка лидов

Воронка конверсии лидов:
- `leads_total` - всего лидов
- `diagnostics_booked` - назначено диагностик
- `diagnostics_canceled` - отменено диагностик
- `repairs_completed` - завершено ремонтов

#### Rate Me System Tables

Таблицы для системы Rate Me (отзывы и реферальная программа):

##### 1. `job_tokens` - токены для Rate Me системы

- `id` (UUID PRIMARY KEY)
- `job_uuid`, `job_serial_id` - идентификаторы работы
- `customer_id` - идентификатор клиента
- `token` (TEXT) - токен для ссылки
- `status` (VARCHAR) - статус (pending, sent, expired, used)
- `sent_via` (VARCHAR) - способ отправки (email, sms, both)
- `expires_at` (TIMESTAMPTZ) - срок действия

##### 2. `referral_links` - реферальные ссылки

- `id` (UUID PRIMARY KEY)
- `customer_id` (VARCHAR UNIQUE) - клиент
- `referral_slug` (VARCHAR UNIQUE) - уникальный slug ссылки
- `customer_first_name`, `customer_last_name`

##### 3. `referral_shares` - отправленные реферальные ссылки

- `id` (UUID PRIMARY KEY)
- `referral_link_id` (UUID) - ссылка на referral_links
- `recipient_phone` (VARCHAR) - телефон получателя
- `sent_at` (TIMESTAMPTZ)

##### 4. `rewards` - награды для клиентов

- `id` (UUID PRIMARY KEY)
- `customer_id` - клиент
- `job_id`, `new_job_id` - связанные работы
- `type` (VARCHAR) - тип награды (review_perk, share_perk, referral_payout)
- `amount` (DECIMAL) - сумма награды
- `currency` (VARCHAR) - валюта (по умолчанию USD)
- `status` (VARCHAR) - статус (pending, approved, paid, cancelled)

##### 5. `rate_me_events` - события Rate Me системы

- `id` (UUID PRIMARY KEY)
- `event_type` (VARCHAR) - тип события
- `job_id`, `customer_id` - связанные сущности
- `data` (JSONB) - данные события
- `created_at` (TIMESTAMPTZ)

## Подключение Metabase

### Шаг 1: Добавить базу данных в Metabase

1. Открыть Metabase Admin Panel
2. Перейти в **Admin** → **Databases** → **Add Database**
3. Выбрать **PostgreSQL**
4. Заполнить данные подключения:

```
Display name: ABC Metrics Production
Host: [из DATABASE_URL - часть между @ и :]
Port: [из DATABASE_URL - часть после :, обычно 5432]
Database name: [из DATABASE_URL - часть после последнего /]
Username: [из DATABASE_URL - часть между // и :]
Password: [из DATABASE_URL - часть между : и @]
```

**Пример разбора connection string:**

Если connection string:
```
postgresql://user:password@host.example.com:5432/abc_metrics?sslmode=require
```

То:
- Host: `host.example.com`
- Port: `5432`
- Database: `abc_metrics`
- Username: `user`
- Password: `password`

### Шаг 2: Настройка SSL (обязательно)

В разделе **Additional JDBC connection string options** добавить:

```
sslmode=require
```

Или в расширенных настройках:

- **Use SSL**: Yes
- **SSL Mode**: Require

**Важно:** Fly.io Managed Postgres требует SSL соединение. Без правильной настройки SSL подключение не будет работать.

### Шаг 3: Настройка синхронизации схемы

Рекомендуемые настройки:

- **Scan frequency**: Ежедневно (Daily)
- **Tables**: Выбрать схему `public`
- **Enable sync**: Yes
- **Auto-run queries**: Yes (опционально, для автоматического обновления кэша)

### Шаг 4: Тестирование подключения

1. Нажать **Test Connection** и убедиться, что подключение успешно
2. Если ошибка - проверить:
   - Правильность парсинга connection string
   - Настройки SSL
   - Доступность базы данных из сети Metabase

### Шаг 5: Синхронизация схемы

После успешного подключения:

1. Нажать **Sync database schema now** для немедленной синхронизации
2. Дождаться завершения синхронизации
3. Проверить, что все таблицы и views отображаются в Metabase

## Рекомендуемые запросы для начала работы

### 1. Обзор метрик по источникам за текущий месяц

```sql
SELECT 
  ds.name AS source,
  COUNT(DISTINCT fl.lead_id) AS leads,
  COUNT(DISTINCT fj.job_id) AS jobs,
  SUM(fj.job_total_price) AS revenue,
  SUM(fl.cost) AS cost,
  SUM(fj.job_total_price) - SUM(fl.cost) AS profit
FROM fact_leads fl
LEFT JOIN dim_source ds ON fl.source_id = ds.id
LEFT JOIN fact_jobs fj ON fj.lead_id = fl.lead_id
WHERE DATE_TRUNC('month', fl.created_at) = DATE_TRUNC('month', CURRENT_DATE)
GROUP BY ds.name
ORDER BY leads DESC;
```

### 2. Использование готовых views (рекомендуется)

Views уже содержат агрегированные данные и оптимизированы для аналитики.

#### Дневные метрики за последние 30 дней

```sql
SELECT 
  d AS date,
  source,
  segment,
  leads,
  units,
  repairs,
  revenue_gross,
  revenue40,
  cost,
  profit,
  cpl,
  conv_l_to_r
FROM vw_daily_metrics 
WHERE d >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY d DESC, source, segment;
```

#### Месячные метрики

```sql
SELECT 
  month_start,
  source,
  segment,
  leads,
  units,
  repairs,
  net_revenue,
  cost,
  conv_l_u,
  conv_l_r,
  conv_u_r,
  rev_per_lead,
  rev_per_unit,
  rev_per_repair,
  cpl,
  cpu
FROM vw_monthly_metrics
ORDER BY month_start DESC, source, segment;
```

#### Витрина прибыли с прогнозом

```sql
SELECT 
  month_start,
  mtd_revenue,
  mtd_expenses,
  mtd_profit,
  avg_daily_profit_14d,
  projected_profit
FROM mart_profit_mtd_v2
ORDER BY month_start DESC;
```

#### Эффективность каналов

```sql
SELECT 
  channel_name,
  month_start,
  total_leads,
  valid_leads,
  total_spend,
  diagnostics_done,
  repairs_completed,
  cost_per_valid_lead,
  cost_per_diagnostic,
  cost_per_repair
FROM mart_channel_mtd
ORDER BY month_start DESC, channel_name;
```

### 3. Воронка лидов

```sql
SELECT 
  channel_name,
  month_start,
  leads_total,
  diagnostics_booked,
  diagnostics_canceled,
  repairs_completed,
  -- Конверсии
  ROUND(100.0 * diagnostics_booked / NULLIF(leads_total, 0), 2) AS conv_to_diagnostic_pct,
  ROUND(100.0 * repairs_completed / NULLIF(leads_total, 0), 2) AS conv_to_repair_pct
FROM mart_lead_funnel_mtd
WHERE month_start >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months')
ORDER BY month_start DESC, channel_name;
```

### 4. Эффективность техников

```sql
SELECT 
  technician_name,
  month_start,
  total_jobs,
  repairs_count,
  gross_revenue,
  avg_revenue_per_job,
  ROUND(100.0 * same_day_rate, 2) AS same_day_rate_pct
FROM mart_tech_mtd
WHERE month_start >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months')
ORDER BY month_start DESC, gross_revenue DESC;
```

### 5. Теплокарта по почтовым индексам

```sql
SELECT 
  zip,
  lat,
  lon,
  city,
  state,
  month_start,
  job_count,
  total_revenue
FROM mart_zip_mtd
WHERE month_start = DATE_TRUNC('month', CURRENT_DATE)
  AND lat IS NOT NULL 
  AND lon IS NOT NULL
ORDER BY total_revenue DESC;
```

### 6. Работа с JSONB полями

Для доступа к данным в полях `meta` и `raw_data`:

```sql
-- Пример: получение статуса из meta
SELECT 
  job_id,
  type,
  meta->>'Status' AS status,
  meta->>'PostalCode' AS zip_code,
  meta->>'First Name' AS first_name,
  meta->>'Last Name' AS last_name
FROM fact_jobs
WHERE meta->>'Status' = 'Completed'
LIMIT 10;
```

### 7. Агрегированные метрики с целями

```sql
SELECT 
  dm.date,
  dm.source,
  dm.segment,
  dm.leads,
  dm.repairs,
  dm.profit,
  t.target_value AS target_leads
FROM daily_metrics dm
LEFT JOIN targets t ON 
  t.month = DATE_TRUNC('month', dm.date)
  AND t.source = dm.source
  AND t.segment = dm.segment
  AND t.metric_type = 'leads'
WHERE dm.date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY dm.date DESC;
```

## Важные замечания

### 1. Индексы

Все основные таблицы имеют индексы по датам и связям для оптимизации запросов. При написании запросов старайтесь использовать поля, по которым есть индексы:

- `created_at`, `date`, `paid_at`, `expense_date` - для фильтрации по датам
- `source_id`, `lead_id`, `job_id` - для джойнов
- `phone_hash` - для дедупликации

### 2. JSONB поля

Поля `meta` и `raw_data` содержат JSON данные. Используйте операторы JSONB:

- `meta->>'key'` - получить значение как текст
- `meta->'key'` - получить значение как JSON
- `meta @> '{"key": "value"}'` - проверка наличия ключа-значения

**Важно:** JSONB операторы чувствительны к регистру ключей.

### 3. Таймзоны

Все TIMESTAMP поля хранятся в UTC. При фильтрации по датам учитывайте это:

```sql
-- Правильно: используйте DATE_TRUNC для сравнения дат
WHERE DATE_TRUNC('day', created_at) = '2024-01-15'

-- Или используйте диапазон
WHERE created_at >= '2024-01-15 00:00:00+00'
  AND created_at < '2024-01-16 00:00:00+00'
```

### 4. Обновления данных

- **Данные обновляются** через API из `rely-lead-processor`
- **Агрегация метрик** выполняется ежедневно автоматически в 1:00 AM UTC (daily_metrics) и 2:00 AM UTC (monthly_metrics)
- **Полная переагрегация** всех метрик выполняется ежедневно в 3:00 AM UTC

### 5. Производительность запросов

- Используйте **views** (`vw_*`, `mart_*`) вместо прямых запросов к fact-таблицам
- Views уже оптимизированы и содержат готовые агрегации
- При работе с большими объемами данных используйте фильтры по датам

### 6. Связи между таблицами

Основные связи:

```
fact_leads (lead_id)
    ↓
fact_jobs (lead_id → job_id)
    ↓
fact_payments (job_id → payment_id)
fact_parts (job_id → part_id)

dim_source (id) → fact_leads (source_id)
dim_source (id) → fact_jobs (source_id)
dim_date (d) → используется для календарных джойнов
```

## Создание Dashboard в Metabase

### Рекомендуемые виджеты

1. **Обзор метрик за месяц**
   - Использовать `mart_channel_mtd` для текущего месяца
   - Показать: leads, repairs, revenue, cost, profit

2. **Воронка конверсии**
   - Использовать `mart_lead_funnel_mtd`
   - Показать: leads → diagnostics → repairs

3. **Динамика прибыли**
   - Использовать `mart_profit_mtd` или `mart_profit_mtd_v2`
   - График по дням/месяцам

4. **Эффективность техников**
   - Использовать `mart_tech_mtd`
   - Таблица с сортировкой по revenue

5. **Теплокарта**
   - Использовать `mart_zip_mtd`
   - Карта с координатами и размерами по revenue

## Дополнительные ресурсы

- **Документация DB API**: [`docs/rely-lead-processor/db-api-endpoints.md`](rely-lead-processor/db-api-endpoints.md)
- **Схема миграций**: `src/db/migrate.ts` в репозитории
- **Fly.io документация**: https://fly.io/docs/postgres/
- **PostgreSQL документация**: https://www.postgresql.org/docs/
- **Metabase документация**: https://www.metabase.com/docs/

## Поддержка

При возникновении проблем:

1. Проверить подключение к базе данных через `flyctl ssh console -a abc-metrics`
2. Проверить логи приложения: `flyctl logs -a abc-metrics`
3. Проверить статус базы данных: `flyctl mpg status -a abc-metrics`


