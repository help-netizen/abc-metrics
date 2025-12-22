# Архитектура проекта ABC Metrics

Краткое описание модулей, их ответственности, основных сущностей и ключевых функций/классов.

**Важно для агентов:** Перед любыми изменениями кода обязательно ознакомьтесь с этим документом.

---

## Общая архитектура

### Распределенная архитектура

Проект разделен на два приложения Fly.io:

1. **ABC Metrics** (abc-metrics) - БД и API для работы с БД
2. **Rely Lead Processor** (rely-lead-processor) - Синхронизация данных из внешних источников

**КРИТИЧНО:** БД доступна ТОЛЬКО через API, никаких прямых подключений из других приложений.

**Важное уточнение по подключению к БД:**
- **`abc-metrics`** - это DB API приложение, которое **МОЖЕТ и ДОЛЖНО** использовать прямое подключение к БД через `DATABASE_URL` и `pool` из `pg`. Это правильно, так как `abc-metrics` - это приложение для работы с БД.
- **`rely-lead-processor`** - это приложение синхронизации, которое **НЕ ДОЛЖНО** использовать прямое подключение к БД. Все операции с БД должны проходить через REST API `abc-metrics` с использованием `AbcMetricsClient`.

```
┌─────────────────────────────────────────────────────────────┐
│                    ABC Metrics (abc-metrics)                │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐ │
│  │  PostgreSQL │◀────│  DB API      │────│  REST API   │ │
│  │  (Database) │     │  (Read/Write) │     │  (Express)  │ │
│  └─────────────┘     └──────────────┘     └─────────────┘ │
│         │                    │                    │         │
│         │                    │                    │         │
│         └────────────────────┴────────────────────┘         │
│                              │                              │
│                              │ HTTP API                     │
│                              │ (X-API-Key auth)             │
└──────────────────────────────┼──────────────────────────────┘
                                │
                                │
┌───────────────────────────────┼──────────────────────────────┐
│                               │                              │
│                    Rely Lead Processor                       │
│                    (rely-lead-processor)                    │
│                               │                              │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │  External   │────▶│   Metrics    │────▶│  ABC       │  │
│  │  Sources    │     │   Module     │     │  Metrics    │  │
│  │             │     │   (Sync/ETL)  │     │  API Client │  │
│  │ - Workiz    │     │               │     │             │  │
│  │ - Elocal    │     │  src/metrics/ │     │             │  │
│  │ - CSV       │     │               │     │             │  │
│  └─────────────┘     └──────────────┘     └─────────────┘  │
│         │                    │                    │          │
│         │                    │                    │          │
│         └────────────────────┴────────────────────┘          │
│                                                              │
│  ┌─────────────┐                                            │
│  │   Other     │  (другие модули, например парсеры email)   │
│  │   Modules   │                                            │
│  └─────────────┘                                            │
└──────────────────────────────────────────────────────────────┘
```

### Модуль метрик в Rely Lead Processor

Модуль метрик полностью изолирован в директории `src/metrics/`:

```
src/metrics/
├── services/     # Все сервисы метрик
│   ├── abc-metrics-client.ts  # HTTP клиент для API abc-metrics
│   ├── svc-workiz-jobs.ts
│   ├── svc-workiz-leads.ts
│   ├── svc-workiz-payments.ts
│   ├── svc-elocal-calls.ts
│   ├── csv.service.ts
│   └── workiz.service.ts
├── routes.ts     # API routes (префикс /api/metrics/)
├── scheduler.ts  # Планировщик задач
└── index.ts      # Экспорт модуля для интеграции
```

**Принципы изоляции:**
- Все файлы метрик находятся в `src/metrics/`
- API endpoints используют префикс `/api/metrics/*`
- Нет конфликтов с существующим функционалом
- Разработка метрик не влияет на другие модули

