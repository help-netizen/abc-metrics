# Инструкции для полного тестирования DB API с подключенной БД

## Требования

Для полного тестирования записи данных требуется:

1. **DATABASE_URL** - строка подключения к PostgreSQL
2. **DB_API_KEY** - API ключ для аутентификации

## Варианты получения DATABASE_URL

### Вариант 1: Использовать БД из Fly.io

Если у вас есть доступ к Fly.io приложению `abc-metrics`:

```bash
# Получить DATABASE_URL из secrets
flyctl secrets list -a abc-metrics | grep DATABASE_URL

# Или получить через SSH
flyctl ssh console -a abc-metrics
echo $DATABASE_URL
```

### Вариант 2: Использовать локальную БД

Если у вас установлен PostgreSQL локально:

```bash
# Создать базу данных
createdb abc_metrics_test

# DATABASE_URL будет:
DATABASE_URL=postgresql://localhost:5432/abc_metrics_test
```

### Вариант 3: Использовать Supabase или другую облачную БД

Получите connection string из настроек вашего проекта.

## Запуск тестов

### Шаг 1: Установить переменные окружения

```bash
export DATABASE_URL="postgresql://user:password@host:port/database"
export DB_API_KEY="test-api-key-123"
```

Или создать `.env` файл:

```env
DATABASE_URL=postgresql://user:password@host:port/database
DB_API_KEY=test-api-key-123
```

### Шаг 2: Перезапустить сервер с переменными окружения

```bash
# Остановить текущий сервер
kill $(ps aux | grep "node dist/metrics-collector.js" | grep -v grep | awk '{print $2}')

# Запустить с переменными окружения
DATABASE_URL="your-database-url" DB_API_KEY="test-api-key-123" npm start
```

### Шаг 3: Запустить полные тесты

```bash
DATABASE_URL="your-database-url" DB_API_KEY="test-api-key-123" npx ts-node test-db-api-full.ts
```

## Что тестируется

1. ✅ Health check (проверка подключения к БД)
2. ✅ Чтение списка таблиц
3. ✅ Чтение jobs
4. ✅ Чтение payments
5. ✅ Чтение calls
6. ✅ Чтение leads
7. ✅ Запись single call
8. ✅ Запись multiple calls (array)
9. ✅ Batch write (несколько типов данных)
10. ✅ UPSERT (обновление существующей записи)
11. ✅ Чтение daily metrics
12. ✅ Чтение monthly metrics
13. ✅ Чтение таблицы по имени

## Ожидаемые результаты

При успешном тестировании все тесты должны пройти (✅ PASS).

Если БД не подключена, тесты записи данных будут падать с ошибками подключения.

## Пример вывода

```
============================================================
Full DB API Testing with Database Connection
============================================================
API Base URL: http://localhost:3001
API Key: test-api-k...
DATABASE_URL: SET

Test 1: Health check...
  Status: ok
  Database: connected
  ✓ Database is connected

Test 2: Read tables list...
  ✓ Read tables successful
  Tables found: 15
  Sample tables: calls, jobs, payments, leads, daily_metrics

...

Test Summary
============================================================
Total tests: 13
Passed: 13 ✅
Failed: 0
```

## Устранение проблем

### Ошибка: "Database connection failed"

**Причина:** DATABASE_URL не установлен или неверный.

**Решение:** Проверьте DATABASE_URL и убедитесь, что БД доступна.

### Ошибка: "API key authentication is not configured"

**Причина:** DB_API_KEY не установлен на сервере.

**Решение:** Перезапустите сервер с DB_API_KEY в переменных окружения.

### Ошибка: "Unauthorized"

**Причина:** Неправильный API ключ в запросе.

**Решение:** Убедитесь, что используете тот же API ключ, что и на сервере.



