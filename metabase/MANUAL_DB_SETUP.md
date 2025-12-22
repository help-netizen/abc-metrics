# Инструкция по ручному подключению базы данных с бизнес-данными к Metabase

## Проблема

**Текущая ситуация**: 
- Metabase использует одну базу данных для своих системных таблиц (application database)
- Приложение `abc-metrics` должно использовать ту же базу данных для бизнес-данных
- Но миграции не выполнены, поэтому бизнес-таблицы (`fact_leads`, `fact_jobs`, `fact_payments`, views) не существуют

**Если вы видите список таблиц типа**: `Action`, `Api Key`, `Audit Log`, `Collection`, `Core User`, `Metabase Database`, `Permissions`, `Query`, `Report Dashboard` - это системные таблицы Metabase. Бизнес-таблицы должны быть в той же базе данных, но их нужно создать через миграции.

## Решение

Нужно:
1. **Выполнить миграции** в базе данных, чтобы создать бизнес-таблицы и views
2. **Добавить источник данных в Metabase** с правильными параметрами подключения
3. **Пересинхронизировать схему** в Metabase, чтобы увидеть созданные таблицы и views

**⚠️ ВАЖНО**: Используйте параметры подключения из `DATABASE_URL` приложения `abc-metrics`. Это та же база данных, что использует Metabase для системных таблиц, но в ней должны быть созданы бизнес-таблицы через миграции.

## Шаг 0: Выполнение миграций (ОБЯЗАТЕЛЬНО!)

**Перед подключением к Metabase нужно создать бизнес-таблицы и views в базе данных!**

### Выполните миграции на сервере:

```bash
export FLYCTL_INSTALL="/Users/rgareev91/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

# Подключитесь к серверу и выполните миграции
flyctl ssh console -a abc-metrics
cd /app
npm run migrate
```

Это создаст все необходимые таблицы:
- `dim_source`, `dim_date`
- `fact_leads`, `fact_jobs`, `fact_payments`
- `kpi_targets`
- Views: `vw_job_metrics`, `vw_daily_metrics`, `vw_monthly_metrics`

**После выполнения миграций переходите к Шагу 1.**

## Шаг 1: Получение параметров подключения

**⚠️ ВАЖНО**: Используйте параметры подключения из `DATABASE_URL` приложения `abc-metrics`. Это та же база данных, что использует Metabase, но после миграций в ней будут бизнес-таблицы.

### Вариант A: Через Fly.io CLI (рекомендуется)

```bash
export FLYCTL_INSTALL="/Users/rgareev91/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

# Получить DATABASE_URL из приложения abc-metrics
flyctl ssh console -a abc-metrics -C "printenv DATABASE_URL" 2>&1 | grep "^postgresql://"
```

Результат будет выглядеть примерно так:
```
postgresql://fly-user:password@pgbouncer.9g6y30w2qg60v5ml.flympg.net/fly-db
```

**Извлеките параметры из этой строки** (см. Вариант C ниже).

### Вариант B: Через Fly.io Dashboard

1. Откройте https://fly.io/dashboard
2. Выберите приложение `abc-metrics`
3. Перейдите в раздел **Secrets**
4. Найдите `DATABASE_URL` и скопируйте значение

### Вариант C: Извлечь параметры из DATABASE_URL

Если у вас есть DATABASE_URL в формате:
```
postgresql://user:password@host:port/database?sslmode=require
```

Параметры:
- **Host**: часть после `@` и до `:`
- **Port**: число после `:` и до `/`
- **Database name**: часть после последнего `/` и до `?`
- **Username**: часть после `://` и до `:`
- **Password**: часть после `:` и до `@`

## Шаг 2: Добавление источника данных в Metabase

**⚠️ ВАЖНО**: После выполнения миграций (Шаг 0) в базе данных будут и системные таблицы Metabase, и бизнес-таблицы. При подключении вы увидите ОБА типа таблиц. Это нормально!

1. **Откройте Metabase**: https://abc-metrics-metabase.fly.dev
2. **Войдите в систему**:
   - Email: `help@bostonmasters.com`
   - Password: `Alga!B@r2`

3. **Перейдите в настройки баз данных**:
   - Нажмите на иконку **шестеренки** (⚙️) в правом верхнем углу
   - Выберите **Admin settings**
   - В левом меню выберите **Databases**
   - Нажмите кнопку **Add database**

4. **Выберите тип базы данных**:
   - Выберите **PostgreSQL**