**Подключение к БД в rely-lead-processor:**
- Модуль метрик в `rely-lead-processor` **НЕ ДОЛЖЕН** использовать прямое подключение к БД через `DATABASE_URL`
- Все сервисы в модуле метрик (`svc-workiz-jobs.ts`, `svc-workiz-leads.ts`, `svc-workiz-payments.ts`, `svc-elocal-calls.ts`, `csv.service.ts`) используют `AbcMetricsClient` для работы с БД через REST API
- `AbcMetricsClient` отправляет HTTP запросы к `abc-metrics` API (`/api/db/jobs`, `/api/db/leads`, `/api/db/payments`, `/api/db/calls`)
- Переменная окружения `DATABASE_URL` **НЕ ТРЕБУЕТСЯ** в `rely-lead-processor` для модуля метрик

### ABC Metrics (текущее приложение)

Проект представляет собой Node.js приложение на TypeScript, которое:
1. Хранит данные в PostgreSQL (Star Schema: fact/dim таблицы)
2. Предоставляет REST API для чтения/записи БД
3. Агрегирует метрики (daily/monthly)
4. Предоставляет REST API для дашбордов

**Важно:** Синхронизация данных из внешних источников перенесена в rely-lead-processor.

**Подключение к БД в abc-metrics:**
- `abc-metrics` использует прямое подключение к PostgreSQL через `DATABASE_URL` и `pool` из библиотеки `pg`
- Все сервисы в `abc-metrics` (`workiz.service.ts`, `svc-workiz-jobs.ts`, `svc-workiz-leads.ts`, `svc-workiz-payments.ts`, `aggregation.service.ts`) используют `pool` напрямую
- Это правильно и допустимо, так как `abc-metrics` - это DB API приложение, которое управляет БД

---

## Модули и их ответственность

### 1. `src/metrics-collector.ts` - Главная точка входа

**Ответственность:**
- Инициализация Express сервера
- Настройка middleware (CORS, JSON parser, static files)
- Подключение к БД и запуск миграций
- Запуск планировщика задач
- Обработка graceful shutdown

**Ключевые компоненты:**
- `main()` - главная функция инициализации
- Express app настройка (порт из `PORT` или `METRICS_PORT`, по умолчанию 3001)
- Статические файлы из `public/`
- Обработчики SIGTERM/SIGINT для корректного завершения

**Зависимости:**
- `express` - HTTP сервер
- `./db/connection` - пул подключений к БД
- `./db/migrate` - миграции БД
- `./api/routes` - API endpoints
- `./scheduler` - планировщик задач

---

### 2. `src/scheduler.ts` - Планировщик задач

**Ответственность:**
- Управление cron задачами
- Запуск синхронизаций по расписанию
- Запуск агрегаций по расписанию

**Ключевые компоненты:**
- Класс `Scheduler`
- Метод `start()` - инициализация всех cron задач

**Cron расписания:**
- `'0 * * * *'` - синхронизация Jobs (каждый час в :00)
- `'5 * * * *'` - синхронизация Leads (каждый час в :05)
- `'10 * * * *'` - синхронизация Payments (каждый час в :10)
- `'0 4 * * *'` - синхронизация Elocal Calls (каждый день в 4:00)
- `'0 */6 * * *'` - обработка CSV (каждые 6 часов)
- `'0 1 * * *'` - ежедневная агрегация (каждый день в 1:00)
- `'0 2 1 * *'` - месячная агрегация (1-го числа в 2:00)
- `'0 3 * * *'` - полная переагрегация (каждый день в 3:00)

**Зависимости:**
- `node-cron` - библиотека для cron расписаний
- Все сервисы из `src/services/`

---

### 3. `src/api/routes.ts` - REST API Endpoints

**Ответственность:**
- Определение всех HTTP endpoints
- Обработка запросов и ответов
- Валидация параметров
- Вызов сервисов для получения данных

**Ключевые endpoints:**

