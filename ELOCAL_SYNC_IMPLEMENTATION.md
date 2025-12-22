# Детали реализации синхронизации Elocal Calls

## Обзор

Синхронизация данных о звонках из elocal.com реализована через автоматизацию браузера с помощью Puppeteer, так как elocal.com не предоставляет публичного API.

---

## Архитектура

### Сервис: `SvcElocalCalls`

**Файл:** `src/services/svc-elocal-calls.ts`

**Основные компоненты:**
- Puppeteer для автоматизации браузера
- Веб-авторизация через форму логина
- Загрузка CSV через export URL
- Парсинг CSV и нормализация данных
- Сохранение в БД с upsert логикой

---

## Способы запуска синхронизации

### 1. Автоматическая синхронизация (по расписанию)

**Расписание:** Каждый день в 4:00 AM

**Реализация:** `src/scheduler.ts`

```typescript
// Sync Elocal calls every day at 4 AM
cron.schedule('0 4 * * *', async () => {
  console.log('Running elocal calls sync...');
  try {
    await this.svcElocalCalls.syncCalls();
  } catch (error) {
    console.error('Error in elocal calls sync:', error);
  }
});
```

**Период синхронизации:** Последние 30 дней (исключая текущий день)

---

### 2. Ручной запуск через скрипт

**Файл:** `sync-elocal-calls.ts`

**Использование:**
```bash
npx ts-node sync-elocal-calls.ts
```

**Код:**
```typescript
import { SvcElocalCalls } from './src/services/svc-elocal-calls';

const svcElocalCalls = new SvcElocalCalls();
await svcElocalCalls.syncCalls();
await svcElocalCalls.closeBrowser();
```

---

### 3. Через REST API endpoint

**Endpoint:** `POST /api/test/elocal/calls/sync`

**Использование:**
```bash
# С параметрами дат
curl -X POST http://localhost:3001/api/test/elocal/calls/sync \
  -H "Content-Type: application/json" \
  -d '{"start_date": "2024-11-01", "end_date": "2024-11-30"}'

# Без параметров (использует дефолтные: последние 30 дней)
curl -X POST http://localhost:3001/api/test/elocal/calls/sync
```

**Реализация:** `src/api/routes.ts:900-940`

---

### 4. Программный вызов

```typescript
import { SvcElocalCalls } from './src/services/svc-elocal-calls';

const svcElocalCalls = new SvcElocalCalls();

try {
  // Полная синхронизация (последние 30 дней)
  await svcElocalCalls.syncCalls();
  
  // Или загрузка CSV для конкретного периода
  const csvContent = await svcElocalCalls.fetchCallsCsv('2024-11-01', '2024-11-30');
  const calls = svcElocalCalls.parseCallsCsv(csvContent);
  await svcElocalCalls.saveCalls(calls);
} finally {
  await svcElocalCalls.closeBrowser();
}
```

---

## Детали реализации методов

### 1. `syncCalls()` - Главный метод синхронизации

**Описание:** Выполняет полный цикл синхронизации

**Алгоритм:**
1. Вычисляет период: последние 30 дней (исключая сегодня)
2. Вызывает `fetchCallsCsv()` для загрузки CSV
3. Вызывает `parseCallsCsv()` для парсинга
4. Вызывает `saveCalls()` для сохранения в БД

**Код:**
```typescript
async syncCalls(): Promise<void> {
  // Calculate date range: last 30 days, excluding today
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const endDate = yesterday.toISOString().split('T')[0];
  
  const startDateObj = new Date(yesterday);
  startDateObj.setDate(startDateObj.getDate() - 29); // 30 days total
  const startDate = startDateObj.toISOString().split('T')[0];

  // Step 1: Fetch CSV
  const csvContent = await this.fetchCallsCsv(startDate, endDate);
  
  // Step 2: Parse CSV
  const calls = this.parseCallsCsv(csvContent);
  
  // Step 3: Save to database
  await this.saveCalls(calls);
}
```

---

### 2. `authenticate(page: Page)` - Аутентификация

**Описание:** Авторизуется на elocal.com через веб-форму