5. **Заполните параметры подключения**:

   **⚠️ ВАЖНО**: Используйте параметры из `DATABASE_URL` приложения `abc-metrics`, полученные в Шаге 1!
   
   Пример (замените на ваши реальные значения):
   ```
   Display name: ABC Metrics Business DB
   
   Host: [извлеките из DATABASE_URL - часть после @ и до :]
   Port: [извлеките из DATABASE_URL - число после : и до /]
   Database name: [извлеките из DATABASE_URL - часть после последнего / и до ?]
   Username: [извлеките из DATABASE_URL - часть после :// и до :]
   Password: [извлеките из DATABASE_URL - часть после : и до @]
   
   Use a secure connection (SSL): ✅ Enabled (обязательно!)
   ```
   
   **Пример с реальными значениями** (проверьте актуальность через Шаг 1):
   ```
   Display name: ABC Metrics Business DB
   
   Host: pgbouncer.9g6y30w2qg60v5ml.flympg.net
   Port: 5432
   Database name: fly-db
   Username: fly-user
   Password: [ваш реальный пароль из DATABASE_URL]
   
   Use a secure connection (SSL): ✅ Enabled
   ```

   **Критически важно**: 
   - ❌ НЕ используйте параметры из `metabase/fly.toml` (это системная БД Metabase)
   - ✅ Используйте параметры из `DATABASE_URL` приложения `abc-metrics`
   - ✅ SSL должен быть включен (`Use a secure connection (SSL)`)

6. **Настройте дополнительные параметры** (опционально):

   - **Connection pooling**: Можно оставить по умолчанию
   - **Additional JDBC connection string options**: Можно оставить пустым
   - **Choose when Metabase syncs and scans**: 
     - **Database syncing**: `Hourly` (рекомендуется)
     - **Scan for new fields**: `Daily` (рекомендуется)

7. **Сохраните подключение**:
   - Нажмите кнопку **Save**
   - Metabase автоматически протестирует подключение

## Шаг 3: Проверка подключения

После сохранения Metabase автоматически:
1. Протестирует подключение
2. Начнет синхронизацию схемы базы данных
3. Обнаружит все таблицы и views

### Проверка вручную:

1. **Проверьте список баз данных**:
   - В разделе **Databases** вы должны увидеть:
     - `ABC Metrics Business DB` (новая база данных)
     - `ABC Metrics PostgreSQL` (старая, системная БД Metabase - можно игнорировать)

2. **Проверьте таблицы**:
   - Нажмите на `ABC Metrics Business DB`
   - **После выполнения миграций (Шаг 0) вы должны увидеть ОБА типа таблиц**:
   
   **Системные таблицы Metabase** (это нормально, их можно игнорировать):
   - `Action`, `Api Key`, `Audit Log`, `Collection`, `Core User`, `Metabase Database`, `Permissions`, `Query`, `Report Dashboard`, и т.д.
   
   **Бизнес-таблицы** (это то, что нам нужно):
   - `fact_leads`
   - `fact_jobs`
   - `fact_payments`
   - `dim_source`
   - `dim_date`
   - `kpi_targets`
   - И другие бизнес-таблицы (если есть)
   
   **⚠️ ВАЖНО**: 
   - Если вы видите ТОЛЬКО системные таблицы Metabase (без `fact_*`, `dim_*`, `kpi_*`) - значит миграции не выполнены! Вернитесь к Шагу 0.
   - Если вы видите ОБА типа таблиц - это правильно! Используйте бизнес-таблицы для создания вопросов.

3. **Проверьте views**:
   - В том же списке должны быть views (помечены как "View"):
     - `vw_job_metrics`
     - `vw_daily_metrics`
     - `vw_monthly_metrics`

## Шаг 4: Пересинхронизация схемы (если views не видны)

Если после подключения views не отображаются:

1. **Перейдите в настройки базы данных**:
   - Admin → Databases → `ABC Metrics Business DB`

2. **Нажмите "Sync database schema now"**:
   - Это принудительно обновит список таблиц и views

3. **Дождитесь завершения синхронизации**:
   - Обычно занимает несколько секунд
   - После завершения views должны появиться

## Шаг 5: Обновление дашбордов

После того как views видны в Metabase:

1. **Откройте существующие дашборды**:
   - Monthly Metrics Dashboard
   - Daily Cumulative Dashboard

2. **Проверьте вопросы (questions)**:
   - Каждый вопрос должен использовать правильную базу данных (`ABC Metrics Business DB`)
   - Если вопросы используют старую базу данных, их нужно обновить

3. **Обновление вопросов (если нужно)**:
   - Откройте вопрос
   - Нажмите **Edit**
   - В настройках запроса выберите правильную базу данных: `ABC Metrics Business DB`
   - Сохраните изменения

