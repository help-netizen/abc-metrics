# Инструкция по деплою ABC Metrics на Fly.io

## Быстрый старт

### 1. Создание PostgreSQL базы данных

**Использование Fly.io Managed Postgres (рекомендуется):**

```bash
# Создать Managed Postgres кластер
flyctl mpg create --name abc-metrics-db --region iad --plan development --volume-size 10

# Присоединить базу к приложению (используйте ID кластера из вывода предыдущей команды)
flyctl mpg attach <CLUSTER_ID> --app abc-metrics
```

**Пример:**
```bash
# Создание кластера
flyctl mpg create --name abc-metrics-db --region iad --plan development --volume-size 10
# Output: ID: q49ypo4w4mpr17ln

# Присоединение (если DATABASE_URL уже установлен, сначала удалите его)
flyctl secrets unset DATABASE_URL -a abc-metrics
flyctl mpg attach q49ypo4w4mpr17ln --app abc-metrics
```

Это автоматически установит переменную окружения `DATABASE_URL` с правильным connection string через PgBouncer.

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

## Устранение проблем с SSL сертификатом БД

Если при подключении к PostgreSQL возникает ошибка "self-signed certificate in certificate chain":

### Решение 1: Использование внутреннего подключения (рекомендуется)

Fly.io автоматически предоставляет внутреннее подключение через flycast при использовании `flyctl postgres attach`. Внутренние подключения не требуют SSL, так как трафик остается внутри сети Fly.io.

Убедитесь, что используется команда:
```bash
flyctl postgres attach abc-metrics-db -a abc-metrics
```

Это создаст `DATABASE_URL` с внутренним адресом (flycast или .internal), для которого SSL автоматически отключается.

### Решение 2: Relaxed SSL валидация (для внешних подключений)

Если используется внешнее подключение (например, к Supabase или внешнему PostgreSQL), приложение автоматически использует relaxed SSL валидацию:
- SSL включен (трафик зашифрован)
- Проверка цепочки сертификатов отключена (rejectUnauthorized: false)
- Проверка hostname отключена

Это безопасно, так как трафик все еще зашифрован, но позволяет работать с самоподписанными сертификатами.

### Проверка конфигурации SSL

Логи приложения покажут текущую конфигурацию SSL:
```
[SSL Config] Parsing connection: hostname=..., sslmode=...
[SSL Config] Internal Fly.io host detected, disabling SSL
или
[SSL Config] External connection detected, using relaxed SSL
```

### Ручная настройка SSL режима

Если нужно явно указать SSL режим, добавьте параметр в DATABASE_URL:
```bash
# Отключить SSL
flyctl secrets set DATABASE_URL="postgresql://...?sslmode=disable" -a abc-metrics

# Требовать SSL с relaxed валидацией (по умолчанию для внешних)
flyctl secrets set DATABASE_URL="postgresql://...?sslmode=require" -a abc-metrics
```

