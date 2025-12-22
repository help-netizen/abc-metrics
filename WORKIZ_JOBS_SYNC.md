# Детали реализации синхронизации Jobs из Workiz API

## Обзор

Синхронизация данных о заявках (jobs) из Workiz API реализована через автоматическую периодическую синхронизацию с сохранением в PostgreSQL. Синхронизация происходит автоматически по расписанию и может быть запущена вручную через API endpoints.

---

## Архитектура

### Сервис: `SvcWorkizJobs`

**Файл:** `src/services/svc-workiz-jobs.ts`

**Основные компоненты:**
- HTTP клиент (axios) для запросов к Workiz API
- Пагинация для получения больших объемов данных
- Нормализация данных из Workiz API в унифицированный формат
- Сохранение в БД с upsert логикой (факт-таблица `fact_jobs`)
- Автоматическое управление источниками через `dim_source`

---

## Способы запуска синхронизации

### 1. Автоматическая синхронизация (по расписанию)

**Расписание:** Каждый час в :00 (00:00, 01:00, 02:00, и т.д.)

**Реализация:** `src/scheduler.ts`

```typescript
// Sync Workiz jobs every hour
cron.schedule('0 * * * *', async () => {
  console.log('Running svc-workiz-jobs sync...');
  try {
    await this.svcWorkizJobs.syncJobs();
  } catch (error) {
    console.error('Error in svc-workiz-jobs sync:', error);
  }
});
```

**Период синхронизации:** Последние 30 дней (от текущей даты минус 30 дней до сегодня)

---

### 2. Ручной запуск через REST API

**Endpoint:** `POST /api/test/workiz/jobs/sync-full`

**Использование:**
```bash
curl -X POST http://localhost:3001/api/test/workiz/jobs/sync-full
```

**Реализация:** `src/api/routes.ts:667-686`

Выполняет полную синхронизацию, аналогично автоматической (последние 30 дней).

---

### 3. Ручной запуск с параметрами через REST API

**Endpoint:** `POST /api/test/workiz/jobs/sync`

**Использование:**
```bash
curl -X POST http://localhost:3001/api/test/workiz/jobs/sync \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2024-11-01",
    "end_date": "2024-11-30",
    "only_open": false
  }'
```

**Реализация:** `src/api/routes.ts:623-664`

Позволяет указать конкретный период синхронизации.

---

### 4. Получение jobs без сохранения (тестовый endpoint)

**Endpoint:** `GET /api/test/workiz/jobs?start_date=2024-11-01&end_date=2024-11-30`

**Использование:**
```bash
curl "http://localhost:3001/api/test/workiz/jobs?start_date=2024-11-01&end_date=2024-11-30&only_open=false"
```

**Реализация:** `src/api/routes.ts:548-595`

Возвращает jobs из Workiz API без сохранения в БД. Полезно для тестирования и отладки.

---

## Детали реализации методов

### 1. `syncJobs()` - Главный метод синхронизации

**Описание:** Выполняет полный цикл синхронизации

**Алгоритм:**
1. Вычисляет период: последние 30 дней (от текущей даты минус 30 дней до сегодня)
2. Вызывает `fetchJobs()` для получения данных из Workiz API
3. Вызывает `saveJobs()` для сохранения в БД

**Код:**
```typescript
async syncJobs(): Promise<void> {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const jobs = await this.fetchJobs(startDate, endDate, false);
  await this.saveJobs(jobs);
}
```

---

### 2. `fetchJobs(startDate, endDate?, onlyOpen?)` - Получение jobs из API

**Описание:** Получает jobs из Workiz API с поддержкой пагинации

**Процесс:**

1. **Инициализация пагинации:**
   - Начальный offset: 0
   - Размер страницы: 100 записей (максимум для Workiz API)
   - Флаг `hasMore = true` для управления циклом

2. **Цикл пагинации:**
   - Формирует запрос к API: `GET /api/v1/{API_KEY}/job/all/`
   - Параметры запроса:
     - `start_date` - начальная дата (обязательный)
     - `offset` - смещение для пагинации
     - `records` - количество записей на страницу (100)
     - `only_open` - только открытые jobs (опционально)

3. **Обработка ответа:**
   - Поддержка разных форматов ответа:
     - Прямой массив: `response.data`
     - Вложенный массив: `response.data.data`
     - Альтернативный формат: `response.data.jobs`

4. **Нормализация данных:**
   - Вызывает `normalizeJob()` для каждой записи
   - Фильтрует некорректные записи (null)

5. **Продолжение пагинации:**
   - Если получено меньше 100 записей → последняя страница
   - Если получено ровно 100 записей → продолжает на следующей странице
   - Защита от бесконечного цикла: максимум 10000 записей (100 страниц)

