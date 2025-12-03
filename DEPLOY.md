# Инструкция по деплою ABC Metrics на Fly.io

## Быстрый старт

### 1. Создание PostgreSQL базы данных

```bash
# Создать PostgreSQL базу данных
flyctl postgres create --name abc-metrics-db --region iad

# Присоединить базу к приложению
flyctl postgres attach abc-metrics-db -a abc-metrics
```

Это автоматически установит переменную окружения `DATABASE_URL`.

### 2. Установка переменных окружения

```bash
# Workiz API (обязательно для синхронизации данных)
flyctl secrets set WORKIZ_API_KEY="api_scw87tvl56jom24qrph08ktc52ly3pti" -a abc-metrics
flyctl secrets set WORKIZ_API_SECRET="sec_1974068835629754589542939595" -a abc-metrics
flyctl secrets set WORKIZ_API_URL="https://api.workiz.com" -a abc-metrics

# CSV директория (опционально, если используется)
flyctl secrets set CSV_DIRECTORY="./csv-data" -a abc-metrics
```

### 3. Деплой приложения

```bash
export FLYCTL_INSTALL="/Users/rgareev91/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
flyctl deploy -a abc-metrics
```

### 4. Проверка работы

```bash
# Проверить статус
flyctl status -a abc-metrics

# Проверить логи
flyctl logs -a abc-metrics

# Проверить API
flyctl open -a abc-metrics
# Откроется в браузере: https://abc-metrics.fly.dev/api/health
```

## Использование Supabase вместо Fly.io PostgreSQL

Если вы хотите использовать Supabase:

1. Создайте проект на [supabase.com](https://supabase.com)
2. Получите connection string из настроек проекта
3. Установите переменную окружения:

```bash
flyctl secrets set DATABASE_URL="postgresql://user:password@host:port/database" -a abc-metrics
```

## Проверка миграций

Миграции запускаются автоматически при старте приложения. Для ручного запуска:

```bash
flyctl ssh console -a abc-metrics
cd /app
npm run migrate
```

## Мониторинг

```bash
# Просмотр логов в реальном времени
flyctl logs -a abc-metrics

# Проверка метрик
flyctl metrics -a abc-metrics

# SSH доступ
flyctl ssh console -a abc-metrics
```

## Обновление приложения

После внесения изменений:

```bash
npm run build
flyctl deploy -a abc-metrics
```

