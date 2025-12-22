# Требования к БД-приложению для Rate Me

## Обзор

Этот документ описывает требования к приложению, которое управляет БД PostgreSQL и предоставляет API для Rate Me системы.

Rate Me приложение будет обращаться к БД-приложению через REST API для получения:
- Данных о работах (jobs)
- Токенов для работ (job tokens)

БД-приложение должно управлять PostgreSQL базой данных, содержащей информацию о работах из Workiz, и предоставлять единую точку доступа для Rate Me.

---

## Структура таблиц для Rate Me

### 1. Таблица `job_tokens`

**Назначение:** Хранение токенов для работ в Rate Me системе.

**Схема:**

```sql
CREATE TABLE job_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_uuid VARCHAR(255) NOT NULL,
    job_serial_id INTEGER,
    customer_id VARCHAR(255) NOT NULL,
    token TEXT NOT NULL,
    customer_email VARCHAR(255),
    customer_phone VARCHAR(255),
    customer_first_name VARCHAR(255),
    customer_last_name VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    sent_via VARCHAR(50),
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meta JSONB,
    lead_id VARCHAR(255),
    source_id VARCHAR(255),
    created_at_db TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at_db TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_job_uuid FOREIGN KEY (job_uuid) REFERENCES jobs(uuid) ON DELETE CASCADE,
    CONSTRAINT chk_status CHECK (status IN ('pending', 'sent', 'expired', 'used')),
    CONSTRAINT chk_sent_via CHECK (sent_via IN ('email', 'sms', 'both') OR sent_via IS NULL)
);

CREATE UNIQUE INDEX idx_job_tokens_job_uuid ON job_tokens (job_uuid);
CREATE INDEX idx_job_tokens_job_serial_id ON job_tokens (job_serial_id);
CREATE INDEX idx_job_tokens_customer_id ON job_tokens (customer_id);
CREATE INDEX idx_job_tokens_status ON job_tokens (status);
CREATE INDEX idx_job_tokens_expires_at ON job_tokens (expires_at);
```

**Описание полей:**

- `id` - Уникальный идентификатор токена (UUID)
- `job_uuid` - UUID работы из Workiz (связь с таблицей работ)
- `job_serial_id` - SerialId работы (опционально, для быстрого поиска)
- `customer_id` - ID клиента из Workiz
- `token` - JWT токен (строка)
- `customer_email` - Email клиента
- `customer_phone` - Телефон клиента
- `customer_first_name` - Имя клиента
- `customer_last_name` - Фамилия клиента
- `status` - Статус токена: 'pending', 'sent', 'expired', 'used'
- `sent_via` - Способ отправки: 'email', 'sms', 'both'
- `sent_at` - Время отправки токена
- `created_at` - Время создания токена
- `expires_at` - Время истечения токена
- `updated_at` - Время последнего обновления

**Примечания:**

- Токен должен быть уникальным для работы (один токен на работу)
- `job_uuid` должен существовать в таблице работ (foreign key)
- Индексы созданы для быстрого поиска по основным полям

---

### 2. Таблица `referral_links`

**Назначение:** Хранение реферальных ссылок для клиентов.

**Схема:**

```sql
CREATE TABLE referral_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id VARCHAR(255) NOT NULL,
    referral_slug VARCHAR(255) NOT NULL UNIQUE,
    customer_first_name VARCHAR(255),
    customer_last_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_customer_id UNIQUE (customer_id)
);

CREATE UNIQUE INDEX idx_referral_links_slug ON referral_links (referral_slug);
CREATE INDEX idx_referral_links_customer_id ON referral_links (customer_id);
```

**Описание полей:**

- `id` - Уникальный идентификатор ссылки (UUID)
- `customer_id` - ID клиента из Workiz (уникальный, один клиент - одна ссылка)
- `referral_slug` - Уникальный slug для реферальной ссылки (например: "john-doe-12345")
- `customer_first_name` - Имя клиента (для отображения)
- `customer_last_name` - Фамилия клиента (для отображения)
- `created_at` - Время создания ссылки

