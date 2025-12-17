# Документация DB API эндпоинтов abc-metrics

Полное описание всех эндпоинтов `abc-metrics` DB API для работы с базой данных через REST API.

## Содержание

1. [Общая информация](#общая-информация)
2. [Аутентификация](#аутентификация)
3. [Rate Limiting](#rate-limiting)
4. [READ Endpoints](#read-endpoints)
5. [WRITE Endpoints](#write-endpoints)
6. [Batch Operations](#batch-operations)
7. [Aggregation Endpoints](#aggregation-endpoints)
8. [Коды ошибок](#коды-ошибок)

---

## Общая информация

### Базовый URL

```
https://abc-metrics.fly.dev
```

### Формат ответов

Все эндпоинты возвращают JSON с полем `success`:

```json
{
  "success": true,
  "count": 10,
  "data": [...]
}
```

При ошибке:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

---

## Аутентификация

**Все запросы к `/api/db/*` требуют аутентификации через API ключ.**

### Настройка API ключа

В `rely-lead-processor` должен быть установлен переменная окружения `ABC_METRICS_API_KEY` со значением, соответствующим `DB_API_KEY` в `abc-metrics`.

**Проверка ключа:**
```bash
# В abc-metrics
flyctl secrets list -a abc-metrics | grep DB_API_KEY

# В rely-lead-processor
flyctl secrets list -a rely-lead-processor | grep ABC_METRICS_API_KEY
```

**Важно:** Значения должны совпадать. Если ключи не совпадают, все запросы к `/api/db/*` будут возвращать `401 Unauthorized`.

### Использование API ключа

API ключ передается через заголовок `X-API-Key`:

```bash
curl -X GET \
  -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/jobs"
```

Или через query параметр `api_key`:

```bash
curl -X GET \
  "https://abc-metrics.fly.dev/api/db/jobs?api_key=your-api-key"
```

**Рекомендация:** Используйте заголовок `X-API-Key` для безопасности (query параметры могут попадать в логи).

Все эндпоинты DB API требуют аутентификации через API ключ.

### Заголовок

```
X-API-Key: your-api-key-here
```

### Query параметр (альтернатива)

```
?api_key=your-api-key-here
```

### Ошибка аутентификации

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

**HTTP статус:** 401 Unauthorized

---

## Rate Limiting

API имеет rate limiting для защиты от перегрузки:

- **Лимит:** 100 запросов в минуту на IP адрес
- **При превышении:** HTTP 429 Too Many Requests

### Заголовки ответа

- `X-RateLimit-Limit`: максимальное количество запросов (100)
- `X-RateLimit-Remaining`: оставшееся количество запросов
- `X-RateLimit-Reset`: время сброса лимита (ISO 8601)
- `Retry-After`: количество секунд до следующей попытки

### Ошибка rate limiting

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Maximum 100 requests per minute.",
  "retryAfter": 45
}
```

**HTTP статус:** 429 Too Many Requests

---

## READ Endpoints

### GET /api/db/jobs

Получить список заявок (jobs) с фильтрацией.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата фильтрации |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата фильтрации |
| `source` | string | Нет | Фильтр по источнику (workiz, elocals, google, и т.д.) |
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/jobs?start_date=2025-01-01&end_date=2025-01-31&limit=50"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 50,
  "data": [
    {
      "job_id": "12345",
      "lead_id": "67890",
      "serial_id": "2433",
      "technician_name": "Murad",
      "job_amount_due": 0,
      "job_total_price": 0,
      "job_end_date_time": "2025-01-15T16:00:00Z",
      "last_status_update": "2025-01-15T16:53:19Z",
      "source": "workiz",
      "source_name": "Workiz",
      "type": "INS Repair",
      "client_id": "2413",
      "created_at_db": "2025-01-15T10:00:00Z",
      "updated_at_db": "2025-01-15T10:00:00Z"
    }
  ]
}
```

---

### GET /api/db/leads

Получить список лидов (leads) с фильтрацией.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата фильтрации |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата фильтрации |
| `source` | string | Нет | Фильтр по источнику |
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/leads?start_date=2025-01-01&source=workiz"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "lead_id": "67890",
      "created_at": "2025-01-15T10:00:00Z",
      "source": "workiz",
      "source_name": "Workiz",
      "phone_hash": "abc123...",
      "cost": 0,
      "created_at_db": "2025-01-15T10:00:00Z",
      "updated_at_db": "2025-01-15T10:00:00Z"
    }
  ]
}
```

---

### GET /api/db/payments

Получить список платежей (payments) с фильтрацией.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата фильтрации |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата фильтрации |
| `job_id` | string | Нет | Фильтр по ID заявки |
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/payments?job_id=12345"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "payment_id": "pay-001",
      "job_id": "12345",
      "paid_at": "2025-01-15T14:00:00Z",
      "amount": 150.00,
      "method": "Credit Card",
      "created_at_db": "2025-01-15T14:00:00Z",
      "updated_at_db": "2025-01-15T14:00:00Z"
    }
  ]
}
```

---

### GET /api/db/calls

**⚠️ DEPRECATED:** Этот эндпойнт устарел. Используйте `/api/db/elocals_leads` вместо него.

Получить список звонков (calls) с фильтрацией.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата фильтрации |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата фильтрации |
| `source` | string | Нет | Фильтр по источнику (elocals, workiz) |
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/calls?start_date=2025-01-01&source=elocals"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "call_id": "call-001",
      "date": "2025-01-15",
      "duration": 120,
      "call_type": "inbound",
      "source": "elocals",
      "created_at": "2025-01-15T10:00:00Z",
      "updated_at": "2025-01-15T10:00:00Z"
    }
  ]
}
```

---

### GET /api/db/elocals_leads

Получить список лидов из eLocals с фильтрацией.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата фильтрации |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата фильтрации |
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/elocals_leads?start_date=2025-01-01&end_date=2025-01-31&limit=50"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 50,
  "data": [
    {
      "id": 1,
      "lead_id": "unique-id-001",
      "date": "2025-01-15",
      "duration": 120,
      "cost": 25.50,
      "status": "new",
      "lead_type": "inbound",
      "current_status": "new",
      "unique_id": "unique-id-001",
      "time": "2025-01-15T10:30:00Z",
      "forwarding_number": "+1234567890",
      "caller_id": "+1987654321",
      "caller_name": "John Doe",
      "profile": "Profile Name",
      "service_city": "Boston",
      "service_state": "MA",
      "service_zip": "02101",
      "recording_url": "https://example.com/recording.mp3",
      "profile_name": "Profile Name",
      "dispositions": "Interested",
      "dollar_value": 150.00,
      "notes": "Customer interested in service",
      "contact_first_name": "John",
      "contact_last_name": "Doe",
      "contact_phone": "+1987654321",
      "contact_extension": null,
      "contact_cell_phone": "+1987654321",
      "contact_email": "john@example.com",
      "contact_address": "123 Main St",
      "contact_city": "Boston",
      "contact_state": "MA",
      "contact_zip": "02101",
      "raw_data": {
        "Unique ID": "unique-id-001",
        "Time": "2025-01-15T10:30:00Z",
        "Duration": "120",
        "Cost": "25.50",
        "Status": "new",
        "...": "..."
      },
      "created_at": "2025-01-15T10:00:00Z",
      "updated_at": "2025-01-15T10:00:00Z"
    }
  ]
}
```

---

### GET /api/db/metrics/daily

Получить ежедневные агрегированные метрики.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_date` | string (YYYY-MM-DD) | Нет | Начальная дата фильтрации |
| `end_date` | string (YYYY-MM-DD) | Нет | Конечная дата фильтрации |
| `source` | string | Нет | Фильтр по источнику |
| `segment` | string | Нет | Фильтр по сегменту |
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/metrics/daily?start_date=2025-01-01&source=workiz"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "id": 1,
      "date": "2025-01-15",
      "source": "workiz",
      "segment": "repair",
      "leads": 10,
      "units": 5,
      "repairs": 3,
      "revenue_gross": 1500.00,
      "revenue40": 600.00,
      "cost": 200.00,
      "profit": 400.00,
      "calls": 15,
      "google_spend": 0,
      "cpl": 20.00,
      "conv_l_to_r": 0.30
    }
  ]
}
```

---

### GET /api/db/metrics/monthly

Получить месячные агрегированные метрики.

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `start_month` | string (YYYY-MM-DD) | Нет | Начальный месяц фильтрации |
| `end_month` | string (YYYY-MM-DD) | Нет | Конечный месяц фильтрации |
| `source` | string | Нет | Фильтр по источнику |
| `segment` | string | Нет | Фильтр по сегменту |
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/metrics/monthly?start_month=2025-01-01&source=workiz"
```

---

### GET /api/db/tables

Получить список всех таблиц в базе данных.

#### Параметры запроса

Нет параметров.

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/tables"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 20,
  "tables": [
    "fact_jobs",
    "fact_leads",
    "fact_payments",
    "dim_source",
    "daily_metrics",
    "monthly_metrics",
    ...
  ]
}
```

---

### GET /api/db/table/:name

Получить данные из указанной таблицы с пагинацией.

#### Параметры пути

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `name` | string | Да | Имя таблицы (только буквы, цифры, подчеркивания) |

#### Параметры запроса

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `limit` | number | Нет | Максимальное количество записей (по умолчанию: 100) |
| `offset` | number | Нет | Смещение для пагинации (по умолчанию: 0) |

#### Пример запроса

```bash
curl -H "X-API-Key: your-api-key" \
  "https://abc-metrics.fly.dev/api/db/table/fact_jobs?limit=10"
```

#### Пример ответа

```json
{
  "success": true,
  "table": "fact_jobs",
  "count": 10,
  "data": [
    {
      "job_id": "12345",
      "lead_id": "67890",
      ...
    }
  ]
}
```

---

## WRITE Endpoints

Все WRITE эндпоинты используют UPSERT логику (ON CONFLICT DO UPDATE), что позволяет:
- Запускать синхронизацию многократно без дубликатов
- Данные всегда актуальны
- Не бояться повторных запусков

### POST /api/db/jobs

Создать или обновить заявки (jobs).

#### Тело запроса

Массив объектов `AbcMetricsJob` или один объект:

```json
[
  {
    "job_id": "12345",
    "date": "2025-01-15",
    "type": "COD Service",
    "source": "workiz",
    "unit": "Refrigerator",
    "repair_type": "Repair",
    "cost": 50.00,
    "revenue": 150.00,
    "status": "Completed",
    "raw_data": { /* дополнительные данные */ }
  }
]
```

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '[{"job_id":"12345","date":"2025-01-15","type":"COD Service","source":"workiz","revenue":150.00}]' \
  "https://abc-metrics.fly.dev/api/db/jobs"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 1,
  "message": "Successfully saved 1 job(s)"
}
```

---

### POST /api/db/leads

Создать или обновить лиды (leads).

#### Тело запроса

Массив объектов `AbcMetricsLead` или один объект:

```json
[
  {
    "lead_id": "67890",
    "source": "workiz",
    "status": "new",
    "created_at": "2025-01-15T10:00:00Z",
    "updated_at": "2025-01-15T10:00:00Z",
    "job_id": "12345",
    "client_phone": "+1234567890",
    "client_name": "John Doe",
    "raw_data": { /* дополнительные данные */ }
  }
]
```

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '[{"lead_id":"67890","source":"workiz","status":"new","created_at":"2025-01-15T10:00:00Z"}]' \
  "https://abc-metrics.fly.dev/api/db/leads"
```