**Метрики:**
- `GET /api/metrics/daily` - ежедневные метрики
- `GET /api/metrics/monthly` - месячные метрики

**Исходные данные:**
- `GET /api/jobs` - заявки
- `GET /api/payments` - платежи
- `GET /api/calls` - звонки
- `GET /api/leads` - лиды (универсальный)
- `GET /api/leads/elocals` - лиды из eLocals
- `GET /api/google-spend` - расходы Google Ads
- `GET /api/targets` - целевые значения

**Тестовые:**
- `GET /api/test/workiz/jobs` - тест получения jobs
- `POST /api/test/workiz/jobs/sync` - ручная синхронизация jobs
- `GET /api/test/elocal/calls` - тест получения calls
- `GET /api/calls/elocal` - извлечение данных из elocal.com (без сохранения)

**Утилиты:**
- `GET /api/health` - проверка работоспособности
- `GET /api/tables` - список таблиц БД
- `GET /api/table/:tableName` - данные таблицы

**Зависимости:**
- `express` - Router
- `../db/connection` - доступ к БД
- Все сервисы из `src/services/`

---

### 4. `src/db/connection.ts` - Подключение к БД

**Ответственность:**
- Создание и управление пулом подключений к PostgreSQL
- Экспорт singleton pool для использования во всем приложении

**Ключевые компоненты:**
- Экспорт `pool` - пул подключений node-postgres
- Настройка через `DATABASE_URL` env var

**Зависимости:**
- `pg` (node-postgres) - драйвер PostgreSQL
- `dotenv` - загрузка переменных окружения

---

### 5. `src/db/migrate.ts` - Миграции БД

**Ответственность:**
- Создание структуры БД (таблицы, индексы, VIEW)
- Заполнение справочников начальными данными
- Обеспечение идемпотентности (можно запускать многократно)

**Ключевые компоненты:**
- Функция `migrate()` - основная функция миграции
- Использует транзакции (BEGIN/COMMIT/ROLLBACK)

**Создаваемые объекты:**
- Dimensions: `dim_source`, `dim_date`
- Facts: `fact_leads`, `fact_jobs`, `fact_payments`
- Legacy таблицы: `jobs`, `payments`, `calls`, `leads`, `elocals_leads`, `google_spend`
- Агрегаты: `daily_metrics`, `monthly_metrics`, `targets`
- VIEW: `vw_job_metrics`, `vw_daily_metrics`, `vw_monthly_metrics`
- Индексы для оптимизации запросов

**Зависимости:**
- `./connection` - пул подключений

---

### 5.1. Web Interface Endpoints (Public Access)

**Ответственность:** Предоставление публичного веб-интерфейса для просмотра данных БД без аутентификации

**Ключевые файлы:**
- `src/api/routes.ts` - endpoints `/api/tables` и `/api/table/:name` (определены ПЕРЕД монтированием dbRoutes)
- `public/index.html` - главная страница веб-интерфейса
- `public/app.js` - клиентский код для загрузки и отображения данных
- `public/style.css` - стили веб-интерфейса

**Endpoints:**
- `GET /api/tables` - список всех таблиц БД с количеством строк (публичный доступ)
- `GET /api/table/:tableName` - данные таблицы с пагинацией (публичный доступ)

**Интеграции:**
- Использует `pool` из `src/db/connection` для прямых запросов к БД
- Не требует аутентификации (публичный доступ)
- Отделен от DB API endpoints (`/api/db/*`), которые требуют аутентификацию

**Важно:** Публичные endpoints должны быть определены ПЕРЕД монтированием `dbRoutes` в `src/api/routes.ts`, чтобы не получать middleware аутентификации из `dbRoutes`.

---

### 6. `src/services/` - Бизнес-логика (7 сервисов)

#### 6.1. `svc-workiz-jobs.ts` - Синхронизация Jobs

**Класс:** `SvcWorkizJobs`

