# Шаблон модуля метрик для rely-lead-processor

Этот документ описывает структуру модуля метрик, который должен быть создан в проекте `rely-lead-processor`.

**Важно:** Все файлы должны быть созданы в директории `src/metrics/` в проекте `rely-lead-processor`.

---

## Структура модуля

```
src/metrics/
├── services/
│   ├── abc-metrics-client.ts      # HTTP клиент для API abc-metrics
│   ├── svc-workiz-jobs.ts          # Синхронизация Jobs из Workiz
│   ├── svc-workiz-leads.ts        # Синхронизация Leads из Workiz
│   ├── svc-workiz-payments.ts     # Синхронизация Payments из Workiz
│   ├── svc-elocal-calls.ts        # Синхронизация Calls из Elocal.com
│   ├── csv.service.ts             # Обработка CSV файлов
│   └── workiz.service.ts          # Базовый сервис Workiz API
├── routes.ts                       # API routes (префикс /api/metrics/)
├── scheduler.ts                    # Планировщик задач
└── index.ts                        # Экспорт модуля для интеграции
```

---

## Принципы изоляции

1. **Все файлы метрик в `src/metrics/`** - никаких файлов вне этой директории
2. **API endpoints с префиксом `/api/metrics/*`** - уникальные префиксы
3. **Нет конфликтов с существующим функционалом** - отдельные имена классов, функций
4. **Интеграция через `index.ts`** - простое подключение модуля

---

## Интеграция в главное приложение

В главном файле приложения (например, `src/app.ts` или `src/index.ts`):

```typescript
import metricsModule from './metrics';

// Интеграция routes
app.use('/api/metrics', metricsModule.routes);

// Запуск планировщика
metricsModule.scheduler.start();
```

---

## Переменные окружения

Модуль метрик требует следующие переменные окружения:

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
```

---

## Следующие шаги

1. Скопировать файлы из `abc-metrics/src/services/` в `rely-lead-processor/src/metrics/services/`
2. Обновить импорты (убрать `../db/connection`, использовать `AbcMetricsClient`)
3. Создать `abc-metrics-client.ts` для работы с API
4. Создать `routes.ts` с префиксом `/api/metrics/`
5. Создать `scheduler.ts` для планировщика задач
6. Создать `index.ts` для экспорта модуля
7. Интегрировать модуль в главное приложение