---

### POST /api/db/payments

Создать или обновить платежи (payments).

#### Тело запроса

Массив объектов `AbcMetricsPayment` или один объект:

```json
[
  {
    "payment_id": "pay-001",
    "job_id": "12345",
    "date": "2025-01-15",
    "amount": 150.00,
    "method": "Credit Card",
    "raw_data": { /* дополнительные данные */ }
  }
]
```

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '[{"payment_id":"pay-001","job_id":"12345","date":"2025-01-15","amount":150.00}]' \
  "https://abc-metrics.fly.dev/api/db/payments"
```

---

### POST /api/db/calls

**⚠️ DEPRECATED:** Этот эндпойнт устарел. Используйте `/api/db/elocals_leads` вместо него.

Создать или обновить звонки (calls).

#### Тело запроса

Массив объектов `AbcMetricsCall` или один объект:

```json
[
  {
    "call_id": "call-001",
    "date": "2025-01-15",
    "duration": 120,
    "call_type": "inbound",
    "source": "elocals"
  }
]
```

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '[{"call_id":"call-001","date":"2025-01-15","duration":120,"call_type":"inbound","source":"elocals"}]' \
  "https://abc-metrics.fly.dev/api/db/calls"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 1,
  "message": "Successfully saved 1 call(s)"
}
```