**Ответственность:**
- Получение заявок из Workiz API
- Нормализация данных
- Сохранение в БД (fact_jobs, jobs)

**Ключевые методы:**
- `fetchJobs(startDate, endDate?, onlyOpen?)` - получение из API
- `saveJobs(jobs)` - сохранение в БД (UPSERT)
- `syncJobs()` - полная синхронизация (последние 30 дней)

**Интерфейсы:**
- `WorkizJobRaw` - сырой ответ от API
- `WorkizJob` - нормализованная структура

**Зависимости:**
- `axios` - HTTP клиент
- `../db/connection` - доступ к БД

---

#### 6.2. `svc-workiz-leads.ts` - Синхронизация Leads

**Класс:** `SvcWorkizLeads`

**Ответственность:**
- Получение лидов из Workiz API
- Нормализация данных (Pro Referral, Google, Website и др.)
- Сохранение в БД (fact_leads)

**Ключевые методы:**
- `fetchLeads(startDate, endDate?, onlyOpen?)` - получение из API
- `saveLeads(leads)` - сохранение в БД (UPSERT)
- `syncLeads()` - полная синхронизация (последние 30 дней)

**Интерфейсы:**
- `WorkizLeadRaw` - сырой ответ от API
- `WorkizLead` - нормализованная структура

**Зависимости:**
- `axios` - HTTP клиент
- `../db/connection` - доступ к БД

---

#### 6.3. `svc-workiz-payments.ts` - Синхронизация Payments

**Класс:** `SvcWorkizPayments`

**Ответственность:**
- Получение платежей из Workiz API
- Нормализация данных
- Сохранение в БД (fact_payments, payments)

**Ключевые методы:**
- `fetchPayments(startDate, endDate?)` - получение из API
- `savePayments(payments)` - сохранение в БД (UPSERT)
- `syncPayments()` - полная синхронизация (последние 30 дней)

**Зависимости:**
- `axios` - HTTP клиент
- `../db/connection` - доступ к БД

---

#### 6.4. `svc-elocal-calls.ts` - Синхронизация Calls из Elocal.com

**Класс:** `SvcElocalCalls`

**Ответственность:**
- Автоматизация браузера через Puppeteer
- Аутентификация на elocal.com
- Загрузка CSV со звонками
- Парсинг и сохранение в БД (calls)

**Ключевые методы:**
- `getBrowser()` - создание/получение экземпляра браузера
- `authenticate(page)` - авторизация на сайте
- `fetchCallsCsv(startDate, endDate)` - загрузка CSV
- `parseCallsCsv(csvContent)` - парсинг CSV
- `saveCalls(calls)` - сохранение в БД (UPSERT)
- `syncCalls()` - полная синхронизация (последние 30 дней)
- `closeBrowser()` - закрытие браузера

**Интерфейсы:**
- `ElocalCall` - нормализованная структура звонка

**Особенности:**
- Использует Puppeteer для веб-скрапинга (нет публичного API)
- Аутентификация занимает ~60-70 секунд
- CSV парсинг с конвертацией длительности (MM:SS → секунды)

**Зависимости:**
- `puppeteer` - автоматизация браузера
- `csv-parse` - парсинг CSV
- `../db/connection` - доступ к БД

**Env vars:**
- `ELOCAL_USERNAME` - логин
- `ELOCAL_PASSWORD` - пароль
- `PUPPETEER_EXECUTABLE_PATH` - путь к Chromium (опционально)

---

#### 6.5. `csv.service.ts` - Обработка CSV файлов

**Класс:** `CsvService`

**Ответственность:**
- Чтение CSV файлов из директории
- Определение типа данных по имени файла
- Парсинг и сохранение в соответствующие таблицы

**Ключевые методы:**
- `processCsvFiles()` - обработка всех CSV в директории
- `processCsvFile(filePath, fileName)` - обработка одного файла
- `loadCsvFile(filePath)` - загрузка и парсинг CSV
- `getTableNameFromFileName(fileName)` - определение таблицы по имени
- `saveRecords(records, tableName, fileName)` - сохранение в БД