**Примечания:**

- Один клиент может иметь только одну реферальную ссылку
- `referral_slug` должен быть уникальным и безопасным для использования в URL

---

### 3. Таблица `referral_shares`

**Назначение:** Хранение информации об отправленных реферальных ссылках.

**Схема:**

```sql
CREATE TABLE referral_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_link_id UUID NOT NULL,
    recipient_phone VARCHAR(255) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_referral_link FOREIGN KEY (referral_link_id) REFERENCES referral_links(id) ON DELETE CASCADE
);

CREATE INDEX idx_referral_shares_link_id ON referral_shares (referral_link_id);
CREATE INDEX idx_referral_shares_phone ON referral_shares (recipient_phone);
CREATE INDEX idx_referral_shares_sent_at ON referral_shares (sent_at);
```

**Описание полей:**

- `id` - Уникальный идентификатор записи (UUID)
- `referral_link_id` - ID реферальной ссылки
- `recipient_phone` - Телефон получателя
- `sent_at` - Время отправки

---

### 4. Таблица `rewards`

**Назначение:** Хранение информации о наградах (perks) для клиентов.

**Схема:**

```sql
CREATE TABLE rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id VARCHAR(255) NOT NULL,
    job_id VARCHAR(255),
    new_job_id VARCHAR(255),
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_reward_type CHECK (type IN ('review_perk', 'share_perk', 'referral_payout')),
    CONSTRAINT chk_reward_status CHECK (status IN ('pending', 'approved', 'paid', 'cancelled'))
);

CREATE INDEX idx_rewards_customer_id ON rewards (customer_id);
CREATE INDEX idx_rewards_job_id ON rewards (job_id);
CREATE INDEX idx_rewards_type ON rewards (type);
CREATE INDEX idx_rewards_status ON rewards (status);
CREATE INDEX idx_rewards_created_at ON rewards (created_at);
```

**Описание полей:**

- `id` - Уникальный идентификатор награды (UUID)
- `customer_id` - ID клиента из Workiz
- `job_id` - UUID работы (для review_perk, share_perk)
- `new_job_id` - UUID новой работы (для referral_payout - работа, созданная по реферальной ссылке)
- `type` - Тип награды: 'review_perk', 'share_perk', 'referral_payout'
- `amount` - Сумма награды
- `currency` - Валюта (по умолчанию 'USD')
- `status` - Статус награды: 'pending', 'approved', 'paid', 'cancelled'
- `created_at` - Время создания
- `updated_at` - Время последнего обновления

---

### 5. Таблица `rate_me_events`

**Назначение:** Хранение событий Rate Me системы для аналитики и отладки.

**Схема:**

```sql
CREATE TABLE rate_me_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(255) NOT NULL,
    job_id VARCHAR(255),
    customer_id VARCHAR(255),
    data JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rate_me_events_type ON rate_me_events (event_type);
CREATE INDEX idx_rate_me_events_job_id ON rate_me_events (job_id);
CREATE INDEX idx_rate_me_events_customer_id ON rate_me_events (customer_id);
CREATE INDEX idx_rate_me_events_created_at ON rate_me_events (created_at);
CREATE INDEX idx_rate_me_events_data ON rate_me_events USING GIN (data); -- GIN индекс для JSONB
```

**Описание полей:**

- `id` - Уникальный идентификатор события (UUID)
- `event_type` - Тип события (например: 'context_resolved', 'review_submitted', 'token_created')
- `job_id` - UUID работы (опционально)
- `customer_id` - ID клиента (опционально)
- `data` - Дополнительные данные события в формате JSON
- `created_at` - Время создания события

---

## API Endpoints для Rate Me

Все endpoints должны использовать версионирование API: `/api/v1/...`

### 1. GET `/api/v1/jobs/{uuid}`

**Назначение:** Получение информации о работе по UUID.