6. **Обработка ошибок:**
   - Счетчик последовательных ошибок (max 3)
   - При 3 последовательных ошибках → остановка пагинации
   - При ошибке 429 (rate limit) → ожидание перед следующей страницей
   - Задержка 100мс между страницами для предотвращения rate limiting

**Важное ограничение Workiz API:**
⚠️ **Workiz API НЕ поддерживает параметр `end_date`** - он игнорируется. API всегда возвращает данные с `start_date` до текущего момента. Параметр `end_date` оставлен для обратной совместимости, но не используется.

**URL запроса:**
```
https://api.workiz.com/api/v1/{API_KEY}/job/all/
```

**Параметры:**
- `start_date` - YYYY-MM-DD (обязательный)
- `offset` - число (для пагинации)
- `records` - число (1-100, по умолчанию 100)
- `only_open` - boolean (только открытые jobs)

**Пример лога:**
```
[PAGINATION] Starting jobs fetch: start_date=2024-11-08, only_open=false, records_per_page=100
[PAGINATION] Page 1: Fetching jobs - offset=0, records=100
[PAGINATION] Page 1: API request completed in 1.23s, status=200
[PAGINATION] Page 1: Received 100 jobs from API
[PAGINATION] Page 1: Normalized 100 jobs from 100 raw jobs (took 0.05s)
[PAGINATION] Page 2: Fetching jobs - offset=100, records=100
[PAGINATION] Completed: Total pages=15, total jobs fetched=1423
```

---

### 3. `normalizeJob(rawJob)` - Нормализация данных

**Описание:** Преобразует сырые данные из Workiz API в унифицированный формат

**Маппинг полей:**

| Поле Workiz API | Поле БД | Обработка |
|----------------|---------|-----------|
| `UUID` / `id` / `unique_id` | `job_id` | Обязательное поле, используется как первичный ключ |
| `JobDateTime` / `date` / `CreatedDate` | `date` | Парсится в формат YYYY-MM-DD |
| `JobType` / `Type` / `type` | `type` | Сохраняется как есть |
| `JobSource` / `Source` / `source` | `source` | По умолчанию 'workiz' |
| `Status` / `status` | `status` | Сохраняется как есть |
| `Unit` / `unit` | `unit` | Сохраняется как есть |
| `RepairType` / `repair_type` | `repair_type` | Извлекается из type если содержит 'Repair' |
| `item_cost + tech_cost` / `Cost` | `cost` | Суммируется если доступно |
| `JobTotalPrice` / `SubTotal` / `Revenue` | `revenue` | Приоритет: JobTotalPrice > SubTotal > Revenue |
| Весь объект | `raw_data` | Сохраняется в JSONB поле `meta` |

**Особенности обработки:**

1. **Date:**
   - Поддержка разных форматов даты
   - Парсинг строк и объектов Date
   - Fallback на текущую дату если дата не найдена

2. **Cost:**
   - Приоритет: `item_cost + tech_cost` > `Cost`
   - Если оба отсутствуют → null

3. **Revenue:**
   - Приоритет: `JobTotalPrice` > `SubTotal` > `JobAmountDue` > `Revenue` > `TotalAmount`
   - Парсинг в число (parseFloat)

4. **Source:**
   - Нормализация: приведение к lowercase, замена пробелов на underscore
   - По умолчанию: 'workiz'

**Пример нормализации:**
```typescript
// Input (Workiz API):
{
  UUID: 'abc-123-def',
  JobDateTime: '2024-11-15 10:30:00',
  JobType: 'COD Service',
  JobSource: 'Google',
  Status: 'Completed',
  Unit: 'Kitchen',
  item_cost: 50.00,
  tech_cost: 25.00,
  JobTotalPrice: 500.00
}

// Output (WorkizJob):
{
  id: 'abc-123-def',
  date: '2024-11-15',
  type: 'COD Service',
  source: 'Google',
  status: 'Completed',
  unit: 'Kitchen',
  cost: 75.00,  // item_cost + tech_cost
  revenue: 500.00,
  raw_data: { /* весь исходный объект */ }
}
```

---

### 4. `saveJobs(jobs)` - Сохранение в БД

**Описание:** Сохраняет jobs в таблицу `fact_jobs` с upsert логикой

**Upsert запрос:**
```sql
INSERT INTO fact_jobs (
  job_id, lead_id, created_at, scheduled_at, 
  source_id, type, client_id, meta
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (job_id) 
DO UPDATE SET 
  lead_id = EXCLUDED.lead_id,
  created_at = EXCLUDED.created_at,
  scheduled_at = EXCLUDED.scheduled_at,
  source_id = EXCLUDED.source_id,
  type = EXCLUDED.type,
  client_id = EXCLUDED.client_id,
  meta = EXCLUDED.meta,
  updated_at_db = CURRENT_TIMESTAMP
```