**Маппинг имен файлов:**
- содержит "job" или "work" → `jobs`
- содержит "payment" → `payments`
- содержит "call" → `calls`
- содержит "elocal" → `elocals_leads`
- содержит "proref" → `proref_leads` (устарело)
- содержит "google" или "spend" → `google_spend`

**Env vars:**
- `CSV_DIRECTORY` - директория с CSV файлами (по умолчанию: `./csv-data`)

**Зависимости:**
- `csv-parse` - парсинг CSV
- `fs` - работа с файловой системой
- `../db/connection` - доступ к БД

---

#### 6.6. `aggregation.service.ts` - Агрегация метрик

**Класс:** `AggregationService`

**Ответственность:**
- Расчет агрегированных метрик по дням и месяцам
- Расчет по комбинациям source/segment
- Сохранение в таблицы daily_metrics и monthly_metrics

**Ключевые методы:**
- `aggregateDailyMetrics(date)` - агрегация за день
- `aggregateMonthlyMetrics(monthDate)` - агрегация за месяц
- `aggregateAllDailyMetrics()` - переагрегация всех дней
- `aggregateAllMonthlyMetrics()` - переагрегация всех месяцев
- `calculateDailyMetrics(dateStr, source, segment, client)` - расчет метрик за день
- `calculateMonthlyMetrics(monthStr, source, segment, client)` - расчет метрик за месяц
- `getSegment(type)` - определение сегмента из типа job
- `isUnit(type)` - проверка, является ли job unit

**Рассчитываемые метрики:**
- `leads` - количество лидов
- `units` - количество units (Type IN ('COD Service', 'INS Service'))
- `repairs` - количество repairs (Type IN ('COD Repair', 'INS Repair') OR (Type = 'COD Service' AND payments > 100))
- `revenue_gross` - валовый доход
- `revenue40` - чистый доход (40% от валового)
- `cost` - стоимость (CPL, CPU, Google spend)
- `profit` - прибыль (revenue40 - cost)
- `calls` - количество звонков
- `google_spend` - расходы на Google Ads
- `cpl` - Cost Per Lead
- `conv_l_to_r` - Conversion Rate (Leads → Repairs)

**Особенности:**
- Использует VIEW `vw_job_metrics` для расчета units/repairs
- Разные источники имеют разную логику расчета leads и cost
- Pro Referral: leads из fact_leads, cost = $20 per lead (по умолчанию)
- Google: leads из fact_leads, cost = сумма из google_spend
- Rely/NSA/Liberty/Retention: leads = units, cost = 0
- Elocals: leads из elocals_leads

**Зависимости:**
- `../db/connection` - доступ к БД

---

#### 6.7. `workiz.service.ts` - Базовый сервис Workiz API

**Класс:** `WorkizService`

**Ответственность:**
- Базовые методы для работы с Workiz API
- Аутентификация (API Key + Secret)
- Нормализация данных
- Вспомогательные функции

**Ключевые методы:**
- `fetchJobs(startDate, endDate?, onlyOpen?)` - получение jobs
- `fetchJobByUuid(uuid)` - получение job по UUID
- `fetchLeads(startDate, endDate?, onlyOpen?)` - получение leads
- `normalizeJob(jobData)` - нормализация job данных
- `normalizeLead(leadData)` - нормализация lead данных
- `validateJob(job)` - валидация job перед сохранением
- `validateLead(lead)` - валидация lead перед сохранением

**Зависимости:**
- `axios` - HTTP клиент

**Env vars:**
- `WORKIZ_API_KEY` - API ключ
- `WORKIZ_API_SECRET` - API секрет
- `WORKIZ_API_URL` - URL API (по умолчанию: `https://api.workiz.com`)

