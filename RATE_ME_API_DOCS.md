# Документация Rate Me API

## Обзор

Rate Me API предоставляет доступ к данным о работах и токенам для системы Rate Me. API использует версионирование `/api/v1/...`.

**Базовый URL:** `https://abc-metrics.fly.dev/api/v1`

**Статус:** ✅ Реализовано и доступно

## Аутентификация

Все endpoints требуют аутентификации через API ключ.

### Варианты аутентификации:

1. **Bearer Token (рекомендуется):**
   ```
   Authorization: Bearer {apiKey}
   ```

2. **X-API-Key заголовок:**
   ```
   X-API-Key: {apiKey}
   ```

### Получение API ключа:

API ключ устанавливается в переменной окружения `DB_APP_API_KEY` на сервере. Обратитесь к администратору для получения ключа.

**Важно для настройки Rate Me сервиса:**
- `DB_APP_API_KEY` - API ключ для аутентификации (можно использовать любой надежный ключ)
- `JOB_TOKEN_SECRET` - **ДОЛЖЕН СОВПАДАТЬ** с секретом в Rate Me приложении для валидации JWT токенов

**Важно для настройки Rate Me сервиса:**
- `DB_APP_API_KEY` - API ключ для аутентификации (можно использовать любой надежный ключ)
- `JOB_TOKEN_SECRET` - **ДОЛЖЕН СОВПАДАТЬ** с секретом в Rate Me приложении для валидации JWT токенов

---

## Rate Limiting

По умолчанию: **100 запросов в минуту** на API ключ.

При превышении лимита возвращается HTTP 429 с заголовками:
- `RateLimit-Limit`: максимальное количество запросов
- `RateLimit-Remaining`: оставшиеся запросы
- `RateLimit-Reset`: время сброса лимита (Unix timestamp)

---

## Endpoints

### 1. GET `/api/v1/jobs/{uuid}`

Получение информации о работе по UUID.

**Параметры:**
- `uuid` (path) - UUID работы из Workiz

**Логика работы:**
1. Поиск работы в PostgreSQL
2. Если не найдена → запрос к Workiz API и сохранение в БД
3. Возврат данных работы

**Пример запроса:**
```bash
curl -X GET "https://abc-metrics.fly.dev/api/v1/jobs/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

**Ответ (200 OK):**
```json
{
  "data": {
    "UUID": "M7PEMN",
    "SerialId": 12345,
    "ClientId": 2414,
    "FirstName": "John",
    "LastName": "Doe",
    "JobType": "Repair",
    "PostalCode": "02134",
    "City": "Boston",
    "Team": [
      {
        "id": 5678,
        "Name": "Jane Technician"
      }
    ]
  }
}
```

**Ошибки:**
- `401 Unauthorized` - отсутствует или неверный API ключ
- `404 Not Found` - работа не найдена
- `429 Too Many Requests` - превышен лимит запросов
- `500 Internal Server Error` - внутренняя ошибка сервера

---

### 2. GET `/api/v1/jobs/serial/{serialId}`

Получение информации о работе по SerialId.

**Параметры:**
- `serialId` (path) - SerialId работы

**Примечание:** Если работы нет в БД, запрос к Workiz API не выполняется.

**Пример запроса:**
```bash
curl -X GET "https://abc-metrics.fly.dev/api/v1/jobs/serial/12345" \
  -H "Authorization: Bearer your-api-key"
```

**Ответ:** Аналогично `GET /api/v1/jobs/{uuid}`

---

### 3. GET `/api/v1/job-tokens/{jobUuid}`

Получение или создание токена для работы.

**Параметры:**
- `jobUuid` (path) - UUID работы

**Логика работы:**
1. Поиск существующего токена
2. Если токен найден и не истек → возврат
3. Если токена нет или истек → создание нового токена
4. Возврат токена

**Пример запроса:**
```bash
curl -X GET "https://abc-metrics.fly.dev/api/v1/job-tokens/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

**Ответ (200 OK):**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "jobId": "M7PEMN",
    "jobSerialId": 12345,
    "customerId": "2414",
    "customerEmail": "john@example.com",
    "customerPhone": "+1234567890",
    "customerFirstName": "John",
    "customerLastName": "Doe",
    "status": "pending",
    "sentVia": null,
    "sentAt": null,
    "createdAt": "2025-12-10T10:00:00Z",
    "expiresAt": "2025-12-17T10:00:00Z"
  }
}
```

**JWT Token формат:**
```json
{
  "jobId": "M7PEMN",
  "customerId": "2414",
  "issuedAt": 1765250543,
  "expiresAt": 1765855343,
  "nonce": "cglxnsm7n2ksjzorkshww"
}
```

- Алгоритм: `HS256`
- TTL: 7 дней (настраивается через `JOB_TOKEN_TTL_DAYS`)
- Secret: `JOB_TOKEN_SECRET` (должен совпадать с Rate Me приложением)

---

### 4. GET `/api/v1/job-tokens/serial/{serialId}`

Получение токена для работы по SerialId.

**Параметры:**
- `serialId` (path) - SerialId работы

**Пример запроса:**
```bash
curl -X GET "https://abc-metrics.fly.dev/api/v1/job-tokens/serial/12345" \
  -H "Authorization: Bearer your-api-key"