**Параметры:**
- `uuid` (path parameter) - UUID работы из Workiz

**Логика работы:**
1. Поиск работы в PostgreSQL по `uuid`
2. Если работа найдена → возврат данных
3. Если работа не найдена:
   - Запрос к Workiz API: `GET /job/get/{uuid}/`
   - Если данные получены → создание записи в PostgreSQL
   - Возврат данных Rate Me

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
    ],
    // ... другие поля из Workiz API
  }
}
```

**Ошибки:**
- `404 Not Found` - работа не найдена ни в БД, ни в Workiz
- `500 Internal Server Error` - внутренняя ошибка сервера

**Требования:**
- Аутентификация через API ключ (header `Authorization: Bearer {apiKey}` или `X-API-Key: {apiKey}`)
- Rate limiting: рекомендуемый лимит 100 запросов в минуту на API ключ
- Логирование всех запросов

---

### 2. GET `/api/v1/jobs/serial/{serialId}`

**Назначение:** Получение информации о работе по SerialId.

**Параметры:**
- `serialId` (path parameter) - SerialId работы из Workiz

**Логика работы:**
1. Поиск работы в PostgreSQL по `serial_id`
2. Если работа найдена → возврат данных
3. Если работа не найдена → возврат 404

**Ответ (200 OK):**
Аналогично `GET /api/v1/jobs/{uuid}`

**Ошибки:**
- `404 Not Found` - работа не найдена
- `500 Internal Server Error` - внутренняя ошибка сервера

**Примечания:**
- Если работы нет в БД, не делать запрос к Workiz (Rate Me может запросить по UUID, если знает UUID)
- SerialId может быть не уникальным в некоторых случаях

---

### 3. GET `/api/v1/job-tokens/{jobUuid}`

**Назначение:** Получение токена для работы. Если токена нет, создает новый.

**Параметры:**
- `jobUuid` (path parameter) - UUID работы

**Логика работы:**
1. Поиск токена в таблице `job_tokens` по `job_uuid`
2. Если токен найден:
   - Проверка срока действия (`expires_at`)
   - Если токен не истек → возврат токена
   - Если токен истек → обновление статуса на 'expired', переход к шагу 3
3. Если токена нет или он истек:
   - Получение данных о работе (через `GET /api/v1/jobs/{jobUuid}` или прямой запрос к БД)
   - Если работы нет → возврат 404
   - Создание нового токена:
     - Генерация JWT токена (использовать тот же алгоритм и secret, что и Rate Me)
     - Расчет `expires_at` (например, через 7 дней после создания)
     - Сохранение в таблицу `job_tokens`
   - Возврат токена Rate Me

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
    "createdAt": "2025-12-09T10:00:00Z",
    "expiresAt": "2025-12-16T10:00:00Z"
  }
}
```

**Ошибки:**
- `404 Not Found` - работа не найдена
- `500 Internal Server Error` - внутренняя ошибка сервера

**Требования:**
- JWT токен должен использовать тот же `JOB_TOKEN_SECRET`, что и Rate Me приложение
- Формат JWT payload:
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
- TTL токена: 7 дней (или настраиваемый параметр)

---

### 4. GET `/api/v1/job-tokens/serial/{serialId}`

**Назначение:** Получение токена для работы по SerialId.

**Параметры:**
- `serialId` (path parameter) - SerialId работы

**Логика работы:**
1. Поиск работы в PostgreSQL по `serial_id`
2. Если работа найдена:
   - Извлечение `uuid` работы
   - Вызов логики из `GET /api/v1/job-tokens/{jobUuid}`
3. Если работа не найдена → возврат 404

**Ответ (200 OK):**
Аналогично `GET /api/v1/job-tokens/{jobUuid}`

**Ошибки:**
- `404 Not Found` - работа не найдена
- `500 Internal Server Error` - внутренняя ошибка сервера

---

### 5. POST `/api/v1/job-tokens` (опционально)

