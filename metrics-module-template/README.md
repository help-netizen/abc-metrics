# Metrics Module для rely-lead-processor

Этот модуль содержит функционал синхронизации метрик из внешних источников (Workiz, Elocal.com) в `abc-metrics` через API.

## Структура модуля

```
src/metrics/
├── services/
│   ├── abc-metrics-client.ts      # HTTP клиент для API abc-metrics
│   ├── svc-workiz-jobs.ts          # Синхронизация Jobs из Workiz
│   ├── svc-workiz-leads.ts         # Синхронизация Leads из Workiz
│   ├── svc-workiz-payments.ts      # Синхронизация Payments из Workiz
│   ├── svc-elocal-calls.ts         # Синхронизация Calls из Elocal.com
│   └── csv.service.ts              # Обработка CSV файлов
├── routes.ts                       # API routes (префикс /api/metrics/)
├── scheduler.ts                    # Планировщик задач
└── index.ts                        # Экспорт модуля для интеграции
```

## Принципы изоляции

1. **Все файлы метрик в `src/metrics/`** - никаких файлов вне этой директории
2. **API endpoints с префиксом `/api/metrics/*`** - уникальные префиксы
3. **Нет конфликтов с существующим функционалом** - отдельные имена классов, функций
4. **Нет прямых подключений к БД** - все операции через `AbcMetricsClient`

## Установка

1. Скопировать все файлы из `metrics-module-template/src/metrics/` в `rely-lead-processor/src/metrics/`

2. Установить зависимости (если еще не установлены):
   ```bash
   npm install axios puppeteer csv-parse node-cron
   npm install --save-dev @types/node-cron
   ```

3. Настроить переменные окружения (см. ниже)

## Переменные окружения

Добавить в `.env` или secrets:

```env
# ABC Metrics API
ABC_METRICS_API_URL=https://abc-metrics.fly.dev
ABC_METRICS_API_KEY=your-api-key

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
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

## Интеграция в главное приложение

В главном файле приложения (например, `src/app.ts` или `src/index.ts`):

```typescript
import metricsModule from './metrics';

// Интеграция routes
app.use('/api/metrics', metricsModule.routes);

// Запуск планировщика
metricsModule.scheduler.start();
```

## API Endpoints

### Тестовые endpoints (без сохранения)

- `GET /api/metrics/test/workiz/jobs` - Получить Jobs из Workiz
- `GET /api/metrics/test/workiz/leads` - Получить Leads из Workiz
- `GET /api/metrics/test/workiz/payments` - Получить Payments из Workiz
- `GET /api/metrics/test/elocal/calls` - Получить Calls из Elocal.com

### Endpoints для ручной синхронизации

- `POST /api/metrics/sync/workiz/jobs` - Запустить синхронизацию Jobs
- `POST /api/metrics/sync/workiz/leads` - Запустить синхронизацию Leads
- `POST /api/metrics/sync/workiz/payments` - Запустить синхронизацию Payments
- `POST /api/metrics/sync/elocal/calls` - Запустить синхронизацию Calls
- `POST /api/metrics/process/csv` - Обработать CSV файлы

## Планировщик задач

Планировщик автоматически запускает синхронизацию:

- **Workiz Jobs**: каждый час в 0 минут
- **Workiz Leads**: каждый час в 5 минут
- **Workiz Payments**: каждый час в 10 минут
- **Elocal Calls**: каждый день в 4:00 AM (последние 30 дней, исключая текущий день)
- **CSV Processing**: каждые 6 часов
- **Daily Aggregation**: каждый день в 1:00 AM (триггер в abc-metrics)
- **Monthly Aggregation**: 1-го числа каждого месяца в 2:00 AM (триггер в abc-metrics)

## Идемпотентность

Все операции синхронизации используют UPSERT (ON CONFLICT DO UPDATE), что позволяет:
- Запускать синхронизацию хоть каждый час без дубликатов
- Данные всегда актуальны
- Не бояться повторных запусков

## Логирование

Все сервисы используют подробное логирование с префиксами:
- `[METRICS]` - общие логи модуля
- `[PAGINATION]` - логи пагинации
- `[AUTH]` - логи аутентификации
- `[FETCH]` - логи загрузки данных
- `[PARSE]` - логи парсинга
- `[BROWSER]` - логи браузера (Puppeteer)

## Обработка ошибок

- Автоматические повторы при сетевых ошибках (5xx)
- Логирование всех ошибок с контекстом
- Graceful degradation - модуль не падает при ошибках одного источника

## Тестирование

Для тестирования используйте тестовые endpoints:

```bash
# Тест получения Jobs
curl http://localhost:3000/api/metrics/test/workiz/jobs?start_date=2025-01-01

# Тест синхронизации Jobs
curl -X POST http://localhost:3000/api/metrics/sync/workiz/jobs
```

## Примечания

- Модуль полностью изолирован и не конфликтует с существующим функционалом
- Все данные сохраняются в `abc-metrics` через API
- Нет прямых подключений к базе данных
- Модуль можно легко отключить, просто не интегрируя его в главное приложение