---

## Основные сущности базы данных

### Dimension таблицы (справочники)

#### `dim_source` - Справочник источников
```sql
id SERIAL PRIMARY KEY
code TEXT UNIQUE NOT NULL  -- elocals, google, rely, nsa, liberty, retention, pro_referral, website, workiz
name TEXT                  -- Человекочитаемое название
```

#### `dim_date` - Справочник дат
```sql
d DATE PRIMARY KEY  -- Дата
```

---

### Fact таблицы (факты)

#### `fact_leads` - Лиды
```sql
lead_id VARCHAR(255) PRIMARY KEY
created_at TIMESTAMP NOT NULL
source_id INTEGER REFERENCES dim_source(id)
phone_hash TEXT
raw_source TEXT
cost NUMERIC(10,2) DEFAULT 0
meta JSONB
created_at_db TIMESTAMPTZ
updated_at_db TIMESTAMPTZ
```

#### `fact_jobs` - Заявки
```sql
job_id VARCHAR(255) PRIMARY KEY
lead_id VARCHAR(255) REFERENCES fact_leads(lead_id)
created_at TIMESTAMP NOT NULL
scheduled_at TIMESTAMP
source_id INTEGER REFERENCES dim_source(id)
type TEXT
client_id VARCHAR(255)
meta JSONB
created_at_db TIMESTAMPTZ
updated_at_db TIMESTAMPTZ
```

#### `fact_payments` - Платежи
```sql
payment_id VARCHAR(255) PRIMARY KEY
job_id VARCHAR(255) REFERENCES fact_jobs(job_id)
paid_at TIMESTAMP
amount NUMERIC(10,2) NOT NULL
method TEXT
meta JSONB
created_at_db TIMESTAMPTZ
updated_at_db TIMESTAMPTZ
```

---

### Legacy таблицы

- `jobs` - заявки (legacy)
- `payments` - платежи (legacy)
- `calls` - звонки
- `leads` - лиды (legacy, универсальная)
- `elocals_leads` - лиды из eLocals (CSV)
- `google_spend` - расходы Google Ads

---

### Агрегатные таблицы

#### `daily_metrics` - Ежедневные метрики
```sql
id SERIAL PRIMARY KEY
date DATE NOT NULL
source VARCHAR(100)
segment VARCHAR(50)
leads INTEGER DEFAULT 0
units INTEGER DEFAULT 0
repairs INTEGER DEFAULT 0
revenue_gross DECIMAL(10, 2) DEFAULT 0
revenue40 DECIMAL(10, 2) DEFAULT 0
cost DECIMAL(10, 2) DEFAULT 0
profit DECIMAL(10, 2) DEFAULT 0
calls INTEGER DEFAULT 0
google_spend DECIMAL(10, 2) DEFAULT 0
cpl DECIMAL(10, 2)
conv_l_to_r DECIMAL(5, 4)
UNIQUE(date, source, segment)
```

#### `monthly_metrics` - Месячные метрики
```sql
-- Аналогично daily_metrics, но с month вместо date
month DATE NOT NULL
UNIQUE(month, source, segment)
```

---

### VIEW (представления)

#### `vw_job_metrics` - Метрики по jobs
Рассчитывает для каждого job:
- `is_unit` - является ли unit (Type IN ('COD Service','INS Service'))
- `is_repair` - является ли repair (Type IN ('COD Repair','INS Repair') OR (Type = 'COD Service' AND payments > 100))
- `gross_revenue` - валовый доход (сумма payments)
- `net_revenue` - чистый доход (gross_revenue * 0.40)

#### `vw_daily_metrics` - Ежедневные метрики (из fact таблиц)
Агрегирует метрики по дням, источникам и сегментам из fact таблиц.

#### `vw_monthly_metrics` - Месячные метрики (из vw_daily_metrics)
Агрегирует vw_daily_metrics по месяцам.

---