**Назначение:** Создание токена для работы вручную (если требуется).

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

**Ответ (201 Created):**
Аналогично `GET /api/v1/job-tokens/{jobUuid}`

**Ошибки:**
- `400 Bad Request` - невалидные данные
- `409 Conflict` - токен уже существует для этой работы
- `500 Internal Server Error` - внутренняя ошибка сервера

---

### 6. PUT `/api/v1/job-tokens/{tokenId}`

**Назначение:** Обновление статуса токена.

**Параметры:**
- `tokenId` (path parameter) - ID токена (UUID)

**Body:**
```json
{
  "status": "sent",
  "sentVia": "sms",
  "sentAt": "2025-12-09T10:30:00Z"
}
```

**Поля (все опциональны):**
- `status` - новый статус: 'pending', 'sent', 'expired', 'used'
- `sentVia` - способ отправки: 'email', 'sms', 'both'
- `sentAt` - время отправки (ISO timestamp)

**Ответ (200 OK):**
Аналогично `GET /api/v1/job-tokens/{jobUuid}` (обновленный токен)

**Ошибки:**
- `404 Not Found` - токен не найден
- `400 Bad Request` - невалидные данные
- `500 Internal Server Error` - внутренняя ошибка сервера

---

## Логика работы с данными

### Синхронизация данных с Workiz

**Ежедневное обновление (4am):**

1. БД-приложение должно иметь scheduled job (cron), который запускается в 4am ежедневно
2. Задача обновления:
   - Получение списка всех работ из Workiz API (или только измененных за последние 24 часа)
   - Обновление данных в PostgreSQL (обновление полей: статус работы, даты, и т.д.)
   - Сохранение полной истории изменений (опционально, через таблицу `jobs_history`)

**Важные замечания:**

- Изменения статусов работ после обновления НЕ должны влиять на работу Rate Me
- Rate Me использует стабильные поля: UUID, SerialId, customerId, имена, адреса
- Эти поля не изменяются после обновления статусов
- Redis кэш в Rate Me продолжит работать с кэшированными данными
- При следующем запросе Rate Me получит обновленные данные из БД-приложения и обновит кэш

### Создание токенов

**Алгоритм генерации JWT токена:**

1. Получение данных о работе (UUID, customerId)
2. Генерация nonce (случайная строка для предотвращения replay attacks)
3. Создание payload:
   ```json
   {
     "jobId": "M7PEMN",
     "customerId": "2414",
     "issuedAt": 1765250543,
     "expiresAt": 1765855343,
     "nonce": "cglxnsm7n2ksjzorkshww"
   }
   ```
4. Подпись токена с использованием `JOB_TOKEN_SECRET` и алгоритма `HS256`
5. Сохранение токена в таблицу `job_tokens`

**Требования:**

- Использовать тот же `JOB_TOKEN_SECRET`, что и Rate Me приложение (получать из env переменной)
- TTL токена: 7 дней (или настраиваемый параметр)
- Не создавать дубликаты токенов (использовать `ON CONFLICT` или проверку перед созданием)

### Получение работ из Workiz

**При отсутствии работы в БД:**

1. Запрос к Workiz API: `GET /job/get/{uuid}/`
2. Если данные получены:
   - Парсинг ответа Workiz API
   - Сохранение в таблицу работ (или основную таблицу, если она уже существует)
   - Возврат данных Rate Me
3. Если данные не получены (404 или ошибка):
   - Возврат 404 Rate Me

**Формат данных Workiz API:**

Workiz API может возвращать данные в разных форматах:
- Прямой объект: `{ "UUID": "...", "ClientId": ..., ... }`
- Обернутый формат: `{ "flag": true, "data": { ...job details... } }`
- Массив: `[{ "flag": true, "data": { ...job details... } }]`

БД-приложение должно обрабатывать все эти форматы.

---

## Аутентификация и безопасность

### Аутентификация API

**Варианты (выбрать один):**

