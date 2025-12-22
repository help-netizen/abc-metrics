# Требования проекта ABC Metrics

Документ описывает все функции проекта, их статус и место реализации.

**Важно для агентов:** Перед любыми изменениями кода обязательно ознакомьтесь с этим документом.

## Легенда статусов

- ✅ **Реализовано** - функция полностью реализована и работает
- ⚠️ **Частично** - функция реализована, но есть ограничения или требует доработки
- ❌ **Не реализовано** - функция запланирована, но не реализована

---

## F001-F010: Синхронизация данных из внешних источников

### F001: Синхронизация Jobs из Workiz API
- **ID:** F001
- **Статус:** ✅ Реализовано
- **Описание:** Автоматическая синхронизация заявок (jobs) из Workiz API с сохранением в БД
- **Реализация:**
  - `src/services/svc-workiz-jobs.ts` - класс `SvcWorkizJobs`
  - Методы: `fetchJobs()`, `saveJobs()`, `syncJobs()`
  - Расписание: каждый час (00:00) через `src/scheduler.ts`
- **Детали:**
  - Использует Workiz API endpoint: `GET /api/v1/{API_KEY}/jobs`
  - Сохраняет в таблицы: `fact_jobs`, `jobs` (legacy)
  - Период синхронизации: последние 30 дней
  - Поддерживает фильтрацию: `start_date`, `end_date`, `only_open`
  - Сохраняет дополнительные поля: SerialId, TechnicianName (из Team[0].Name), JobAmountDue, JobTotalPrice, JobEndDateTime, LastStatusUpdate
  - Веб-интерфейс (`/table.html?name=fact_jobs`) отображает все поля кроме created_at и scheduled_at (скрыты, но остаются в БД для агрегаций)

### F002: Синхронизация Leads из Workiz API
- **ID:** F002
- **Статус:** ✅ Реализовано
- **Описание:** Автоматическая синхронизация лидов из Workiz API (Pro Referral, Google, Website и др.)
- **Реализация:**
  - `src/services/svc-workiz-leads.ts` - класс `SvcWorkizLeads`
  - Методы: `fetchLeads()`, `saveLeads()`, `syncLeads()`
  - Расписание: каждый час (00:05) через `src/scheduler.ts`
- **Детали:**
  - Использует Workiz API endpoint: `GET /api/v1/{API_KEY}/leads`
  - Сохраняет в таблицы: `fact_leads`
  - Поддерживает все источники: Pro Referral, Google, Website и др.

### F003: Синхронизация Payments из Workiz API
- **ID:** F003
- **Статус:** ✅ Реализовано
- **Описание:** Автоматическая синхронизация платежей из Workiz API
- **Реализация:**
  - `src/services/svc-workiz-payments.ts` - класс `SvcWorkizPayments`
  - Методы: `fetchPayments()`, `savePayments()`, `syncPayments()`
  - Расписание: каждый час (00:10) через `src/scheduler.ts`
- **Детали:**
  - Использует Workiz API endpoint: `GET /api/v1/{API_KEY}/payments`
  - Сохраняет в таблицы: `fact_payments`, `payments` (legacy)
  - Связывается с jobs через `job_id`

### F004: Синхронизация Calls из Workiz API
- **ID:** F004
- **Статус:** ❌ Не реализовано
- **Описание:** Синхронизация звонков из Workiz API (опциональная функция)
- **Реализация:** Отсутствует
- **Заметки:**
  - Запланирована в `src/scheduler.ts:59-63` (закомментирована)
  - Требуется создать `src/services/svc-workiz-calls.ts`
  - Расписание: каждые 6 часов (опционально)

### F005: Синхронизация Calls из Elocal.com
- **ID:** F005
- **Статус:** ✅ Реализовано
- **Описание:** Автоматическая синхронизация звонков из elocal.com через Puppeteer (веб-скрапинг)
- **Реализация:**
  - `src/services/svc-elocal-calls.ts` - класс `SvcElocalCalls`
  - Методы: `syncCalls()`, `fetchCallsCsv()`, `parseCallsCsv()`, `saveCalls()`, `authenticate()`
  - Расписание: каждый день в 4:00 AM через `src/scheduler.ts`
- **Детали:**
  - Использует Puppeteer для автоматизации браузера (нет публичного API)
  - Период синхронизации: последние 30 дней (исключая сегодня)
  - Сохраняет в таблицу: `calls`
  - Хранит credentials в переменных окружения: `ELOCAL_USERNAME`, `ELOCAL_PASSWORD`

### F006: Обработка CSV файлов
- **ID:** F006
- **Статус:** ✅ Реализовано
- **Описание:** Автоматическая обработка CSV файлов из указанной директории
- **Реализация:**
  - `src/services/csv.service.ts` - класс `CsvService`
  - Методы: `processCsvFiles()`, `processCsvFile()`, `loadCsvFile()`, `saveRecords()`
  - Расписание: каждые 6 часов через `src/scheduler.ts`