**Процесс:**
1. Переходит на страницу логина с username в URL
2. Ищет поле для пароля
3. Вводит пароль
4. Отправляет форму (Enter или кнопка Submit)
5. Проверяет успешность по URL и содержимому страницы

**URL логина:**
```
https://www.elocal.com/business_users/login?manual_login=true&username=help%40bostonmasters.com
```

**Ключевые моменты:**
- Использует Puppeteer для автоматизации
- Обрабатывает навигацию после логина
- Проверяет, не залогинен ли уже пользователь
- Таймауты: 120 секунд для навигации

---

### 3. `fetchCallsCsv(startDate, endDate)` - Загрузка CSV

**Описание:** Загружает CSV файл со звонками через export URL

**Процесс:**
1. Создает новую страницу в браузере
2. Вызывает `authenticate()` для авторизации
3. Формирует export URL:
   ```
   https://www.elocal.com/business_users/calls/export/11809158?start=YYYY-MM-DD&end=YYYY-MM-DD
   ```
4. Использует `page.evaluate()` с `fetch()` API для загрузки CSV
5. Проверяет, что получен CSV (не HTML)
6. Возвращает содержимое CSV

**Ключевые моменты:**
- Использует `fetch()` внутри браузера (с cookies)
- `credentials: 'include'` для передачи cookies авторизации
- Проверка на HTML (login page) вместо CSV
- Логирование статистики CSV

---

### 4. `parseCallsCsv(csvContent)` - Парсинг CSV

**Описание:** Парсит CSV и нормализует данные

**Маппинг полей:**

| CSV поле (elocal.com) | Поле БД | Обработка |
|----------------------|---------|-----------|
| `Unique ID` | `call_id` | Уникальный ключ |
| `Time` | `date` | Парсится в DATE (YYYY-MM-DD) |
| `Duration` | `duration` | Конвертируется из MM:SS в секунды |
| `Status` | `call_type` | Сохраняется как есть |
| - | `source` | Всегда 'elocals' |

**Обработка данных:**

**Duration:**
- Формат: `"02:23"` (минуты:секунды)
- Конвертация: `(2 * 60) + 23 = 143 секунды`

**Date:**
- Формат: `"2025-12-05 10:21:17 -0500"`
- Извлекается дата: `"2025-12-05"`

**Пример парсинга:**
```typescript
// Input CSV row:
{
  'Unique ID': '32420419',
  'Time': '2025-12-05 10:21:17 -0500',
  'Duration': '02:23',
  'Status': 'Request Credit'
}

// Output ElocalCall:
{
  call_id: '32420419',
  date: '2025-12-05',
  duration: 143,  // 2*60 + 23
  call_type: 'Request Credit',
  source: 'elocals'
}
```

---

### 5. `saveCalls(calls)` - Сохранение в БД

**Описание:** Сохраняет звонки в таблицу `calls` с upsert логикой

**Upsert запрос:**
```sql
INSERT INTO calls (call_id, date, duration, call_type, source)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (call_id) 
DO UPDATE SET 
  date = EXCLUDED.date,
  duration = EXCLUDED.duration,
  call_type = EXCLUDED.call_type,
  source = EXCLUDED.source,
  updated_at = CURRENT_TIMESTAMP
```

**Особенности:**
- Транзакция (BEGIN/COMMIT)
- Обработка ошибок для каждой записи
- Логирование прогресса
- Статистика: saved/skipped/errors

**Идемпотентность:**
- Можно запускать хоть каждый час
- Дубликаты не создаются (обновление существующих)
- Данные всегда актуальны

---

## Конфигурация

### Переменные окружения

```env
ELOCAL_USERNAME=help@bostonmasters.com
ELOCAL_PASSWORD=Alga!B@r2
```

### Хардкод значения

```typescript
const ELOCAL_BUSINESS_ID = '11809158';  // ID бизнеса в elocal.com
```

---

## Структура данных

### Интерфейс ElocalCall

```typescript
interface ElocalCall {
  call_id: string;        // Unique ID из CSV (внешний ключ)
  date: string;           // Дата в формате YYYY-MM-DD
  duration?: number;      // Длительность в секундах
  call_type?: string;     // Статус звонка
  source: string;         // Всегда 'elocals'
}
```

