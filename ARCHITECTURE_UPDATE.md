# Обновление архитектуры: Универсальная таблица leads

## Изменения

### 1. Новая таблица `leads`

Вместо отдельной таблицы `proref_leads` создана универсальная таблица `leads` для всех лидов из Workiz:

```sql
CREATE TABLE leads (
  lead_id        VARCHAR(255) PRIMARY KEY,
  source         VARCHAR(100) NOT NULL,
  status         VARCHAR(100) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ,
  job_id         VARCHAR(255),
  client_phone   VARCHAR(50),
  client_name    VARCHAR(255),
  raw_payload    JSONB,
  created_at_db  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at_db  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

**Индексы:**
- `idx_leads_source_created_at` - для фильтрации по источнику и дате
- `idx_leads_status` - для фильтрации по статусу
- `idx_leads_job_id` - для связи с jobs

### 2. WorkizService обновлен

Добавлены методы синхронизации:

- `syncLeads()` - синхронизация лидов из Workiz Leads API
- `syncPayments()` - синхронизация платежей
- `syncCalls()` - синхронизация звонков (опционально)

Все методы делают UPSERT в соответствующие таблицы.

### 3. AggregationService обновлен

**Pro Referral leads** теперь считаются из таблицы `leads`:

```sql
SELECT COUNT(*)
FROM leads
WHERE source = 'Pro Referral'
  AND status != 'Passed'
  AND DATE(created_at) = :date
```

Логика для других источников (eLocals, Google, Rely, NSA, Liberty, Retention) осталась прежней.

### 4. CSV Service обновлен

Убрана обработка файлов `proref_leads` - теперь Pro Referral лиды синхронизируются только через Workiz API.

### 5. API Routes обновлены

- **Удален:** `/api/leads/proref`
- **Добавлен:** `/api/leads` - универсальный endpoint для всех лидов

Параметры запроса:
- `start_date` / `end_date` - фильтр по дате создания
- `source` - фильтр по источнику (Pro Referral, Google, и т.д.)
- `status` - фильтр по статусу
- `limit` - лимит результатов

### 6. Scheduler обновлен

Добавлены задачи синхронизации:

- **Каждый час (00:00):** синхронизация jobs
- **Каждый час (00:05):** синхронизация leads
- **Каждый час (00:10):** синхронизация payments
- **Каждые 6 часов:** синхронизация calls (опционально)

## Миграция данных

Если у вас уже есть данные в `proref_leads`, их нужно мигрировать в `leads`:

```sql
INSERT INTO leads (lead_id, source, status, created_at, updated_at, job_id, client_phone, client_name)
SELECT 
  lead_id,
  'Pro Referral' as source,
  COALESCE(current_status, status) as status,
  date as created_at,
  updated_at,
  NULL as job_id,
  NULL as client_phone,
  NULL as client_name
FROM proref_leads
ON CONFLICT (lead_id) DO NOTHING;
```

После миграции таблицу `proref_leads` можно удалить:

```sql
DROP TABLE IF EXISTS proref_leads;
```

## Преимущества новой архитектуры

1. **Единая точка входа** - все лиды из Workiz в одной таблице
2. **Гибкость** - легко добавлять новые источники лидов
3. **Упрощение логики** - не нужно обрабатывать разные таблицы для разных источников
4. **Масштабируемость** - можно использовать для Google, Website и других источников из Workiz

## Примеры использования

### Получить все Pro Referral лиды за месяц:

```sql
SELECT *
FROM leads
WHERE source = 'Pro Referral'
  AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
  AND status != 'Passed';
```

### Получить все лиды по источнику через API:

```
GET /api/leads?source=Pro%20Referral&start_date=2024-11-01&end_date=2024-11-30
```

### Подсчет лидов для метрик:

```typescript
// В AggregationService
const result = await client.query(`
  SELECT COUNT(*) as count
  FROM leads
  WHERE DATE(created_at) = $1::date 
    AND source = 'Pro Referral'
    AND status != 'Passed'
`, [dateStr]);
```