- **Детали:**
  - Определяет тип таблицы по имени файла (job, payment, call, elocal, proref, google/spend)
  - Сохраняет в соответствующие таблицы: `jobs`, `payments`, `calls`, `elocals_leads`, `google_spend`
  - Директория настраивается через `CSV_DIRECTORY` env var

---

## F011-F015: Агрегация метрик

### F011: Агрегация ежедневных метрик
- **ID:** F011
- **Статус:** ✅ Реализовано
- **Описание:** Расчет агрегированных метрик по дням (leads, units, repairs, revenue, cost и др.)
- **Реализация:**
  - `src/services/aggregation.service.ts` - метод `aggregateDailyMetrics()`
  - Расписание: каждый день в 1:00 AM через `src/scheduler.ts`
- **Детали:**
  - Агрегирует по комбинациям: date, source, segment
  - Сохраняет в таблицу: `daily_metrics`
  - Метрики: leads, units, repairs, revenue_gross, revenue40, cost, profit, calls, google_spend, cpl, conv_l_to_r

### F012: Агрегация месячных метрик
- **ID:** F012
- **Статус:** ✅ Реализовано
- **Описание:** Расчет агрегированных метрик по месяцам
- **Реализация:**
  - `src/services/aggregation.service.ts` - метод `aggregateMonthlyMetrics()`
  - Расписание: 1-го числа каждого месяца в 2:00 AM через `src/scheduler.ts`
- **Детали:**
  - Агрегирует по комбинациям: month, source, segment
  - Сохраняет в таблицу: `monthly_metrics`
  - Метрики: аналогично daily_metrics

### F013: Полная переагрегация всех метрик
- **ID:** F013
- **Статус:** ✅ Реализовано
- **Описание:** Пересчет всех ежедневных и месячных метрик (для исправления данных)
- **Реализация:**
  - `src/services/aggregation.service.ts` - методы `aggregateAllDailyMetrics()`, `aggregateAllMonthlyMetrics()`
  - Расписание: каждый день в 3:00 AM через `src/scheduler.ts`
- **Детали:**
  - Пересчитывает все метрики с начала данных
  - Используется для коррекции данных после изменений в исходных данных

### F014: Использование VIEW для расчетов метрик
- **ID:** F014
- **Статус:** ✅ Реализовано
- **Описание:** Использование SQL VIEW для упрощения расчетов Units/Repairs/Revenue
- **Реализация:**
  - `src/db/migrate.ts` - создание VIEW: `vw_job_metrics`, `vw_daily_metrics`, `vw_monthly_metrics`
- **Детали:**
  - `vw_job_metrics`: определяет is_unit, is_repair, gross_revenue, net_revenue для каждого job
  - `vw_daily_metrics`: агрегирует метрики по дням
  - `vw_monthly_metrics`: агрегирует метрики по месяцам

---

## F016-F020: REST API Endpoints

### F016: API для получения метрик
- **ID:** F016
- **Статус:** ✅ Реализовано
- **Описание:** REST API endpoints для получения агрегированных метрик
- **Реализация:**
  - `src/api/routes.ts` - endpoints: `/api/metrics/daily`, `/api/metrics/monthly`
- **Детали:**
  - Параметры: `start_date`, `end_date`, `start_month`, `end_month`, `source`, `segment`, `limit`
  - Возвращает данные из таблиц: `daily_metrics`, `monthly_metrics`

### F017: API для получения исходных данных
- **ID:** F017
- **Статус:** ✅ Реализовано
- **Описание:** REST API endpoints для получения исходных данных (jobs, payments, calls, leads)
- **Реализация:**
  - `src/api/routes.ts` - endpoints:
    - `/api/jobs` - заявки
    - `/api/payments` - платежи
    - `/api/calls` - звонки
    - `/api/leads` - лиды (универсальный)
    - `/api/leads/elocals` - лиды из eLocals
    - `/api/google-spend` - расходы на Google Ads
    - `/api/targets` - целевые значения
- **Детали:**
  - Параметры: `start_date`, `end_date`, `source`, `status`, `include_raw`, `limit`
  - Поддержка пагинации и фильтрации

### F018: Тестовые API endpoints для Workiz
- **ID:** F018
- **Статус:** ✅ Реализовано
- **Описание:** Тестовые endpoints для отладки синхронизации Workiz
- **Реализация:**
  - `src/api/routes.ts` - endpoints:
    - `GET /api/test/workiz/jobs` - получить jobs без сохранения
    - `GET /api/test/workiz/jobs/:uuid` - ⚠️ не реализовано (TODO)
    - `POST /api/test/workiz/jobs/sync` - ручная синхронизация jobs
    - `POST /api/test/workiz/jobs/sync-full` - полная синхронизация jobs
    - Аналогично для leads и payments