---

### POST /api/db/elocals_leads

Создать или обновить лиды из eLocals (UPSERT). Поддерживает импорт всех полей из CSV файла eLocals.

#### Тело запроса

Массив объектов с данными из CSV eLocals или один объект. Поля могут быть в формате CSV (с пробелами) или в snake_case:

```json
[
  {
    "Unique ID": "unique-id-001",
    "Time": "2025-01-15T10:30:00Z",
    "Duration": "120",
    "Cost": "25.50",
    "Status": "new",
    "Lead Type": "inbound",
    "Current Status": "new",
    "Forwarding Number": "+1234567890",
    "Caller ID": "+1987654321",
    "Caller Name": "John Doe",
    "Profile": "Profile Name",
    "Service City": "Boston",
    "Service State Abbr": "MA",
    "Service Zip Code": "02101",
    "Recording URL": "https://example.com/recording.mp3",
    "Profile Name": "Profile Name",
    "Dispositions": "Interested",
    "Dollar Value": "150.00",
    "Notes": "Customer interested in service",
    "Contact First Name": "John",
    "Contact Last Name": "Doe",
    "Contact Phone Number": "+1987654321",
    "Contact Extension": "",
    "Contact Cell Phone Number": "+1987654321",
    "Contact Email": "john@example.com",
    "Contact Address": "123 Main St",
    "Contact City": "Boston",
    "Contact State": "MA",
    "Contact Zip Code": "02101"
  }
]
```

