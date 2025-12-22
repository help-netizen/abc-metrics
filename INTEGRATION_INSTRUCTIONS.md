# Инструкции по интеграции модуля метрик в rely-lead-processor

## Шаг 1: Копирование модуля

### Вариант A: Использование скрипта (рекомендуется)

```bash
cd /Users/rgareev91/Downloads/abc-metrics
chmod +x install-metrics-module.sh
./install-metrics-module.sh /path/to/rely-lead-processor
```

### Вариант B: Ручное копирование

```bash
# Перейти в директорию abc-metrics
cd /Users/rgareev91/Downloads/abc-metrics

# Скопировать модуль в rely-lead-processor
cp -r metrics-module-template/src/metrics /path/to/rely-lead-processor/src/
```

## Шаг 2: Установка зависимостей

Перейдите в директорию `rely-lead-processor` и установите необходимые зависимости:

```bash
cd /path/to/rely-lead-processor
npm install axios puppeteer csv-parse node-cron
npm install --save-dev @types/node-cron
```

## Шаг 3: Интеграция в главное приложение

### Найти главный файл приложения

Обычно это один из файлов:
- `src/app.ts`
- `src/index.ts`
- `src/server.ts`
- `src/main.ts`

### Добавить импорт и интеграцию

Добавьте в начало файла (после других импортов):

```typescript
import metricsModule from './metrics';
```

Добавьте интеграцию routes (после создания app/express instance):

```typescript
// Интеграция routes модуля метрик
app.use('/api/metrics', metricsModule.routes);
```

Добавьте запуск планировщика (после запуска сервера):

```typescript
// Запуск планировщика метрик
metricsModule.scheduler.start();
```

### Пример полной интеграции

```typescript
import express from 'express';
import metricsModule from './metrics'; // <-- Добавить эту строку

const app = express();

// ... другие middleware и routes ...

// Интеграция routes модуля метрик
app.use('/api/metrics', metricsModule.routes); // <-- Добавить эту строку

// ... остальной код ...

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Запуск планировщика метрик
  metricsModule.scheduler.start(); // <-- Добавить эту строку
});
```

## Шаг 4: Настройка переменных окружения

Создайте или обновите файл `.env` в корне проекта `rely-lead-processor`:

```env
# ABC Metrics API
ABC_METRICS_API_URL=https://abc-metrics.fly.dev
ABC_METRICS_API_KEY=your-api-key-here

# Workiz API
WORKIZ_API_KEY=your-workiz-api-key
WORKIZ_API_SECRET=your-workiz-api-secret
WORKIZ_API_URL=https://api.workiz.com

# Elocal.com
ELOCAL_USERNAME=help@bostonmasters.com
ELOCAL_PASSWORD=your-password-here

# CSV Processing (опционально)
CSV_DIRECTORY=./csv-data

# Puppeteer (опционально, только если нужен кастомный путь)
# PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

### Получение API ключа для abc-metrics

API ключ можно получить из secrets приложения abc-metrics:

```bash
flyctl secrets list -a abc-metrics | grep DB_API_KEY
```

Или установить новый:

```bash
flyctl secrets set DB_API_KEY="your-secure-api-key" -a abc-metrics
```

## Шаг 5: Проверка интеграции

### 1. Проверить структуру файлов

```bash
cd /path/to/rely-lead-processor
ls -la src/metrics/
```

Должны быть видны:
- `services/` (директория)
- `routes.ts`
- `scheduler.ts`
- `index.ts`

### 2. Проверить компиляцию TypeScript

```bash
npm run build
# или
npx tsc --noEmit
```

### 3. Запустить приложение

```bash
npm start
# или
npm run dev
```

### 4. Протестировать endpoints

```bash
# Тест получения Jobs из Workiz
curl http://localhost:3000/api/metrics/test/workiz/jobs?start_date=2025-01-01

# Тест синхронизации Jobs
curl -X POST http://localhost:3000/api/metrics/sync/workiz/jobs
```

## Шаг 6: Проверка работы планировщика

После запуска приложения в логах должны появиться сообщения:

```
[METRICS] Starting metrics scheduler...
[METRICS] Metrics scheduler started successfully
```

Планировщик автоматически запустит синхронизацию по расписанию:
- Workiz Jobs: каждый час в 0 минут
- Workiz Leads: каждый час в 5 минут
- Workiz Payments: каждый час в 10 минут
- Elocal Calls: каждый день в 4:00 AM

## Устранение проблем

### Ошибка: Cannot find module './metrics'

**Решение:** Убедитесь, что модуль скопирован в `src/metrics/` и путь импорта правильный.

### Ошибка: Module not found: 'axios'

**Решение:** Установите зависимости: `npm install axios puppeteer csv-parse node-cron`

### Ошибка: ABC_METRICS_API_KEY is required

**Решение:** Убедитесь, что переменные окружения установлены в `.env` или в secrets (для production).

### Ошибка: 401 Unauthorized при вызове API

**Решение:** Проверьте правильность `ABC_METRICS_API_KEY` и `ABC_METRICS_API_URL`.

## Проверка изоляции

Убедитесь, что модуль не конфликтует с существующим функционалом:

1. Все endpoints модуля используют префикс `/api/metrics/*`
2. Все файлы находятся в `src/metrics/`
3. Нет конфликтов в именах классов/функций

## Дополнительная информация

- Полная документация модуля: `src/metrics/README.md` (после копирования)
- Руководство по миграции: `MIGRATION_GUIDE.md`
- Принципы архитектуры: `docs/architecture-principles.md`