- **Детали:**
  - Используются для отладки и ручного запуска синхронизации
  - Возвращают raw_data для анализа структуры данных

### F019: Тестовые API endpoints для Elocal Calls
- **ID:** F019
- **Статус:** ✅ Реализовано
- **Описание:** Тестовые endpoints для отладки синхронизации Elocal Calls
- **Реализация:**
  - `src/api/routes.ts` - endpoints:
    - `POST /api/test/elocal/calls/auth` - тест аутентификации
    - `GET /api/test/elocal/calls` - получить calls без сохранения
    - `GET /api/calls/elocal` - извлечение данных из elocal.com (без сохранения в БД)
- **Детали:**
  - Позволяют тестировать аутентификацию и загрузку CSV без сохранения в БД
  - Endpoint `GET /api/calls/elocal` извлекает данные из elocal.com и возвращает их через API
  - Процесс: `fetchCallsCsv()` → `parseCallsCsv()` → `closeBrowser()` → возврат JSON
  - Браузер закрывается сразу после извлечения данных

### F020: Web интерфейс для просмотра БД
- **ID:** F020
- **Статус:** ✅ Реализовано
- **Описание:** Endpoints для просмотра структуры БД через веб-интерфейс
- **Реализация:**
  - `src/api/routes.ts` - endpoints (определены ПЕРЕД монтированием dbRoutes):
    - `GET /api/tables` - список таблиц с количеством строк (публичный доступ)
    - `GET /api/table/:tableName` - данные таблицы с пагинацией (публичный доступ)
  - `public/index.html`, `public/app.js` - веб-интерфейс
- **Детали:**
  - Позволяет просматривать данные БД через браузер
  - Поддержка пагинации (до 1000 строк за запрос)
  - Клиентская сортировка по столбцам при клике на заголовок
  - Визуальные индикаторы направления сортировки (↑↓)
  - Поддержка сортировки разных типов данных (числа, даты, строки, NULL)
  - Публичный доступ без аутентификации (endpoints определены перед dbRoutes)
  - DB API endpoints (`/api/db/*`) остаются защищенными аутентификацией

---

## F021-F025: Scheduler и планирование задач

### F021: Планировщик cron задач
- **ID:** F021
- **Статус:** ✅ Реализовано
- **Описание:** Автоматический запуск задач по расписанию
- **Реализация:**
  - `src/scheduler.ts` - класс `Scheduler`
  - Использует библиотеку `node-cron`
- **Детали:**
  - Запускается при старте приложения
  - Управляет всеми автоматическими синхронизациями и агрегациями

### F022: Автоматические задачи синхронизации
- **ID:** F022
- **Статус:** ✅ Реализовано (частично для calls)
- **Описание:** Расписание для синхронизации данных из внешних источников
- **Реализация:**
  - `src/scheduler.ts` - методы `start()`, cron расписания
- **Расписание:**
  - Jobs: каждый час (00:00)
  - Leads: каждый час (00:05)
  - Payments: каждый час (00:10)
  - Elocal Calls: каждый день в 4:00 AM
  - CSV Processing: каждые 6 часов (00:00, 06:00, 12:00, 18:00)
  - Workiz Calls: ❌ не реализовано (закомментировано)

### F023: Автоматические задачи агрегации
- **ID:** F023
- **Статус:** ✅ Реализовано
- **Описание:** Расписание для агрегации метрик
- **Реализация:**
  - `src/scheduler.ts` - cron расписания для агрегации
- **Расписание:**
  - Daily Aggregation: каждый день в 1:00 AM
  - Monthly Aggregation: 1-го числа месяца в 2:00 AM
  - Full Re-aggregation: каждый день в 3:00 AM

---

## F026-F030: База данных и миграции

### F026: Подключение к PostgreSQL
- **ID:** F026
- **Статус:** ✅ Реализовано
- **Описание:** Управление подключением к базе данных PostgreSQL
- **Реализация:**
  - `src/db/connection.ts` - экспорт pool подключений
- **Детали:**
  - Использует библиотеку `pg` (node-postgres)
  - Настройка через `DATABASE_URL` env var
  - Graceful shutdown при SIGTERM/SIGINT

### F027: Миграции базы данных
- **ID:** F027
- **Статус:** ✅ Реализовано
- **Описание:** Автоматическое создание и обновление структуры БД
- **Реализация:**
  - `src/db/migrate.ts` - функция `migrate()`
  - Запускается автоматически при старте приложения
- **Детали:**
  - Создает все таблицы (fact/dim и legacy)
  - Создает индексы для оптимизации
  - Создает VIEW для расчетов метрик
  - Использует транзакции (BEGIN/COMMIT/ROLLBACK)

