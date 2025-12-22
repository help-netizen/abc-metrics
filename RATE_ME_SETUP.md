# Инструкция по настройке Rate Me API

## Быстрая настройка

### Шаг 1: Установка секретов на сервере

```bash
# 1. JWT Token Secret - КРИТИЧЕСКИ ВАЖНО!
# Этот секрет ДОЛЖЕН совпадать с JOB_TOKEN_SECRET в Rate Me приложении
# Используется для подписи и валидации JWT токенов
flyctl secrets set JOB_TOKEN_SECRET="your-secret-key-must-match-rate-me-app" -a abc-metrics

# 2. API ключ для аутентификации Rate Me сервиса
# Может быть любым надежным ключом, используется только для аутентификации запросов
flyctl secrets set DB_APP_API_KEY="your-api-key-for-rate-me-service" -a abc-metrics

# 3. Опционально: настройка лимитов
flyctl secrets set RATE_LIMIT_PER_MINUTE="100" -a abc-metrics
flyctl secrets set JOB_TOKEN_TTL_DAYS="7" -a abc-metrics
```

### Шаг 2: Деплой

```bash
flyctl deploy -a abc-metrics
```

### Шаг 3: Проверка

```bash
# Проверка доступности
curl -X GET "https://abc-metrics.fly.dev/api/health"

# Проверка Rate Me API (замените your-api-key на реальный ключ)
curl -X GET "https://abc-metrics.fly.dev/api/v1/jobs/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

---

## Информация для настройки Rate Me сервиса

### Переменные окружения, которые нужно настроить в Rate Me приложении:

```bash
# URL API для получения данных о работах и токенах
RATE_ME_API_URL=https://abc-metrics.fly.dev/api/v1

# API ключ для аутентификации (тот же что DB_APP_API_KEY выше)
RATE_ME_API_KEY=your-api-key-for-rate-me-service

# JWT Secret (тот же что JOB_TOKEN_SECRET выше - ОБЯЗАТЕЛЬНО должен совпадать!)
JOB_TOKEN_SECRET=your-secret-key-must-match-rate-me-app
```

### Пример настройки в Rate Me приложении:

**Node.js/Express:**
```javascript
const RATE_ME_API_URL = process.env.RATE_ME_API_URL || 'https://abc-metrics.fly.dev/api/v1';
const RATE_ME_API_KEY = process.env.RATE_ME_API_KEY;
const JOB_TOKEN_SECRET = process.env.JOB_TOKEN_SECRET; // Должен совпадать с JOB_TOKEN_SECRET на сервере

// Пример запроса к API
const response = await fetch(`${RATE_ME_API_URL}/jobs/${jobUuid}`, {
  headers: {
    'Authorization': `Bearer ${RATE_ME_API_KEY}`
  }
});
```

**Python:**
```python
import os
import requests

RATE_ME_API_URL = os.getenv('RATE_ME_API_URL', 'https://abc-metrics.fly.dev/api/v1')
RATE_ME_API_KEY = os.getenv('RATE_ME_API_KEY')
JOB_TOKEN_SECRET = os.getenv('JOB_TOKEN_SECRET')  # Должен совпадать с JOB_TOKEN_SECRET на сервере

# Пример запроса
response = requests.get(
    f'{RATE_ME_API_URL}/jobs/{job_uuid}',
    headers={'Authorization': f'Bearer {RATE_ME_API_KEY}'}
)
```

---

## Доступные Endpoints

Все endpoints доступны по адресу: `https://abc-metrics.fly.dev/api/v1/...`

### Основные endpoints:

1. `GET /jobs/{uuid}` - Получить работу по UUID
2. `GET /jobs/serial/{serialId}` - Получить работу по SerialId
3. `GET /job-tokens/{jobUuid}` - Получить или создать токен для работы
4. `GET /job-tokens/serial/{serialId}` - Получить токен по SerialId
5. `POST /job-tokens` - Создать токен вручную
6. `PUT /job-tokens/{tokenId}` - Обновить статус токена

**Полная документация:** см. `RATE_ME_API_DOCS.md`

---

## Защита токенов

✅ **Таблица `job_tokens` полностью независима от `fact_jobs`:**
- Нет FOREIGN KEY constraint с CASCADE DELETE
- Токены защищены от случайного удаления при синхронизации
- Связь только логическая через `job_uuid`
- Синхронизация или изменения в `fact_jobs` не затрагивают токены

---

## Примеры использования

### 1. Получить работу по UUID:

```bash
curl -X GET "https://abc-metrics.fly.dev/api/v1/jobs/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

### 2. Получить токен для работы:

```bash
curl -X GET "https://abc-metrics.fly.dev/api/v1/job-tokens/M7PEMN" \
  -H "Authorization: Bearer your-api-key"
```

### 3. Обновить статус токена после отправки:

```bash
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

## Проверка работоспособности

### 1. Проверить создание таблиц:

```bash
flyctl ssh console -a abc-metrics
psql $DATABASE_URL -c "\d job_tokens"
```

Должна отображаться таблица `job_tokens` **без** FOREIGN KEY constraint.

### 2. Проверить API endpoints:

```bash
# Health check
curl https://abc-metrics.fly.dev/api/health

# Проверка аутентификации (должен вернуть 401 без ключа)
curl https://abc-metrics.fly.dev/api/v1/jobs/test

# Проверка с ключом (должен вернуть 404 или данные, но не 401)
curl -H "Authorization: Bearer your-api-key" \
  https://abc-metrics.fly.dev/api/v1/jobs/test
```

---

## Troubleshooting

### Ошибка "JOB_TOKEN_SECRET is not configured"

**Решение:** Установите переменную окружения:
```bash
flyctl secrets set JOB_TOKEN_SECRET="your-secret" -a abc-metrics
```

### Ошибка "Unauthorized" при запросах

**Решение:** 
1. Проверьте что `DB_APP_API_KEY` установлен на сервере
2. Проверьте что используете правильный ключ в заголовке `Authorization: Bearer {key}`

### Токены не сохраняются

**Решение:** 
1. Проверьте логи: `flyctl logs -a abc-metrics | grep -i token`
2. Убедитесь что таблица `job_tokens` создана (миграция прошла успешно)

### Ошибка "FOREIGN KEY constraint violation"

**Решение:** Миграция автоматически удаляет FOREIGN KEY. Если ошибка сохраняется, проверьте что миграция выполнилась:
```bash
flyctl logs -a abc-metrics | grep -i "Removing FOREIGN KEY"
```

---

## Важные замечания

1. **JOB_TOKEN_SECRET** - должен быть одинаковым в обоих приложениях (abc-metrics и Rate Me)
2. **API ключ** - используется только для аутентификации, может быть любым надежным ключом
3. **Токены защищены** - таблица `job_tokens` не зависит от изменений в `fact_jobs`
4. **Rate Limiting** - по умолчанию 100 запросов в минуту, настраивается через `RATE_LIMIT_PER_MINUTE`

---

**Дата создания:** 2025-12-10  
**Версия:** 1.0



