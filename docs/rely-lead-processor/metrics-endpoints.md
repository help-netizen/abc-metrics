# Документация metrics endpoints в rely-lead-processor

Описание всех эндпоинтов metrics module, доступных в `rely-lead-processor` для синхронизации данных из внешних источников.

## Содержание

1. [Общая информация](#общая-информация)
2. [Test Endpoints (GET)](#test-endpoints-get)
3. [Sync Endpoints (POST)](#sync-endpoints-post)
4. [CSV Processing](#csv-processing)
5. [Примеры использования](#примеры-использования)

---

## Общая информация

### Базовый URL

Все эндпоинты metrics module имеют префикс `/api/metrics/`:

```
http://your-rely-lead-processor-host/api/metrics/...
```

### Формат ответов

Все эндпоинты возвращают JSON:

**Успешный ответ:**
```json
{
  "success": true,
  "count": 10,
  "message": "Operation completed"
}
```

**Ошибка:**
```json
{
  "success": false,
  "error": "Error message"
}
```

---

## Test Endpoints (GET)

Test endpoints позволяют получить данные из внешних источников **без сохранения в БД**. Используются для тестирования и отладки.

### GET /api/metrics/test/workiz/jobs

Получить заявки (jobs) из Workiz API без сохранения в БД.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата (по умолчанию: 7 дней назад) |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата (по умолчанию: сегодня) |

#### Пример запроса

```bash
curl "http://localhost:3000/api/metrics/test/workiz/jobs?start_date=2025-01-01&end_date=2025-01-15"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 79,
  "start_date": "2025-01-01",
  "end_date": "2025-01-15",
  "jobs": [
    {
      "id": "12345",
      "date": "2025-01-15",
      "type": "COD Service",
      "source": "workiz",
      "revenue": 150.00,
      "status": "Completed",
      ...
    }
    // ... первые 10 записей
  ]
}
```

**Примечание:** Возвращаются только первые 10 записей для тестирования.

---

### GET /api/metrics/test/workiz/leads

Получить лиды (leads) из Workiz API без сохранения в БД.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата (по умолчанию: 7 дней назад) |

#### Пример запроса

```bash
curl "http://localhost:3000/api/metrics/test/workiz/leads?start_date=2025-01-01"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 14,
  "start_date": "2025-01-01",
  "leads": [
    {
      "id": "67890",
      "source": "workiz",
      "status": "new",
      "created_at": "2025-01-15T10:00:00Z",
      ...
    }
    // ... первые 10 записей
  ]
}
```

---

### GET /api/metrics/test/workiz/payments

Получить платежи (payments) из Workiz API без сохранения в БД.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата (по умолчанию: 7 дней назад) |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата (по умолчанию: сегодня) |

#### Пример запроса

```bash
curl "http://localhost:3000/api/metrics/test/workiz/payments?start_date=2025-01-01&end_date=2025-01-15"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 25,
  "start_date": "2025-01-01",
  "end_date": "2025-01-15",
  "payments": [
    {
      "id": "pay-001",
      "job_id": "12345",
      "date": "2025-01-15",
      "amount": 150.00,
      "method": "Credit Card",
      ...
    }
    // ... первые 10 записей
  ]
}
```

---

### GET /api/metrics/test/elocal/calls

Получить звонки (calls) из Elocal.com без сохранения в БД.

**Важно:** Этот эндпоинт использует Puppeteer для веб-скрапинга, поэтому может занимать 60-70 секунд на аутентификацию.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата (по умолчанию: 30 дней назад) |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата (по умолчанию: вчера) |

#### Пример запроса

```bash
curl "http://localhost:3000/api/metrics/test/elocal/calls?start_date=2025-01-01&end_date=2025-01-15"
```

#### Пример ответа

```json
{
  "success": true,
  "start_date": "2025-01-01",
  "end_date": "2025-01-15",
  "count": 50,
  "calls": [
    {
      "call_id": "call-001",
      "date": "2025-01-15",
      "duration": 120,
      "call_type": "inbound",
      "source": "elocals"
    }
    // ... первые 10 записей
  ]
}
```

**Примечание:** Браузер автоматически закрывается после получения данных.

---

## Sync Endpoints (POST)

Sync endpoints выполняют полную синхронизацию данных из внешних источников **с сохранением в БД** через `AbcMetricsClient`.

### POST /api/metrics/sync/workiz/jobs

Запустить полную синхронизацию заявок (jobs) из Workiz.

**Период синхронизации:** Последние 30 дней (исключая текущий день)

#### Пример запроса

```bash
curl -X POST "http://localhost:3000/api/metrics/sync/workiz/jobs"
```

#### Пример ответа

```json
{
  "success": true,
  "message": "Workiz jobs sync completed"
}
```

**Процесс:**
1. Получение данных из Workiz API (последние 30 дней)
2. Нормализация данных
3. Сохранение через `AbcMetricsClient.saveJobs()` в `abc-metrics` DB API
4. Использование UPSERT логики (без дубликатов)

---

### POST /api/metrics/sync/workiz/leads

Запустить полную синхронизацию лидов (leads) из Workiz.

**Период синхронизации:** Последние 30 дней (исключая текущий день)

#### Пример запроса

```bash
curl -X POST "http://localhost:3000/api/metrics/sync/workiz/leads"
```

#### Пример ответа

```json
{
  "success": true,
  "message": "Workiz leads sync completed"
}
```

**Процесс:**
1. Получение данных из Workiz API (последние 30 дней)
2. Нормализация данных (все источники: Pro Referral, Google, Website и др.)
3. Сохранение через `AbcMetricsClient.saveLeads()` в `abc-metrics` DB API
4. Использование UPSERT логики

---

### POST /api/metrics/sync/workiz/payments

Запустить полную синхронизацию платежей (payments) из Workiz.

**Период синхронизации:** Последние 30 дней (исключая текущий день)

#### Пример запроса

```bash
curl -X POST "http://localhost:3000/api/metrics/sync/workiz/payments"
```

#### Пример ответа

```json
{
  "success": true,
  "message": "Workiz payments sync completed"
}
```

**Процесс:**
1. Получение данных из Workiz API (последние 30 дней)
2. Нормализация данных
3. Сохранение через `AbcMetricsClient.savePayments()` в `abc-metrics` DB API
4. Связывание с jobs через `job_id`

---

### POST /api/metrics/sync/elocal/calls

Запустить полную синхронизацию звонков (calls) из Elocal.com.

**Период синхронизации:** Последние 30 дней (исключая текущий день)

**Важно:** Использует Puppeteer для веб-скрапинга, может занимать 60-70 секунд на аутентификацию.

#### Пример запроса

```bash
curl -X POST "http://localhost:3000/api/metrics/sync/elocal/calls"
```

#### Пример ответа

```json
{
  "success": true,
  "message": "Elocal calls sync completed"
}
```

**Процесс:**
1. Автоматизация браузера через Puppeteer
2. Аутентификация на elocal.com (~60-70 секунд)
3. Загрузка CSV со звонками
4. Парсинг CSV
5. Сохранение через `AbcMetricsClient.saveCalls()` в `abc-metrics` DB API
6. Закрытие браузера

---

### POST /api/metrics/process/csv

Обработать CSV файлы из указанной директории.

**Директория:** Настраивается через переменную окружения `CSV_DIRECTORY` (по умолчанию: `./csv-data`)

#### Пример запроса

```bash
curl -X POST "http://localhost:3000/api/metrics/process/csv"
```

#### Пример ответа

```json
{
  "success": true,
  "message": "CSV processing completed"
}
```

**Процесс:**
1. Сканирование директории `CSV_DIRECTORY` на наличие CSV файлов
2. Определение типа данных по имени файла:
   - содержит "job" или "work" → `jobs`
   - содержит "payment" → `payments`
   - содержит "call" → `calls`
   - содержит "elocal" → `elocals_leads`
   - содержит "google" или "spend" → `google_spend`
3. Парсинг CSV файлов
4. Сохранение через соответствующие методы `AbcMetricsClient` в `abc-metrics` DB API

---

## Примеры использования

### Пример 1: Тестирование получения данных перед синхронизацией

```bash
# 1. Проверить, какие данные доступны в Workiz
curl "http://localhost:3000/api/metrics/test/workiz/jobs?start_date=2025-01-01"

# 2. Если данные корректны, запустить синхронизацию
curl -X POST "http://localhost:3000/api/metrics/sync/workiz/jobs"
```

### Пример 2: Полная синхронизация всех источников

```bash
# Синхронизация Jobs
curl -X POST "http://localhost:3000/api/metrics/sync/workiz/jobs"

# Синхронизация Leads
curl -X POST "http://localhost:3000/api/metrics/sync/workiz/leads"

# Синхронизация Payments
curl -X POST "http://localhost:3000/api/metrics/sync/workiz/payments"

# Синхронизация Calls из Elocal
curl -X POST "http://localhost:3000/api/metrics/sync/elocal/calls"
```

### Пример 3: Использование в коде (TypeScript)

```typescript
import axios from 'axios';

const API_BASE_URL = process.env.RELY_LEAD_PROCESSOR_URL || 'http://localhost:3000';

// Тест получения данных
async function testWorkizJobs() {
  const response = await axios.get(`${API_BASE_URL}/api/metrics/test/workiz/jobs`, {
    params: {
      start_date: '2025-01-01',
      end_date: '2025-01-15',
    },
  });
  
  console.log(`Found ${response.data.count} jobs`);
  return response.data.jobs;
}

// Запуск синхронизации
async function syncWorkizJobs() {
  const response = await axios.post(`${API_BASE_URL}/api/metrics/sync/workiz/jobs`);
  
  if (response.data.success) {
    console.log('Sync completed:', response.data.message);
  } else {
    console.error('Sync failed:', response.data.error);
  }
}
```

---

## Автоматическая синхронизация

Metrics module включает планировщик задач, который автоматически запускает синхронизацию:

- **Workiz Jobs**: каждый час в 0 минут
- **Workiz Leads**: каждый час в 5 минут
- **Workiz Payments**: каждый час в 10 минут
- **Elocal Calls**: каждый день в 4:00 AM (последние 30 дней, исключая текущий день)
- **CSV Processing**: каждые 6 часов

Планировщик запускается автоматически при старте приложения, если модуль интегрирован:

```typescript
import metricsModule from './metrics';

// Интеграция routes
app.use('/api/metrics', metricsModule.routes);

// Запуск планировщика
metricsModule.scheduler.start();
```

---

## Идемпотентность

Все операции синхронизации идемпотентны:

- Можно запускать многократно без побочных эффектов
- Используется UPSERT логика (ON CONFLICT DO UPDATE)
- Данные всегда актуальны
- Нет дубликатов при повторных запусках

---

## Обработка ошибок

### Сетевые ошибки

При ошибках сети или 5xx ошибках от `abc-metrics` API, `AbcMetricsClient` автоматически повторяет запросы (до 3 попыток).

### Ошибки аутентификации

Если `ABC_METRICS_API_KEY` неверен или отсутствует:

```json
{
  "success": false,
  "error": "API request failed: Invalid or missing API key"
}
```

### Ошибки валидации данных

Если данные не прошли валидацию:

```json
{
  "success": false,
  "error": "Validation error: Missing required field 'job_id'"
}
```

---

## Дополнительные ресурсы

- [Основной гайд по работе с API](./abc-metrics-api-guide.md) - использование AbcMetricsClient
- [Документация DB API эндпоинтов](./db-api-endpoints.md) - все эндпоинты abc-metrics DB API
- [Принципы архитектуры](../../architecture-principles.md) - архитектурные принципы проекта
- [README metrics module](../../metrics-module-template/README.md) - документация модуля