**Процесс сохранения:**

1. **Транзакция:**
   - Использует транзакцию (BEGIN/COMMIT) для атомарности
   - При ошибке → ROLLBACK

2. **Для каждого job:**
   - Получение `source_id` из `dim_source` (создание если не существует)
   - Извлечение `lead_id` из `raw_data.LeadId`
   - Извлечение `client_id` из `raw_data.ClientId`
   - Извлечение `scheduled_at` из `raw_data.JobDateTime`
   - Сохранение всего `raw_data` в поле `meta` (JSONB)

3. **Обработка ошибок:**
   - Каждый job обрабатывается индивидуально
   - Ошибка сохранения одного job не останавливает процесс
   - Счетчики: savedCount, skippedCount, errors[]

4. **Идемпотентность:**
   - Можно запускать хоть каждый час
   - Дубликаты не создаются (обновление существующих)
   - Данные всегда актуальны

**Статистика сохранения:**
```
Jobs save summary: 1423 saved, 0 skipped
```

---

### 5. `getSourceId(sourceCode)` - Управление источниками

**Описание:** Получает или создает запись в справочнике `dim_source`

**Процесс:**

1. **Нормализация кода источника:**
   - Приведение к lowercase
   - Замена пробелов на underscore
   - Удаление спецсимволов

2. **Поиск в БД:**
   - Поиск по нормализованному коду
   - Если найден → возвращает ID

3. **Создание если не найден:**
   - Автоматическое создание записи в `dim_source`
   - Использует `ON CONFLICT DO UPDATE` для безопасности
   - Возвращает ID новой записи

**Пример:**
```typescript
// Input: 'Google Ads'
// Нормализация: 'google_ads'
// Результат: ID из dim_source (например, 5)
```

---

## Конфигурация

### Переменные окружения

```env
WORKIZ_API_KEY=api_scw87tvl56jom24qrph08ktc52ly3pti
WORKIZ_API_SECRET=sec_1974068835629754589542939595
WORKIZ_API_URL=https://api.workiz.com
```

**Обязательные:**
- `WORKIZ_API_KEY` - API ключ для аутентификации

**Опциональные:**
- `WORKIZ_API_SECRET` - секретный ключ (используется редко)
- `WORKIZ_API_URL` - базовый URL API (по умолчанию: `https://api.workiz.com`)

---

## Структура данных

### Интерфейс WorkizJobRaw (сырые данные от API)

```typescript
interface WorkizJobRaw {
  UUID?: string;
  LocationId?: number;
  JobDateTime?: string;
  CreatedDate?: string;
  JobTotalPrice?: number;
  JobAmountDue?: number;
  SubTotal?: number;
  item_cost?: number;
  tech_cost?: number;
  ClientId?: number;
  Status?: string;
  SubStatus?: string;
  JobType?: string;
  JobSource?: string;
  Unit?: string;
  JobNotes?: string;
  Team?: Array<{ id: number; Name: string }>;
  [key: string]: any;
}
```

### Интерфейс WorkizJob (нормализованные данные)

```typescript
interface WorkizJob {
  id: string;           // UUID из API
  date: string;         // YYYY-MM-DD
  type?: string;        // JobType
  source?: string;      // JobSource
  unit?: string;        // Unit
  repair_type?: string; // RepairType или из type
  cost?: number;        // item_cost + tech_cost или Cost
  revenue?: number;     // JobTotalPrice или SubTotal
  status?: string;      // Status
  raw_data?: any;       // Весь исходный объект
}
```

### Таблица БД: `fact_jobs`

```sql
CREATE TABLE fact_jobs (
  job_id VARCHAR(255) PRIMARY KEY,
  lead_id VARCHAR(255) REFERENCES fact_leads(lead_id),
  created_at TIMESTAMP NOT NULL,
  scheduled_at TIMESTAMP,
  source_id INTEGER REFERENCES dim_source(id),
  type TEXT,
  client_id VARCHAR(255),
  meta JSONB,
  created_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at_db TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

**Индексы:**
- `idx_fact_jobs_created_at` - для фильтрации по дате создания
- `idx_fact_jobs_scheduled_at` - для фильтрации по запланированной дате
- `idx_fact_jobs_lead_id` - для связи с leads
- `idx_fact_jobs_source_id` - для фильтрации по источнику
- `idx_fact_jobs_type` - для фильтрации по типу
- `idx_fact_jobs_meta` - GIN индекс для JSONB запросов

---

## Примеры использования

### Пример 1: Полная автоматическая синхронизация

```typescript
// Запускается автоматически каждый час через scheduler
// Или вручную:
const svcWorkizJobs = new SvcWorkizJobs();
await svcWorkizJobs.syncJobs();
```

### Пример 2: Синхронизация за конкретный период

```typescript
const svcWorkizJobs = new SvcWorkizJobs();

