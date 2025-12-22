# Руководство по миграции модуля метрик в rely-lead-processor

## Обзор

Это руководство описывает процесс переноса функционала синхронизации метрик из `abc-metrics` в `rely-lead-processor` в виде изолированного модуля.

---

## Этап 1: Подготовка (выполнено)

✅ Создан API-слой для БД в `abc-metrics`
✅ Создан HTTP клиент `AbcMetricsClient` для работы с API
✅ Документированы принципы разделения функционала

---

## Этап 2: Создание модуля метрик в rely-lead-processor

### Шаг 1: Создать структуру директорий

В проекте `rely-lead-processor` создать:

```
src/metrics/
├── services/
│   ├── abc-metrics-client.ts
│   ├── svc-workiz-jobs.ts
│   ├── svc-workiz-leads.ts
│   ├── svc-workiz-payments.ts
│   ├── svc-elocal-calls.ts
│   ├── csv.service.ts
│   └── workiz.service.ts
├── routes.ts
├── scheduler.ts
└── index.ts
```

### Шаг 2: Скопировать файлы из шаблона

Скопировать файлы из `abc-metrics/metrics-module-template/src/metrics/` в `rely-lead-processor/src/metrics/`.

### Шаг 3: Основные изменения в сервисах

Все сервисы должны быть адаптированы:

1. **Убрать импорты БД:**
   ```typescript
   // УДАЛИТЬ:
   import pool from '../db/connection';
   ```

2. **Добавить AbcMetricsClient:**
   ```typescript
   // ДОБАВИТЬ:
   import { AbcMetricsClient } from './abc-metrics-client';
   
   private abcMetricsClient: AbcMetricsClient;
   
   constructor() {
     // ...
     this.abcMetricsClient = new AbcMetricsClient();
   }
   ```

3. **Заменить методы сохранения:**
   ```typescript
   // БЫЛО:
   async saveJobs(jobs: WorkizJob[]): Promise<void> {
     const client = await pool.connect();
     // ... SQL запросы
   }
   
   // СТАЛО:
   async saveJobs(jobs: WorkizJob[]): Promise<void> {
     const apiJobs = jobs.map(job => this.convertToApiFormat(job));
     await this.abcMetricsClient.saveJobs(apiJobs);
   }
   ```

---

## Этап 3: Интеграция модуля

### Шаг 1: Создать index.ts

```typescript
// src/metrics/index.ts
import { Router } from 'express';
import metricsRoutes from './routes';
import { MetricsScheduler } from './scheduler';

export interface MetricsModule {
  routes: Router;
  scheduler: MetricsScheduler;
}

const routes = metricsRoutes;
const scheduler = new MetricsScheduler();

export default {
  routes,
  scheduler,
} as MetricsModule;
```

### Шаг 2: Интегрировать в главное приложение

В `src/app.ts` или `src/index.ts`:

```typescript
import metricsModule from './metrics';

// Интеграция routes
app.use('/api/metrics', metricsModule.routes);

// Запуск планировщика
metricsModule.scheduler.start();
```

---

## Этап 4: Переменные окружения

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
```

---

## Этап 5: Тестирование

1. Проверить, что модуль не конфликтует с существующим функционалом
2. Протестировать синхронизацию данных
3. Проверить, что данные сохраняются через API

---

## Важные замечания

1. **Изоляция:** Все файлы метрик должны быть в `src/metrics/`
2. **Префиксы API:** Все endpoints должны использовать `/api/metrics/*`
3. **Нет прямых подключений к БД:** Все операции через `AbcMetricsClient`
4. **Идемпотентность:** Все операции UPSERT - можно запускать хоть каждый час

---

## Следующие шаги

После создания модуля в `rely-lead-processor`:

1. Удалить функционал синхронизации из `abc-metrics` (оставить только API и БД)
2. Обновить документацию
3. Протестировать полный цикл синхронизации