1. **Bearer Token (рекомендуется):**
   - Header: `Authorization: Bearer {apiKey}`
   - API ключ хранится в переменной окружения `DB_APP_API_KEY`

2. **API Key в заголовке:**
   - Header: `X-API-Key: {apiKey}`
   - API ключ хранится в переменной окружения `DB_APP_API_KEY`

### Rate Limiting

**Рекомендации:**
- Лимит: 100 запросов в минуту на API ключ
- При превышении: HTTP 429 Too Many Requests
- Headers в ответе:
  - `X-RateLimit-Limit: 100`
  - `X-RateLimit-Remaining: 95`
  - `X-RateLimit-Reset: 1702112400`

### Логирование

**Требования:**
- Логировать все запросы от Rate Me (endpoint, метод, API ключ, статус ответа, время выполнения)
- Логировать ошибки (404, 500, network errors)
- Логировать создание токенов
- Не логировать sensitive данные (токены, персональные данные)

---

## Переменные окружения

**Необходимые переменные окружения для БД-приложения:**

```bash
# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# Workiz API
WORKIZ_API_URL=https://api.workiz.com
WORKIZ_API_KEY=your_workiz_api_key

# JWT Token Secret (должен совпадать с Rate Me приложением)
JOB_TOKEN_SECRET=your-secret-key

# API ключ для аутентификации Rate Me
DB_APP_API_KEY=your-api-key

# Rate Limiting (опционально)
RATE_LIMIT_PER_MINUTE=100

# JWT Token TTL (опционально, в днях)
JOB_TOKEN_TTL_DAYS=7
```

---

## Примеры использования API

### Пример 1: Получение работы по UUID

**Запрос:**
```bash
curl -X GET "https://db-app.example.com/api/v1/jobs/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

**Ответ:**
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

### Пример 2: Получение токена для работы

**Запрос:**
```bash
curl -X GET "https://db-app.example.com/api/v1/job-tokens/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

**Ответ:**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqb2JJZCI6Ik03UEVOTSIsImN1c3RvbWVySWQiOiIyNDE0IiwiaXNzdWVkQXQiOjE3NjUyNTA1NDMsImV4cGlyZXNBdCI6MTc2NTg1NTM0Mywibm9uY2UiOiJjZ2x4bnNtN24ya3Nqem9ya3Nod3ciLCJpYXQiOjE3NjUyNTA1NDMsImV4cCI6MTc2NTg1NTM0M30.NGOwqg8s1SB_iN_ALLQ3oPNNZ_omAw3Oh8qNLfPFR5s",
    "jobId": "M7PEMN",
    "jobSerialId": 12345,
    "customerId": "2414",
    "status": "pending",
    "createdAt": "2025-12-09T10:00:00Z",
    "expiresAt": "2025-12-16T10:00:00Z"
  }
}
```

### Пример 3: Обновление статуса токена

**Запрос:**
```bash
curl -X PUT "https://db-app.example.com/api/v1/job-tokens/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "sent",
    "sentVia": "sms",
    "sentAt": "2025-12-09T10:30:00Z"
  }'
```

---

## Дополнительные требования

1. **Graceful Degradation:**
   - Если Workiz API недоступен, БД-приложение должно возвращать данные из PostgreSQL
   - Если PostgreSQL недоступен, БД-приложение должно возвращать 503 Service Unavailable

2. **Мониторинг:**
   - Логирование метрик (время ответа, количество запросов, ошибки)
   - Health check endpoint: `GET /health`

3. **Документация:**
   - OpenAPI/Swagger документация для всех endpoints
   - Примеры использования в README

4. **Тестирование:**
   - Unit тесты для логики создания токенов
   - Integration тесты для API endpoints
   - Тесты для синхронизации с Workiz

---

## Контакты

Если есть вопросы по требованиям, обращайтесь к команде Rate Me разработки.

---

**Дата создания:** 2025-12-09  
**Версия:** 1.0