## Ключевые функции и классы

### Классы сервисов

1. **SvcWorkizJobs** - синхронизация jobs
2. **SvcWorkizLeads** - синхронизация leads
3. **SvcWorkizPayments** - синхронизация payments
4. **SvcElocalCalls** - синхронизация calls (веб-скрапинг)
5. **CsvService** - обработка CSV файлов
6. **AggregationService** - агрегация метрик
7. **WorkizService** - базовый сервис Workiz API

### Класс планировщика

**Scheduler** - управление cron задачами

### Основные функции

- `main()` - точка входа приложения
- `migrate()` - выполнение миграций БД

---

## Потоки данных

### 1. Синхронизация Workiz данных

```
Workiz API → SvcWorkizJobs/Leads/Payments → fact_jobs/leads/payments → AggregationService → daily_metrics/monthly_metrics
```

### 2. Синхронизация Elocal Calls

```
Elocal.com (Puppeteer) → CSV → SvcElocalCalls → calls → AggregationService → daily_metrics/monthly_metrics
```

### 3. Обработка CSV

```
CSV файлы → CsvService → jobs/payments/calls/elocals_leads/google_spend → AggregationService → daily_metrics/monthly_metrics
```

### 4. Получение метрик через API

```
Client → REST API → daily_metrics/monthly_metrics → JSON Response
```

---

## Зависимости проекта

**Основные:**
- `express` - HTTP сервер
- `pg` - драйвер PostgreSQL
- `axios` - HTTP клиент
- `node-cron` - планировщик задач
- `puppeteer` - автоматизация браузера
- `csv-parse` - парсинг CSV
- `dotenv` - переменные окружения

**Dev:**
- `typescript` - компилятор TypeScript
- `ts-node` - выполнение TypeScript
- `@types/*` - типы для TypeScript

---

## Переменные окружения

**Обязательные:**
- `DATABASE_URL` - строка подключения к PostgreSQL

**Workiz API:**
- `WORKIZ_API_KEY` - API ключ
- `WORKIZ_API_SECRET` - API секрет
- `WORKIZ_API_URL` - URL API (опционально)

**Elocal.com:**
- `ELOCAL_USERNAME` - логин
- `ELOCAL_PASSWORD` - пароль
- `PUPPETEER_EXECUTABLE_PATH` - путь к Chromium (опционально)

**Опциональные:**
- `PORT` или `METRICS_PORT` - порт сервера (по умолчанию: 3001)
- `CSV_DIRECTORY` - директория с CSV файлами (по умолчанию: `./csv-data`)
- `NODE_ENV` - окружение (development/production)

---

## Документация для rely-lead-processor

**Ответственность:** Предоставление полной документации для агентов, работающих с `rely-lead-processor`, о работе с `abc-metrics` DB API и перенесенных эндпоинтах синхронизации.

**Ключевые файлы:**
- `docs/rely-lead-processor/abc-metrics-api-guide.md` - основной гайд по работе с API через AbcMetricsClient
- `docs/rely-lead-processor/db-api-endpoints.md` - детальное описание всех DB API эндпоинтов (READ/WRITE/Batch/Aggregation)
- `docs/rely-lead-processor/metrics-endpoints.md` - описание эндпоинтов metrics module (test и sync endpoints)

**Интеграции:**
- Документация описывает использование `AbcMetricsClient` из `metrics-module-template/src/metrics/services/abc-metrics-client.ts`
- Документация ссылается на эндпоинты из `src/api/db-routes.ts` (abc-metrics DB API)
- Документация ссылается на эндпоинты из `metrics-module-template/src/metrics/routes.ts` (metrics module)
- Документация ссылается на принципы из `docs/architecture-principles.md`

**Структура:**
- Все файлы документации находятся в `docs/rely-lead-processor/`
- Документация не требует изменений в коде, только создание новых файлов
- Документация служит справочником для агентов и разработчиков