```

**Ответ:** Аналогично `GET /api/v1/job-tokens/{jobUuid}`

---

### 5. POST `/api/v1/job-tokens`

Создание токена для работы вручную.

**Body:**
```json
{
  "jobUuid": "M7PEMN",
  "customerId": "2414",
  "customerEmail": "john@example.com",
  "customerPhone": "+1234567890",
  "customerFirstName": "John",
  "customerLastName": "Doe"
}
```

**Обязательные поля:**
- `jobUuid` - UUID работы
- `customerId` - ID клиента

**Пример запроса:**
```bash
curl -X POST "https://abc-metrics.fly.dev/api/v1/job-tokens" \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jobUuid": "M7PEMN",
    "customerId": "2414"
  }'
```

**Ответ (201 Created):** Аналогично `GET /api/v1/job-tokens/{jobUuid}`

**Ошибки:**
- `409 Conflict` - токен уже существует для этой работы

---

### 6. PUT `/api/v1/job-tokens/{tokenId}`

Обновление статуса токена.

**Параметры:**
- `tokenId` (path) - ID токена (UUID)

**Body (все поля опциональны):**
```json
{
  "status": "sent",
  "sentVia": "sms",
  "sentAt": "2025-12-10T10:30:00Z"
}
```

**Поля:**
- `status` - новый статус: `pending`, `sent`, `expired`, `used`
- `sentVia` - способ отправки: `email`, `sms`, `both`
- `sentAt` - время отправки (ISO timestamp)

**Пример запроса:**
```bash
curl -X PUT "https://abc-metrics.fly.dev/api/v1/job-tokens/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "sent",
    "sentVia": "sms",
    "sentAt": "2025-12-10T10:30:00Z"
  }'
```

**Ответ (200 OK):** Обновленный токен

---

## Переменные окружения для сервера

Для работы Rate Me API требуются следующие переменные окружения:

```bash
# PostgreSQL (уже настроено)
DATABASE_URL=postgresql://...

# Workiz API (уже настроено)
WORKIZ_API_KEY=api_...
WORKIZ_API_URL=https://api.workiz.com

# JWT Token Secret (ДОЛЖЕН СОВПАДАТЬ с Rate Me приложением!)
JOB_TOKEN_SECRET=your-secret-key-here

# API ключ для аутентификации Rate Me
DB_APP_API_KEY=your-api-key-here

# Rate Limiting (опционально, по умолчанию 100)
RATE_LIMIT_PER_MINUTE=100

# JWT Token TTL в днях (опционально, по умолчанию 7)
JOB_TOKEN_TTL_DAYS=7
```

---

## Установка на Fly.io

### 1. Установка переменных окружения:

```bash
# JWT Token Secret (ВАЖНО: должен совпадать с Rate Me приложением!)
flyctl secrets set JOB_TOKEN_SECRET="your-secret-key-here" -a abc-metrics

# API ключ для аутентификации Rate Me
flyctl secrets set DB_APP_API_KEY="your-api-key-here" -a abc-metrics

# Опционально: настройка rate limiting и TTL
flyctl secrets set RATE_LIMIT_PER_MINUTE="100" -a abc-metrics
flyctl secrets set JOB_TOKEN_TTL_DAYS="7" -a abc-metrics
```

### 2. Деплой:

```bash
flyctl deploy -a abc-metrics
```

### 3. Проверка:

```bash
curl -X GET "https://abc-metrics.fly.dev/api/v1/jobs/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

---

## Защита токенов

**ВАЖНО:** Таблица `job_tokens` **НЕ имеет жесткого FOREIGN KEY** на `fact_jobs`. Это защищает токены от случайного удаления при:
- Синхронизации данных из Workiz
- Обновлении структуры таблицы `fact_jobs`
- Пересоздании записей в `fact_jobs`

Связь между `job_tokens` и `fact_jobs` логическая через `job_uuid` (без CASCADE DELETE).

---

## Обработка ошибок

### Формат ошибок:

```json
{
  "error": "Error Type",
  "message": "Human-readable error message"
}
```

### Коды ошибок:

- `400 Bad Request` - невалидные данные
- `401 Unauthorized` - отсутствует или неверный API ключ
- `404 Not Found` - ресурс не найден
- `409 Conflict` - конфликт (например, токен уже существует)
- `429 Too Many Requests` - превышен лимит запросов
- `500 Internal Server Error` - внутренняя ошибка сервера

---

## Примеры использования

### Полный пример работы с токеном:

```bash
# 1. Получить работу
curl -X GET "https://abc-metrics.fly.dev/api/v1/jobs/M7PEMN" \
  -H "Authorization: Bearer your-api-key"

# 2. Получить токен для работы
curl -X GET "https://abc-metrics.fly.dev/api/v1/job-tokens/M7PEMN" \
  -H "Authorization: Bearer your-api-key"

# 3. Обновить статус токена после отправки
curl -X PUT "https://abc-metrics.fly.dev/api/v1/job-tokens/{tokenId}" \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "sent",
    "sentVia": "sms",
    "sentAt": "2025-12-10T10:30:00Z"
  }'
```

---

## Безопасность

1. **Храните API ключи в безопасности** - никогда не коммитьте их в репозиторий
2. **Используйте HTTPS** - все запросы должны идти через HTTPS
3. **JWT Secret** - должен быть достаточно сложным и храниться в секретах
4. **Rate Limiting** - защищает от злоупотреблений
5. **Логирование** - все запросы логируются (без sensitive данных)

---

## Поддержка

При возникновении проблем проверьте:
1. Правильность API ключа
2. Наличие переменных окружения на сервере
3. Логи приложения: `flyctl logs -a abc-metrics`

---

**Версия документа:** 1.0  
**Дата обновления:** 2025-12-10