### Таблица БД: `calls`

```sql
CREATE TABLE calls (
  id SERIAL PRIMARY KEY,
  call_id VARCHAR(255) UNIQUE NOT NULL,  -- Внешний ключ для upsert
  date DATE NOT NULL,
  duration INTEGER,
  call_type VARCHAR(100),
  source VARCHAR(100) NOT NULL DEFAULT 'elocals',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Примеры использования

### Пример 1: Полная синхронизация

```typescript
import { SvcElocalCalls } from './src/services/svc-elocal-calls';

const svc = new SvcElocalCalls();
try {
  await svc.syncCalls();  // Автоматически: последние 30 дней
} finally {
  await svc.closeBrowser();
}
```

### Пример 2: Синхронизация за конкретный период

```typescript
const svc = new SvcElocalCalls();
try {
  const csv = await svc.fetchCallsCsv('2024-11-01', '2024-11-30');
  const calls = svc.parseCallsCsv(csv);
  await svc.saveCalls(calls);
} finally {
  await svc.closeBrowser();
}
```

### Пример 3: Только загрузка CSV (без сохранения)

```typescript
const svc = new SvcElocalCalls();
try {
  const csv = await svc.fetchCallsCsv('2024-11-01', '2024-11-30');
  console.log('CSV content:', csv);
} finally {
  await svc.closeBrowser();
}
```

---

## Логирование

Сервис использует детальное логирование с префиксами:

- `[AUTH]` - аутентификация
- `[FETCH]` - загрузка CSV
- `[PARSE]` - парсинг CSV
- `[SAVE]` - сохранение в БД
- `[START]`, `[STEP 1]`, `[STEP 2]`, `[STEP 3]` - этапы синхронизации

**Пример лога:**
```
[START] Elocal calls sync: start=2025-11-08, end=2025-12-07
[STEP 1] Fetching CSV from elocal.com...
[AUTH] Authenticating with elocal.com using Puppeteer...
[AUTH] Authentication successful (took 62.89s)
[FETCH] Received CSV: 47805 bytes (46.68 KB), ~167 lines
[STEP 2] Parsing CSV content...
[PARSE] Parsed 165 calls from 165 CSV rows
[STEP 3] Saving 165 calls to database...
[SAVE] Calls save summary: 165 saved, 0 skipped
```

---

## Обработка ошибок

### Типичные ошибки:

1. **Таймаут запуска браузера**
   - Решение: Увеличить таймауты в `getBrowser()`

2. **Ошибка аутентификации**
   - Проверить credentials
   - Проверить доступность сайта

3. **Ошибка подключения к БД**
   - Проверить `DATABASE_URL`
   - Убедиться, что PostgreSQL запущен

4. **Получен HTML вместо CSV**
   - Сессия истекла, нужна повторная авторизация

---

## Производительность

**Типичное время выполнения:**
- Аутентификация: ~60-70 секунд
- Загрузка CSV: ~0.5-1 секунда
- Парсинг: ~0.1 секунда
- Сохранение: зависит от количества записей (~1-5 секунд на 100 записей)

**Итого:** ~70-80 секунд для синхронизации 30 дней

---

## Безопасность

- Credentials хранятся в переменных окружения
- Браузер запускается в headless режиме
- Cookies автоматически управляются Puppeteer
- Сессии не сохраняются между запусками

---

## Тестирование

### Тестовые endpoints:

1. **Тест аутентификации:**
   ```bash
   POST /api/test/elocal/calls/auth
   ```

2. **Тест загрузки CSV (без сохранения):**
   ```bash
   GET /api/test/elocal/calls?start_date=2024-11-01&end_date=2024-11-30
   ```

3. **Полная синхронизация:**
   ```bash
   POST /api/test/elocal/calls/sync
   ```

### Тестовые скрипты:

- `test-elocal-calls.ts` - тестирование всех компонентов
- `test-elocal-save.ts` - тестирование сохранения в БД
- `sync-elocal-calls.ts` - скрипт для ручной синхронизации