**Альтернативный формат (snake_case):**

```json
[
  {
    "unique_id": "unique-id-001",
    "time": "2025-01-15T10:30:00Z",
    "duration": 120,
    "cost": 25.50,
    "status": "new",
    "lead_type": "inbound",
    "current_status": "new",
    "forwarding_number": "+1234567890",
    "caller_id": "+1987654321",
    "caller_name": "John Doe",
    "profile": "Profile Name",
    "service_city": "Boston",
    "service_state": "MA",
    "service_zip": "02101",
    "recording_url": "https://example.com/recording.mp3",
    "profile_name": "Profile Name",
    "dispositions": "Interested",
    "dollar_value": 150.00,
    "notes": "Customer interested in service",
    "contact_first_name": "John",
    "contact_last_name": "Doe",
    "contact_phone": "+1987654321",
    "contact_extension": null,
    "contact_cell_phone": "+1987654321",
    "contact_email": "john@example.com",
    "contact_address": "123 Main St",
    "contact_city": "Boston",
    "contact_state": "MA",
    "contact_zip": "02101"
  }
]
```

#### Маппинг полей

| CSV поле | Колонка БД | Описание |
|----------|------------|----------|
| `Unique ID` | `lead_id` | Уникальный идентификатор лида (обязательное поле) |
| `Time` | `date`, `time` | Дата и время звонка |
| `Duration` | `duration` | Длительность звонка в секундах |
| `Cost` | `cost` | Стоимость лида |
| `Status` | `status` | Статус лида |
| `Lead Type` | `lead_type` | Тип лида |
| `Current Status` | `current_status` | Текущий статус |
| Остальные поля | Соответствующие колонки | Все поля сохраняются в отдельные колонки |
| Все поля | `raw_data` | Все поля также сохраняются в JSONB поле `raw_data` |

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '[{
    "Unique ID": "unique-id-001",
    "Time": "2025-01-15T10:30:00Z",
    "Duration": "120",
    "Cost": "25.50",
    "Status": "new",
    "Caller Name": "John Doe",
    "Contact Phone Number": "+1987654321"
  }]' \
  "https://abc-metrics.fly.dev/api/db/elocals_leads"
