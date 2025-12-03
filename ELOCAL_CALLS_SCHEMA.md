# Elocal Calls Database Schema

## Таблица `calls`

Таблица для хранения данных о телефонных звонках из elocal.com и других источников.

### Структура таблицы

```sql
CREATE TABLE calls (
  id SERIAL PRIMARY KEY,
  call_id VARCHAR(255) UNIQUE NOT NULL,  -- Внешний ID из elocal.com (ключ для upsert)
  date DATE NOT NULL,                     -- Дата звонка (YYYY-MM-DD)
  duration INTEGER,                      -- Длительность в секундах
  call_type VARCHAR(100),                -- Тип/статус звонка
  source VARCHAR(100) NOT NULL DEFAULT 'elocals',  -- Источник данных
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT calls_call_id_key UNIQUE (call_id)
);
```

### Индексы

- `idx_calls_call_id` - на `call_id` (для быстрого поиска при upsert)
- `idx_calls_date` - на `date` (для запросов по датам)
- `idx_calls_source` - на `source` (для фильтрации по источнику)
- `idx_calls_date_source` - составной индекс на `(date, source)` (для частых запросов)

### Маппинг полей из CSV

| CSV поле (elocal.com) | Поле БД | Описание |
|----------------------|---------|----------|
| `Unique ID` | `call_id` | Уникальный идентификатор звонка (внешний ключ) |
| `Time` | `date` | Дата и время звонка (парсится в DATE) |
| `Duration` | `duration` | Длительность в формате MM:SS (конвертируется в секунды) |
| `Status` | `call_type` | Статус звонка (например, "Call Credited (No Charge)") |
| - | `source` | Всегда 'elocals' для данных из elocal.com |

### Upsert логика

Используется `ON CONFLICT (call_id) DO UPDATE` для идемпотентных синхронизаций:

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

**Преимущества:**
- ✅ Можно запускать синхронизацию хоть каждый час
- ✅ Данные всегда актуальны (обновляются при каждом запуске)
- ✅ Нет дубликатов (обновление существующих записей)
- ✅ Безопасно для параллельных запусков

### Примеры запросов

#### Получить все звонки за период
```sql
SELECT * FROM calls 
WHERE date >= '2024-11-01' AND date <= '2024-11-30'
ORDER BY date DESC;
```

#### Получить звонки по источнику
```sql
SELECT * FROM calls 
WHERE source = 'elocals' 
AND date >= '2024-11-01'
ORDER BY date DESC;
```

#### Статистика по дням
```sql
SELECT 
  date,
  COUNT(*) as call_count,
  SUM(duration) as total_duration_seconds,
  AVG(duration) as avg_duration_seconds
FROM calls
WHERE source = 'elocals'
  AND date >= '2024-11-01'
GROUP BY date
ORDER BY date DESC;
```

#### Проверить последнюю синхронизацию
```sql
SELECT 
  MAX(updated_at) as last_sync,
  COUNT(*) as total_calls,
  COUNT(DISTINCT date) as days_with_calls
FROM calls
WHERE source = 'elocals';
```

