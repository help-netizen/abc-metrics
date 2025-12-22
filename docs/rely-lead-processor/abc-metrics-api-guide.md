# Гайд по работе с abc-metrics DB API

Документация для агентов, работающих с `rely-lead-processor`, о том, как работать с `abc-metrics` DB API через `AbcMetricsClient`.

## Содержание

1. [Архитектура взаимодействия](#архитектура-взаимодействия)
2. [Настройка переменных окружения](#настройка-переменных-окружения)
3. [Инициализация AbcMetricsClient](#инициализация-abcmetricsclient)
4. [Основные методы клиента](#основные-методы-клиента)
5. [Обработка ошибок и retry логика](#обработка-ошибок-и-retry-логика)
6. [Примеры использования](#примеры-использования)
7. [Архитектурные принципы](#архитектурные-принципы)

---

## Архитектура взаимодействия

### Распределенная архитектура

Проект разделен на два приложения Fly.io:

1. **ABC Metrics** (`abc-metrics`) - БД и API для работы с БД
2. **Rely Lead Processor** (`rely-lead-processor`) - Синхронизация данных из внешних источников

**КРИТИЧНО:** БД доступна ТОЛЬКО через API, никаких прямых подключений из других приложений.

```
┌─────────────────────────────────────────────────────────────┐
│                    ABC Metrics (abc-metrics)                │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐ │
│  │  PostgreSQL │◀────│  DB API      │────│  REST API   │ │
│  │  (Database) │     │  (Read/Write) │     │  (Express)  │ │
│  └─────────────┘     └──────────────┘     └─────────────┘ │
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
└──────────────────────────────────────────────────────────────┘
```

### Важные принципы

**Принцип 1: Разделение по приложениям**
- **`abc-metrics`** - это DB API приложение, которое **МОЖЕТ и ДОЛЖНО** использовать прямое подключение к БД через `DATABASE_URL` и `pool` из библиотеки `pg`. Это правильно, так как `abc-metrics` - это приложение для работы с БД.
- **`rely-lead-processor`** - это приложение синхронизации, которое **НЕ ДОЛЖНО** использовать прямое подключение к БД. Все операции с БД должны проходить через REST API `abc-metrics` с использованием `AbcMetricsClient`.
- Переменная окружения `DATABASE_URL` **ТРЕБУЕТСЯ** в `abc-metrics` для прямого подключения к БД.
- Переменная окружения `DATABASE_URL` **НЕ ТРЕБУЕТСЯ** в `rely-lead-processor` для модуля метрик (используется `ABC_METRICS_API_URL` и `ABC_METRICS_API_KEY`).

**Принцип 2: Изоляция функционала**
- Все файлы метрик находятся в `src/metrics/`
- API endpoints используют префикс `/api/metrics/*`
- Нет конфликтов с существующим функционалом

---

## Настройка переменных окружения

### Обязательные переменные

Добавьте в `.env` или secrets вашего `rely-lead-processor` приложения:

#### Для доступа к abc-metrics API:

```env
# ABC Metrics API
ABC_METRICS_API_URL=https://abc-metrics.fly.dev
ABC_METRICS_API_KEY=your-api-key-here
```

**Описание:**
- `ABC_METRICS_API_URL` - URL приложения `abc-metrics` (например: `https://abc-metrics.fly.dev`)
- `ABC_METRICS_API_KEY` - API ключ для аутентификации (должен совпадать с `DB_API_KEY` в `abc-metrics`)

**Важно:** 
- Без этих переменных `AbcMetricsClient` не сможет работать, и конструктор выбросит ошибку.
- Все запросы к `/api/db/*` требуют корректный API ключ. При неверном или отсутствующем ключе возвращается `401 Unauthorized`.
- Значение `ABC_METRICS_API_KEY` в `rely-lead-processor` должно совпадать с `DB_API_KEY` в `abc-metrics`.

**Проверка ключей:**
```bash
# В abc-metrics
flyctl secrets list -a abc-metrics | grep DB_API_KEY

# В rely-lead-processor
flyctl secrets list -a rely-lead-processor | grep ABC_METRICS_API_KEY
```

**Если ключи не совпадают:**
```bash
# Установите одинаковое значение в обоих приложениях
flyctl secrets set ABC_METRICS_API_KEY="your-api-key" -a rely-lead-processor
flyctl secrets set DB_API_KEY="your-api-key" -a abc-metrics
```

### Опциональные переменные

#### Для Workiz API:

```env
# Workiz API (для синхронизации Workiz данных)
WORKIZ_API_KEY=your-workiz-api-key
WORKIZ_API_SECRET=your-workiz-api-secret
WORKIZ_API_URL=https://api.workiz.com
```

**Описание:**
- `WORKIZ_API_KEY` - API ключ Workiz
- `WORKIZ_API_SECRET` - API секрет Workiz
- `WORKIZ_API_URL` - URL API Workiz (по умолчанию: `https://api.workiz.com`)

**Требуется для:** Синхронизации Jobs, Leads, Payments из Workiz API

#### Для Elocal.com:

```env
# Elocal.com (для синхронизации звонков)
ELOCAL_USERNAME=help@bostonmasters.com
ELOCAL_PASSWORD=your-password
```

**Описание:**
- `ELOCAL_USERNAME` - Имя пользователя Elocal (например: `help@bostonmasters.com`)
- `ELOCAL_PASSWORD` - Пароль Elocal

**Требуется для:** Синхронизации Calls из Elocal.com через Puppeteer

#### Для CSV Processing:

```env
# CSV Processing (для обработки CSV файлов)
CSV_DIRECTORY=./csv-data
```

**Описание:**
- `CSV_DIRECTORY` - Директория с CSV файлами для обработки (по умолчанию: `./csv-data`)

**Требуется для:** Автоматической обработки CSV файлов

#### Для Puppeteer (опционально):

```env
# Puppeteer (опционально, только если нужен кастомный путь к Chrome)
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

**Описание:**
- `PUPPETEER_EXECUTABLE_PATH` - Путь к исполняемому файлу Chromium (опционально)

**Требуется для:** Кастомной конфигурации Puppeteer (обычно не требуется)

### Полный пример .env файла

```env
# ============================================
# ОБЯЗАТЕЛЬНЫЕ ПЕРЕМЕННЫЕ
# ============================================

# ABC Metrics API
ABC_METRICS_API_URL=https://abc-metrics.fly.dev
ABC_METRICS_API_KEY=your-api-key-here

# ============================================
# ОПЦИОНАЛЬНЫЕ ПЕРЕМЕННЫЕ (для синхронизации)
# ============================================

# Workiz API
WORKIZ_API_KEY=your-workiz-api-key
WORKIZ_API_SECRET=your-workiz-api-secret
WORKIZ_API_URL=https://api.workiz.com

# Elocal.com
ELOCAL_USERNAME=help@bostonmasters.com
ELOCAL_PASSWORD=your-password

# CSV Processing
CSV_DIRECTORY=./csv-data

# Puppeteer (опционально)
# PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

---

## Инициализация AbcMetricsClient

### Базовое использование

```typescript
import { AbcMetricsClient } from './services/abc-metrics-client';

// Создание экземпляра клиента
const client = new AbcMetricsClient();

// Клиент автоматически:
// 1. Читает ABC_METRICS_API_URL из process.env (или использует https://abc-metrics.fly.dev)
// 2. Читает ABC_METRICS_API_KEY из process.env
// 3. Настраивает HTTP клиент с заголовками X-API-Key
// 4. Настраивает timeout 30 секунд
```

### Проверка конфигурации

Если `ABC_METRICS_API_KEY` не установлен, конструктор выбросит ошибку:

```typescript
try {
  const client = new AbcMetricsClient();
} catch (error) {
  console.error('Failed to initialize AbcMetricsClient:', error.message);
  // Error: ABC_METRICS_API_KEY is required
}
```

---

## Основные методы клиента

### Сохранение данных

#### saveJobs(jobs: AbcMetricsJob[])

Сохраняет заявки (jobs) в `abc-metrics` через API.

```typescript
const jobs = [
  {
    job_id: '12345',
    date: '2025-01-15',
    type: 'COD Service',
    source: 'workiz',
    revenue: 150.00,
    status: 'Completed',
  },
];

const result = await client.saveJobs(jobs);
// result: { success: true, count: 1, message: 'Successfully saved 1 job(s)' }
```

#### saveLeads(leads: AbcMetricsLead[])

Сохраняет лиды (leads) в `abc-metrics` через API.

```typescript
const leads = [
  {
    lead_id: '67890',
    source: 'workiz',
    status: 'new',
    created_at: '2025-01-15T10:00:00Z',
    client_phone: '+1234567890',
    client_name: 'John Doe',
  },
];

const result = await client.saveLeads(leads);
```

#### savePayments(payments: AbcMetricsPayment[])

Сохраняет платежи (payments) в `abc-metrics` через API.

```typescript
const payments = [
  {
    payment_id: 'pay-001',
    job_id: '12345',
    date: '2025-01-15',
    amount: 150.00,
    method: 'Credit Card',
  },
];

const result = await client.savePayments(payments);
```

#### saveCalls(calls: AbcMetricsCall[])

Сохраняет звонки (calls) в `abc-metrics` через API.

```typescript
const calls = [
  {
    call_id: 'call-001',
    date: '2025-01-15',
    duration: 120, // секунды
    call_type: 'inbound',
    source: 'elocals',
  },
];

const result = await client.saveCalls(calls);
```

### Batch операции

#### batchSave(data: BatchData)

Сохраняет несколько типов данных в одной транзакции.

**Важно:** Максимальный размер тела запроса — **10MB**. При превышении лимита возвращается ошибка `413 Payload Too Large`. Рекомендуется разбивать большие батчи на несколько запросов.

**Рекомендации по размерам батчей:**
- **Jobs:** до 500 записей за запрос
- **Leads:** до 1000 записей за запрос
- **Payments:** до 2000 записей за запрос
- **Calls:** до 5000 записей за запрос

```typescript
const batchData = {
  jobs: [/* массив jobs */],
  leads: [/* массив leads */],
  payments: [/* массив payments */],
  calls: [/* массив calls */],
};

const result = await client.batchSave(batchData);
// result: { success: true, total_count: 10, results: { jobs: { count: 3 }, leads: { count: 4 }, ... } }
```

**Обработка ошибки 413 Payload Too Large:**

Если размер батча превышает лимит, разбейте его на меньшие части:

```typescript
// Разбиение большого батча jobs
const largeJobsBatch = [...1000 jobs...];
const chunkSize = 250;

for (let i = 0; i < largeJobsBatch.length; i += chunkSize) {
  const chunk = largeJobsBatch.slice(i, i + chunkSize);
  await client.saveJobs(chunk);
}
```

### Агрегация метрик

#### aggregateDaily(date?: string)

Запускает ежедневную агрегацию метрик в `abc-metrics`.

```typescript
// Агрегация за вчерашний день
await client.aggregateDaily();

// Агрегация за конкретную дату
await client.aggregateDaily('2025-01-15');
```

#### aggregateMonthly(month?: string)

Запускает месячную агрегацию метрик в `abc-metrics`.

```typescript
// Агрегация за прошлый месяц
await client.aggregateMonthly();

// Агрегация за конкретный месяц
await client.aggregateMonthly('2025-01-01');
```

---

## Обработка ошибок и retry логика

### Автоматические повторы

`AbcMetricsClient` автоматически повторяет запросы при следующих ошибках:

- **Сетевые ошибки** (нет ответа от сервера)
- **5xx ошибки** (внутренние ошибки сервера)

**Не повторяются:**
- **4xx ошибки** (ошибки клиента, например, неверный API ключ)
- **413 Payload Too Large** (превышен лимит размера запроса — требуется разбить батч)

### Обработка ошибки 413 Payload Too Large

Если размер запроса превышает лимит (10MB), сервер вернет ошибку `413`:

```typescript
try {
  const result = await client.batchSave(largeBatch);
} catch (error: any) {
  if (error.response?.status === 413) {
    // Разбейте батч на меньшие части
    const chunkSize = 250;
    for (let i = 0; i < largeBatch.jobs.length; i += chunkSize) {
      const chunk = largeBatch.jobs.slice(i, i + chunkSize);
      await client.saveJobs(chunk);
    }
  }
}
```

**Рекомендации:**
- Используйте рекомендуемые размеры батчей (см. раздел "Batch операции" выше)
- Реализуйте автоматическое разбиение больших батчей в вашем коде
- Мониторьте размеры запросов перед отправкой

### Конфигурация retry

По умолчанию:
- Максимум 3 попытки
- Задержка между попытками: 1 секунда

### Пример обработки ошибок

```typescript
try {
  const result = await client.saveJobs(jobs);
  if (result.success) {
    console.log(`Successfully saved ${result.count} jobs`);
  } else {
    console.error('Save failed:', result.error);
  }
} catch (error: any) {
  if (error.response) {
    // HTTP ошибка
    console.error('API Error:', error.response.status, error.response.data);
    
    if (error.response.status === 401) {
      console.error('Unauthorized: Check ABC_METRICS_API_KEY');
    } else if (error.response.status === 429) {
      console.error('Rate limit exceeded. Retry after:', error.response.headers['retry-after']);
    }
  } else if (error.request) {
    // Сетевая ошибка (нет ответа)
    console.error('Network error:', error.message);
  } else {
    // Другая ошибка
    console.error('Error:', error.message);
  }
}
```

### Rate Limiting

API `abc-metrics` имеет rate limiting:
- **Лимит:** 100 запросов в минуту на IP адрес
- **При превышении:** HTTP 429 Too Many Requests
- **Заголовки ответа:**
  - `X-RateLimit-Limit`: максимальное количество запросов
  - `X-RateLimit-Remaining`: оставшееся количество запросов
  - `X-RateLimit-Reset`: время сброса лимита
  - `Retry-After`: количество секунд до следующей попытки

---

## Примеры использования

### Пример 1: Синхронизация Jobs из Workiz

```typescript
import { AbcMetricsClient } from './services/abc-metrics-client';
import { SvcWorkizJobs } from './services/svc-workiz-jobs';

const client = new AbcMetricsClient();
const workizService = new SvcWorkizJobs();

// Получение jobs из Workiz
const jobs = await workizService.fetchJobs('2025-01-01', '2025-01-15');

// Сохранение через API
const result = await client.saveJobs(jobs.map(job => ({
  job_id: job.id,
  date: job.date,
  type: job.type,
  source: 'workiz',
  revenue: job.revenue,
  status: job.status,
  raw_data: job.raw_data,
})));

console.log(`Saved ${result.count} jobs`);
```

### Пример 2: Batch сохранение разных типов данных

```typescript
const client = new AbcMetricsClient();

// Сбор данных из разных источников
const jobs = await fetchJobsFromWorkiz();
const leads = await fetchLeadsFromWorkiz();
const payments = await fetchPaymentsFromWorkiz();

// Batch сохранение
const result = await client.batchSave({
  jobs: jobs.map(/* нормализация */),
  leads: leads.map(/* нормализация */),
  payments: payments.map(/* нормализация */),
});

console.log(`Batch saved: ${result.total_count} records`);
```

### Пример 3: Обработка ошибок с retry

```typescript
async function saveWithRetry(client: AbcMetricsClient, data: any[], maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await client.saveJobs(data);
      return result;
    } catch (error: any) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Экспоненциальная задержка
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

## Архитектурные принципы

### Принцип 1: Нет прямых подключений к БД

**❌ НЕПРАВИЛЬНО:**
```typescript
// В rely-lead-processor НЕ ДОЛЖНО быть:
import pool from '../db/connection';
await pool.query('INSERT INTO jobs ...');
```

**✅ ПРАВИЛЬНО:**
```typescript
// В rely-lead-processor ДОЛЖНО быть:
import { AbcMetricsClient } from './services/abc-metrics-client';
const client = new AbcMetricsClient();
await client.saveJobs(jobs);
```

### Принцип 2: UPSERT логика

Все операции сохранения используют UPSERT (ON CONFLICT DO UPDATE), что позволяет:
- Запускать синхронизацию хоть каждый час без дубликатов
- Данные всегда актуальны
- Не бояться повторных запусков

### Принцип 3: Идемпотентность

Все операции синхронизации идемпотентны:
- Можно запускать многократно без побочных эффектов
- Результат всегда одинаковый при одинаковых входных данных

---

## Дополнительные ресурсы

- [Документация DB API эндпоинтов](./db-api-endpoints.md) - детальное описание всех эндпоинтов
- [Документация metrics endpoints](./metrics-endpoints.md) - описание эндпоинтов синхронизации
- [Принципы архитектуры](../../architecture-principles.md) - архитектурные принципы проекта
- [Архитектура проекта](../../architecture.md) - общая архитектура проекта

---

## Поддержка

При возникновении проблем:

1. Проверьте переменные окружения (`ABC_METRICS_API_URL`, `ABC_METRICS_API_KEY`)
2. Проверьте логи на наличие ошибок аутентификации (401) или rate limiting (429)
3. Убедитесь, что `abc-metrics` приложение доступно и работает
4. Проверьте соответствие `ABC_METRICS_API_KEY` с `DB_API_KEY` в `abc-metrics`