```

#### Пример ответа

```json
{
  "success": true,
  "count": 1,
  "message": "Successfully saved 1 lead(s)"
}
```

#### Обработка ошибок

Если при сохранении некоторых записей произошли ошибки:

```json
{
  "success": true,
  "count": 2,
  "errors": [
    {
      "lead_id": "invalid-id",
      "error": "Invalid date format"
    }
  ],
  "message": "Successfully saved 2 lead(s), 1 error(s)"
}
```

#### Важные замечания

1. **Обязательное поле:** `Unique ID` (или `unique_id`, `lead_id`) - должно присутствовать в каждой записи
2. **UPSERT:** Если лид с таким `lead_id` уже существует, он будет обновлен
3. **Парсинг даты:** Поле `Time` автоматически парсится в дату. Если парсинг не удался, используется текущая дата
4. **Raw data:** Все поля из запроса сохраняются в JSONB поле `raw_data` для полной истории
5. **Транзакция:** Все записи сохраняются в одной транзакции - либо все успешно, либо откат

#### Миграция с `/api/db/calls`

Если вы использовали старый эндпойнт `/api/db/calls`, вот как мигрировать:

**Старый формат:**
```json
{
  "call_id": "call-001",
  "date": "2025-01-15",
  "duration": 120,
  "call_type": "inbound",
  "source": "elocals"
}
```

**Новый формат:**
```json
{
  "Unique ID": "call-001",
  "Time": "2025-01-15T00:00:00Z",
  "Duration": "120",
  "Lead Type": "inbound",
  "Status": "new"
}
```

---

## Batch Operations

### POST /api/db/batch

Сохранить несколько типов данных в одной транзакции.

**Важно:** Максимальный размер тела запроса — **10MB** (настраивается через `JSON_BODY_LIMIT`). При превышении лимита возвращается ошибка `413 Payload Too Large`. Рекомендуется разбивать большие батчи на несколько запросов.

**Рекомендации по размерам батчей:**
- **Jobs:** до 500 записей за запрос (приблизительно 2-5MB в зависимости от размера `meta` поля)
- **Leads:** до 1000 записей за запрос (приблизительно 1-3MB)
- **Payments:** до 2000 записей за запрос (приблизительно 1-2MB)
- **Calls:** до 5000 записей за запрос (приблизительно 1-2MB)

**При получении ошибки 413:**
1. Разделите батч на меньшие части (например, по 200-300 записей)
2. Отправьте несколько запросов последовательно
3. Убедитесь, что `ABC_METRICS_API_KEY` установлен корректно

#### Тело запроса

Объект с опциональными массивами:

```json
{
  "jobs": [/* массив jobs */],
  "leads": [/* массив leads */],
  "payments": [/* массив payments */],
  "calls": [/* массив calls */]
}
```

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jobs": [{"job_id":"12345","date":"2025-01-15","source":"workiz"}],
    "leads": [{"lead_id":"67890","source":"workiz","status":"new"}],
    "payments": [{"payment_id":"pay-001","job_id":"12345","date":"2025-01-15","amount":150.00}]
  }' \
  "https://abc-metrics.fly.dev/api/db/batch"
```

#### Пример ответа