## Шаг 6: Проверка данных

1. **Создайте тестовый вопрос**:
   - Нажмите **New** → **Question**
   - Выберите `ABC Metrics Business DB`
   - Выберите `vw_monthly_metrics` (view)
   - Нажмите **Visualize**
   - Должны отобразиться данные (если они есть в БД)

2. **Проверьте SQL запрос**:
   - Создайте новый вопрос с типом **Native query**
   - Выберите `ABC Metrics Business DB`
   - Выполните запрос:
     ```sql
     SELECT * FROM vw_monthly_metrics LIMIT 10;
     ```
   - Должны отобразиться данные или пустой результат (если данных нет)

## Устранение проблем

### Проблема: "Connection refused" или "Cannot connect"

**Решение**:
- Проверьте, что база данных `abc-metrics-db` запущена: `flyctl status -a abc-metrics-db`
- Убедитесь, что используете правильный хост и порт
- Проверьте, что SSL включен

### Проблема: "Authentication failed"

**Решение**:
- Проверьте правильность username и password
- Убедитесь, что используете те же учетные данные, что и в `DATABASE_URL`

### Проблема: Views не видны после подключения

**Решение**:
1. Убедитесь, что views созданы в базе данных:
   ```sql
   SELECT table_name 
   FROM information_schema.views 
   WHERE table_schema = 'public' 
     AND table_name IN ('vw_daily_metrics', 'vw_monthly_metrics', 'vw_job_metrics');
   ```

2. Если views не существуют, выполните миграции:
   ```bash
   flyctl ssh console -a abc-metrics
   cd /app
   npm run migrate
   ```

3. После создания views пересинхронизируйте схему в Metabase

### Проблема: Видите только системные таблицы Metabase, нет бизнес-таблиц

**Симптомы**: 
- Видите таблицы типа `Action`, `Api Key`, `Audit Log`, `Collection`, `Core User`, `Metabase Database`, `Permissions`, `Query`, `Report Dashboard` и т.д.
- НЕ видите `fact_leads`, `fact_jobs`, `fact_payments`, `dim_source`, `dim_date`, `kpi_targets`

**Причина**: Миграции не выполнены! Бизнес-таблицы не созданы в базе данных.

**Решение**:
1. **Выполните миграции** (см. Шаг 0):
   ```bash
   flyctl ssh console -a abc-metrics
   cd /app
   npm run migrate
   ```

2. **Проверьте, что таблицы созданы**:
   ```bash
   # На сервере
   node -e "const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});p.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'fact_%' OR table_name LIKE 'dim_%' OR table_name LIKE 'kpi_%' ORDER BY table_name\").then(r=>{console.log('Business tables:',r.rows.map(x=>x.table_name).join(', ')||'NONE');p.end();}).catch(e=>{console.error('Error:',e.message);p.end();});"
   ```

3. **Пересинхронизируйте схему** в Metabase:
   - Admin → Databases → `ABC Metrics Business DB` → "Sync database schema now"

4. **После синхронизации** вы должны увидеть бизнес-таблицы в списке

## Параметры подключения (для справки)

**⚠️ ВАЖНО**: Эти параметры могут измениться! Всегда получайте актуальные значения из `DATABASE_URL` приложения `abc-metrics` (см. Шаг 1).

Пример параметров (замените на актуальные):
```
Host: pgbouncer.9g6y30w2qg60v5ml.flympg.net
Port: 5432
Database: fly-db
Username: fly-user
Password: [получите из DATABASE_URL]
SSL: Required
```

**Как получить актуальные параметры**:
```bash
# Получить DATABASE_URL
flyctl ssh console -a abc-metrics -C "printenv DATABASE_URL" | grep "^postgresql://"

# Извлечь параметры из строки:
# postgresql://username:password@host:port/database?sslmode=require
```

**Примечание**: 
- Это та же база данных, что использует Metabase для системных таблиц
- После выполнения миграций в ней будут и системные таблицы Metabase, и бизнес-таблицы
- Это нормально! Используйте бизнес-таблицы (`fact_*`, `dim_*`, `kpi_*`, views) для создания вопросов
- Системные таблицы Metabase можно игнорировать

## Дополнительные ресурсы

- [Metabase Database Connection Guide](https://www.metabase.com/docs/latest/configuring-metabase/connecting-to-a-database)
- [PostgreSQL Connection Settings](https://www.metabase.com/docs/latest/configuring-metabase/connecting-to-a-database/postgresql)

