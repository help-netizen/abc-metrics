# Импорт исторических данных о работах из CSV в fact_jobs

Этот скрипт импортирует исторические данные о работах из CSV файла, экспортированного из Workiz, в таблицу `fact_jobs` базы данных.

## Использование

### 1. Подготовка

Убедитесь, что:
- Установлены все зависимости: `npm install`
- Настроена переменная окружения `DATABASE_URL` с подключением к PostgreSQL
- CSV файл находится в доступном месте

### 2. Запуск импорта

```bash
# Вариант 1: Используя npm script
npm run import-jobs-csv Import-2025-12-16T13_58_55.706Z.csv

# Вариант 2: Напрямую через ts-node
ts-node import-workiz-jobs-csv.ts Import-2025-12-16T13_58_55.706Z.csv
```

### 3. Структура данных

Скрипт маппит следующие поля из CSV в `fact_jobs`:

| CSV поле | fact_jobs поле | Описание |
|----------|----------------|----------|
| UUID | job_id | PRIMARY KEY - уникальный идентификатор работы |
| Job # | serial_id | Серийный номер работы |
| Job Type | type | Тип работы (COD Repair, INS Service, etc.) |
| Job Date | scheduled_at | Запланированная дата работы |
| Job End | job_end_date_time | Дата окончания работы |
| Created | created_at | Дата создания работы |
| Conversion Date | last_status_update | Дата последнего обновления статуса |
| Tech | technician_name | Имя техника |
| Source | source_id | Источник (через dim_source) |
| Amount Due | job_amount_due | Сумма к оплате |
| Total | job_total_price | Общая стоимость работы |
| Все остальные поля | meta (JSONB) | Дополнительные данные сохраняются в JSONB поле |

### 4. Особенности

- **Idempotent импорт**: Скрипт использует `ON CONFLICT DO UPDATE`, поэтому можно запускать его несколько раз без дублирования данных
- **Автоматическое создание источников**: Если источник из CSV не найден в `dim_source`, он будет создан автоматически
- **Обработка ошибок**: Скрипт продолжает работу даже при ошибках в отдельных записях и выводит итоговую статистику
- **Прогресс**: Каждые 100 записей выводится прогресс импорта

### 5. Пример вывода

```
=== Workiz Jobs CSV Import ===
CSV file: /path/to/Import-2025-12-16T13_58_55.706Z.csv
Database: Connected

Parsed 3625 records from CSV
Progress: 100/3625 jobs imported...
Progress: 200/3625 jobs imported...
...

=== Import Summary ===
Total records: 3625
Successfully imported: 3620
Skipped: 5

Import completed successfully!
```

### 6. Обработка дат

Скрипт автоматически обрабатывает различные форматы дат из Workiz CSV:
- "Fri Dec 19 2025"
- ISO формат (YYYY-MM-DD)
- Другие стандартные форматы JavaScript Date

### 7. Требования к CSV

CSV файл должен содержать колонку `UUID`, которая используется как PRIMARY KEY в таблице `fact_jobs`. Записи без UUID будут пропущены.

## Устранение проблем

### Ошибка подключения к БД
Убедитесь, что переменная `DATABASE_URL` установлена и корректна:
```bash
export DATABASE_URL="postgresql://user:password@host:port/database"
```

### Ошибки парсинга дат
Если некоторые даты не парсятся, они будут установлены в `null`, но импорт продолжится.

### Дублирование данных
Скрипт использует `ON CONFLICT DO UPDATE`, поэтому повторный запуск обновит существующие записи, а не создаст дубликаты.