### F028: Star Schema (Fact/Dim таблицы)
- **ID:** F028
- **Статус:** ✅ Реализовано
- **Описание:** Нормализованная схема данных с факт-таблицами и справочниками
- **Реализация:**
  - `src/db/migrate.ts` - создание fact/dim таблиц
- **Таблицы:**
  - Dimensions: `dim_source`, `dim_date`
  - Facts: `fact_leads`, `fact_jobs`, `fact_payments`
- **Детали:**
  - Справочник источников (`dim_source`): elocals, google, rely, nsa, liberty, retention, pro_referral, website, workiz
  - Справочник дат (`dim_date`): для джойнов и агрегаций

### F029: Legacy таблицы для обратной совместимости
- **ID:** F029
- **Статус:** ✅ Реализовано
- **Описание:** Старые таблицы сохранены для обратной совместимости
- **Реализация:**
  - `src/db/migrate.ts` - создание legacy таблиц
- **Таблицы:**
  - `jobs`, `payments`, `calls`, `elocals_leads`, `leads`, `google_spend`
  - `daily_metrics`, `monthly_metrics`, `targets`

---

## F031-F035: Дополнительные функции

### F031: Health Check endpoint
- **ID:** F031
- **Статус:** ✅ Реализовано
- **Описание:** Endpoint для проверки работоспособности API и БД
- **Реализация:**
  - `src/api/routes.ts` - `GET /api/health`
- **Детали:**
  - Проверяет подключение к БД
  - Возвращает статус: `{ status: 'ok', database: 'connected' }`

### F032: CORS поддержка
- **ID:** F032
- **Статус:** ✅ Реализовано
- **Описание:** Настройка CORS для доступа к API из браузера
- **Реализация:**
  - `src/metrics-collector.ts` - CORS middleware
- **Детали:**
  - Разрешает все origin (`*`)
  - Разрешает методы: GET, POST, PUT, DELETE, OPTIONS

### F033: Static files serving
- **ID:** F033
- **Статус:** ✅ Реализовано
- **Описание:** Отдача статических файлов (HTML, CSS, JS) для веб-интерфейса
- **Реализация:**
  - `src/metrics-collector.ts` - `app.use(express.static(...))`
  - `public/` - директория со статическими файлами
- **Детали:**
  - `index.html` - главная страница
  - `table.html` - просмотр таблиц БД
  - `app.js`, `style.css` - клиентский код

### F034: Graceful shutdown
- **ID:** F034
- **Статус:** ✅ Реализовано
- **Описание:** Корректное завершение работы приложения
- **Реализация:**
  - `src/metrics-collector.ts` - обработчики SIGTERM/SIGINT
- **Детали:**
  - Закрывает подключения к БД
  - Завершает процесс с кодом 0

---

## Ограничения и известные проблемы

1. **Workiz API не поддерживает end_date параметр**
   - При указании `end_date` в API запросах к Workiz, параметр игнорируется
   - API всегда возвращает данные с `start_date` до текущего момента

2. **Elocal Calls требует Puppeteer**
   - Нет публичного API, используется веб-скрапинг
   - Аутентификация занимает ~60-70 секунд
   - Требует больше ресурсов (память для браузера)

3. **Legacy таблицы поддерживаются параллельно с fact/dim**
   - Некоторые сервисы все еще пишут в legacy таблицы
   - Планируется миграция всех операций на fact/dim схему

### F052: Документация для агента rely-lead-processor
- **ID:** F052
- **Статус:** ✅ Реализовано
- **Описание:** Документация для агента, работающего с `rely-lead-processor`, описывающая работу с `abc-metrics` DB API и перенесенные эндпоинты синхронизации
- **Реализация:**
  - `docs/rely-lead-processor/abc-metrics-api-guide.md` - основной гайд по работе с API
  - `docs/rely-lead-processor/db-api-endpoints.md` - описание всех DB API эндпоинтов
  - `docs/rely-lead-processor/metrics-endpoints.md` - описание эндпоинтов metrics module
- **Детали:**
  - Документация должна описывать использование `AbcMetricsClient`
  - Документация должна содержать примеры запросов и ответов для всех эндпоинтов
  - Документация должна подчеркивать архитектурные принципы (нет прямых подключений к БД из rely-lead-processor)
  - Документация должна описывать настройку переменных окружения

---

## Не реализованные функции (будущие)

- Синхронизация Calls из Workiz API (F004)
- Синхронизация Clients из Workiz API
- Синхронизация Invoices из Workiz API
- Синхронизация Schedules из Workiz API
- Синхронизация Users из Workiz API
- Синхронизация Reports из Workiz API
- API endpoint для получения job/lead по UUID (F018 частично)