// Получение jobs
const jobs = await svcWorkizJobs.fetchJobs(
  '2024-11-01',
  '2024-11-30',  // Игнорируется API, но можно указать для ясности
  false  // only_open
);

// Сохранение в БД
await svcWorkizJobs.saveJobs(jobs);
```

### Пример 3: Только получение без сохранения

```typescript
const svcWorkizJobs = new SvcWorkizJobs();

const jobs = await svcWorkizJobs.fetchJobs(
  '2024-11-01',
  '2024-11-30',
  false
);

console.log(`Получено ${jobs.length} jobs`);
console.log('Пример job:', jobs[0]);
```

---

## Логирование

Сервис использует детальное логирование с префиксами:

- `[PAGINATION]` - процесс пагинации
- Обычные логи - общий процесс синхронизации

**Пример лога:**
```
[PAGINATION] Starting jobs fetch: start_date=2024-11-08, only_open=false, records_per_page=100
[PAGINATION] Page 1: Fetching jobs - offset=0, records=100
[PAGINATION] Page 1: API request completed in 1.23s, status=200
[PAGINATION] Page 1: Received 100 jobs from API
[PAGINATION] Page 1: Normalized 100 jobs from 100 raw jobs (took 0.05s)
[PAGINATION] Page 1: Summary - offset=0, received=100, normalized=100, total_accumulated=100, time=1.28s
[PAGINATION] Page 2: Fetching jobs - offset=100, records=100
...
[PAGINATION] Completed: Total pages=15, total jobs fetched=1423
Saving job: id=abc-123, date=2024-11-15, type=COD Service, source=Google
Jobs save summary: 1423 saved, 0 skipped
```

---

## Обработка ошибок

### Типичные ошибки:

1. **Ошибка аутентификации (401)**
   - Причина: неверный `WORKIZ_API_KEY`
   - Решение: Проверить переменную окружения

2. **Rate limiting (429)**
   - Причина: слишком много запросов
   - Решение: Автоматическая задержка перед следующей страницей

3. **Ошибка подключения к БД**
   - Причина: Недоступна PostgreSQL
   - Решение: Проверить `DATABASE_URL`

4. **Ошибка нормализации**
   - Причина: Некорректный формат данных от API
   - Решение: Job пропускается, ошибка логируется

---

## Производительность

**Типичное время выполнения:**
- Запрос к API (100 jobs): ~1-2 секунды
- Нормализация (100 jobs): ~0.05 секунды
- Сохранение в БД (100 jobs): ~0.5-1 секунда
- Полная синхронизация (1423 jobs, 15 страниц): ~20-30 секунд

**Оптимизации:**
- Пагинация для больших объемов данных
- Транзакции для пакетной записи
- Индексы в БД для быстрого поиска
- Задержка 100мс между страницами для предотвращения rate limiting

---

## Безопасность

- API ключи хранятся в переменных окружения
- Используется HTTPS для запросов к API
- SQL injection защита через параметризованные запросы
- Graceful обработка ошибок без раскрытия внутренних деталей

---

## Тестирование

### Тестовые endpoints:

1. **Тест получения jobs (без сохранения):**
   ```bash
   GET /api/test/workiz/jobs?start_date=2024-11-01&end_date=2024-11-30
   ```

2. **Ручная синхронизация с параметрами:**
   ```bash
   POST /api/test/workiz/jobs/sync
   ```

3. **Полная синхронизация:**
   ```bash
   POST /api/test/workiz/jobs/sync-full
   ```

---

## Ограничения и известные проблемы

1. **Workiz API не поддерживает end_date**
   - Параметр `end_date` игнорируется API
   - API всегда возвращает данные с `start_date` до текущего момента
   - Обходной путь: Фильтрация на стороне приложения после получения

2. **Максимальный размер страницы: 100 записей**
   - Нельзя запросить больше 100 записей за один запрос
   - Используется пагинация для получения всех данных

3. **Защита от бесконечного цикла: 10000 записей**
   - Максимум 100 страниц (10000 записей) за одну синхронизацию
   - При превышении → остановка пагинации с предупреждением

---

## Связанные документы

- [WORKIZ_SETUP.md](./WORKIZ_SETUP.md) - настройка Workiz API
- [WORKIZ_API_REFERENCE.md](./WORKIZ_API_REFERENCE.md) - справочник Workiz API
- [docs/requirements.md](./docs/requirements.md) - требования проекта (F001)
- [docs/architecture.md](./docs/architecture.md) - архитектура проекта
- [ELOCAL_SYNC_IMPLEMENTATION.md](./ELOCAL_SYNC_IMPLEMENTATION.md) - аналогичная реализация для Elocal Calls