```json
{
  "success": true,
  "total_count": 3,
  "results": {
    "jobs": { "count": 1, "errors": [] },
    "leads": { "count": 1, "errors": [] },
    "payments": { "count": 1, "errors": [] },
    "calls": { "count": 0, "errors": [] }
  },
  "message": "Batch operation completed: 3 record(s) saved"
}
```

#### Обработка ошибок в batch

Если при сохранении одного типа данных произошла ошибка, другие типы все равно сохранятся:

```json
{
  "success": false,
  "total_count": 2,
  "results": {
    "jobs": { "count": 1, "errors": [] },
    "leads": { "count": 0, "errors": ["Invalid lead data"] },
    "payments": { "count": 1, "errors": [] }
  },
  "message": "Batch operation completed: 2 record(s) saved"
}
```

---

## Aggregation Endpoints

### POST /api/db/aggregate/daily

Запустить ежедневную агрегацию метрик.

#### Тело запроса

```json
{
  "date": "2025-01-15"  // опционально, по умолчанию вчерашний день
}
```

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-01-15"}' \
  "https://abc-metrics.fly.dev/api/db/aggregate/daily"
```

#### Пример ответа

```json
{
  "success": true,
  "date": "2025-01-15",
  "message": "Daily aggregation completed"
}
```

---

### POST /api/db/aggregate/monthly

Запустить месячную агрегацию метрик.

#### Тело запроса

```json
{
  "month": "2025-01-01"  // опционально, по умолчанию прошлый месяц
}
```

#### Пример запроса

```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"month":"2025-01-01"}' \
  "https://abc-metrics.fly.dev/api/db/aggregate/monthly"
```

#### Пример ответа

```json
{
  "success": true,
  "month": "2025-01-01",
  "message": "Monthly aggregation completed"
}
```

---

## Коды ошибок

### 400 Bad Request

Некорректный запрос (неверный формат данных, отсутствуют обязательные поля).

**Пример:**
```json
{
  "success": false,
  "error": "Bad Request",
  "message": "No jobs provided"
}
```

### 401 Unauthorized

Отсутствует или неверный API ключ. Убедитесь, что:
1. Переменная окружения `ABC_METRICS_API_KEY` установлена в `rely-lead-processor`
2. Значение `ABC_METRICS_API_KEY` совпадает с `DB_API_KEY` в `abc-metrics`
3. API ключ передается через заголовок `X-API-Key` или query параметр `api_key`

**Пример:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

**Решение:**
```bash
# Проверьте ключи в обоих приложениях
flyctl secrets list -a abc-metrics | grep DB_API_KEY
flyctl secrets list -a rely-lead-processor | grep ABC_METRICS_API_KEY

# Если ключи не совпадают, установите одинаковое значение:
flyctl secrets set ABC_METRICS_API_KEY="your-api-key" -a rely-lead-processor
```

### 413 Payload Too Large

Размер тела запроса превышает максимальный лимит (10MB по умолчанию).

**Пример:**
```json
{
  "success": false,
  "error": "Payload Too Large",
  "message": "Request body exceeds maximum size of 10mb. Please split large batches into smaller requests.",
  "limit": "10mb"
}
```

**Решение:** Разбейте большой батч на несколько меньших запросов (см. рекомендации по размерам батчей выше).

```json
{
  "success": false,
  "error": "Bad Request",
  "message": "No jobs provided"
}
```

### 401 Unauthorized

Отсутствует или неверный API ключ.

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

### 429 Too Many Requests

Превышен лимит запросов (100 в минуту).

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Maximum 100 requests per minute.",
  "retryAfter": 45
}
```

### 500 Internal Server Error

Внутренняя ошибка сервера.

```json
{
  "success": false,
  "error": "Internal server error",
  "message": "Detailed error message"
}
```

---

## Дополнительные ресурсы

- [Основной гайд по работе с API](./abc-metrics-api-guide.md) - использование AbcMetricsClient
- [Документация metrics endpoints](./metrics-endpoints.md) - эндпоинты синхронизации
- [Принципы архитектуры](../../architecture-principles.md) - архитектурные принципы проекта

