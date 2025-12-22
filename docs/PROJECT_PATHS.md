# Пути проекта rely-lead-processor

Документация с информацией о всех путях и расположении компонентов проекта rely-lead-processor.

---

## Локальный путь на компьютере

**Абсолютный путь:**
```
/Users/rgareev91/Downloads/prices
```

**Навигация:**
```bash
cd /Users/rgareev91/Downloads/prices
```

---

## Git репозиторий

**URL репозитория:**
```
https://github.com/help-netizen/rely-lead-processor.git
```

**Ветка по умолчанию:**
- `main`

**Клонирование репозитория:**
```bash
git clone https://github.com/help-netizen/rely-lead-processor.git
cd rely-lead-processor
```

---

## Развертывание (Fly.io)

### Приложение

- **Название приложения:** `rely-lead-processor`
- **URL приложения:** `https://rely-lead-processor.fly.dev`
- **Регион развертывания:** `iad` (Washington, D.C., USA)
- **Health check:** `https://rely-lead-processor.fly.dev/health`

### Конфигурация

- **Файл конфигурации:** `fly.toml` (в корне проекта)
- **Внутренний порт:** `3000`
- **Протокол:** HTTP/HTTPS
- **Минимальное количество машин:** `1`
- **CPU:** 1 shared CPU
- **Память:** 2048 MB
- **Процесс:** `node dist/server.js`

### Endpoints

**Основные API endpoints:**
- Health check: `GET https://rely-lead-processor.fly.dev/health`
- Rate Me API: `https://rely-lead-processor.fly.dev/api/rate/*`
- RELY Lead Processing: `POST https://rely-lead-processor.fly.dev/api/process-rely-lead`
- Telegram Webhook: `POST https://rely-lead-processor.fly.dev/api/telegram/webhook`

### Мониторинг

- **Логи:** Доступны через `flyctl logs --app rely-lead-processor`
- **Мониторинг:** https://fly.io/apps/rely-lead-processor/monitoring
- **SSH доступ:** `flyctl ssh console --app rely-lead-processor`

### Persistent Storage

- **Volume:** `gmail_data`
- **Путь в контейнере:** `/data`
- **Назначение:** Хранение Gmail history ID и настроек Telegram
- **Регион:** `iad`
- **Размер:** 1 GB

---

## Структура проекта

```
/Users/rgareev91/Downloads/prices/
│
├── src/                          # Исходный код (TypeScript)
│   ├── server.ts                # Точка входа приложения
│   ├── config/                  # Конфигурация
│   │   └── env.ts              # Загрузка переменных окружения
│   ├── core/                    # Основная логика
│   │   ├── normalizeLead.ts    # Нормализация лидов
│   │   └── validator.ts        # Валидация данных
│   ├── integrations/            # Внешние интеграции
│   │   ├── dbAppClient.ts      # Клиент БД-приложения
│   │   ├── gmailClient.ts      # Gmail API клиент
│   │   ├── redisClient.ts      # Redis клиент
│   │   ├── telegramClient.ts   # Telegram бот
│   │   ├── twilioClient.ts     # Twilio интеграция
│   │   └── workizClient.ts     # Workiz CRM API
│   ├── rate-me/                 # Rate Me система
│   │   ├── routes/             # API endpoints для Rate Me
│   │   ├── services/           # Бизнес-логика Rate Me
│   │   ├── middleware/         # Middleware для Rate Me
│   │   └── jobToken.ts         # Генерация JWT токенов
│   ├── routes/                  # Основные API endpoints
│   │   ├── health.ts           # Health check
│   │   ├── processRelyLead.ts  # Обработка RELY лидов
│   │   └── ...
│   ├── services/                # Бизнес-логика
│   │   ├── emailParser.ts      # Парсинг email
│   │   ├── leadProcessor.ts    # Обработка лидов
│   │   └── ...
│   ├── sources/                 # Источники данных
│   │   ├── relyParser.ts       # Парсер RELY писем
│   │   └── ...
│   ├── telegram/                # Telegram бот
│   ├── types/                   # TypeScript типы
│   ├── utils/                   # Утилиты
│   │   ├── logger.ts           # Логирование
│   │   └── validator.ts        # Валидаторы
│   ├── web/                     # Web интерфейс
│   └── workers/                 # Фоновые задачи
│
├── docs/                        # Документация
│   ├── requirements.md         # Требования проекта
│   ├── architecture.md         # Архитектура системы
│   ├── tasks.md               # Список задач
│   ├── changelog.md           # История изменений
│   ├── agents/                # Инструкции для агентов
│   │   ├── agent-orchestrator.md
│   │   ├── agent-07-deployer.md
│   │   └── ...
│   ├── api/                   # API документация
│   ├── rate-me/               # Rate Me документация
│   │   ├── RATE_ME_API_DOCS.md
│   │   ├── ENV_SETUP_RATE_ME.md
│   │   ├── REDIS_CACHING_STRATEGY.md
│   │   └── ...
│   └── PROJECT_PATHS.md       # Этот файл
│
├── tests/                       # Тесты
│   ├── core/                  # Тесты основной логики
│   ├── integrations/          # Тесты интеграций
│   ├── sources/               # Тесты парсеров
│   └── utils/                 # Тесты утилит
│
├── public/                     # Статические файлы
│   ├── contact-form.html      # Форма обратной связи
│   └── zip-codes-admin.html   # Админка ZIP кодов
│
├── scripts/                    # Вспомогательные скрипты
│   └── import-zip-codes-from-excel.ts
│
├── fixtures/                   # Тестовые данные
│   └── *.eml, *.mhtml         # Примеры писем
│
├── pipedream_steps/            # Экспортированные компоненты Pipedream
│   ├── *.js                   # Компоненты workflow
│   └── *.json                 # Конфигурация компонентов
│
├── fly.toml                    # Конфигурация Fly.io
├── Dockerfile                  # Docker образ
├── package.json                # Зависимости и скрипты
├── tsconfig.json               # TypeScript конфигурация
├── README.md                   # Основная документация
├── .gitignore                  # Игнорируемые файлы Git
└── env.example                 # Пример переменных окружения
```

---

## Полезные команды

### Навигация по проекту

```bash
# Переход в директорию проекта
cd /Users/rgareev91/Downloads/prices

# Просмотр структуры проекта
tree -L 2 -I 'node_modules|dist'

# Поиск файлов
find . -name "*.ts" -type f
```

### Git операции

```bash
# Проверка статуса
git status

# Просмотр изменений
git diff

# Просмотр истории коммитов
git log --oneline

# Проверка remote репозиториев
git remote -v

# Получение последних изменений
git pull origin main

# Создание коммита
git add .
git commit -m "Описание изменений"

# Push изменений
git push origin main
```

### NPM скрипты

```bash
# Разработка (с hot reload)
npm run dev

# Сборка проекта
npm run build

# Запуск в production
npm start

# Проверка типов
npm run type-check

# Линтинг
npm run lint

# Тесты
npm run test:parser          # Тесты парсера
npm run test:workiz          # Тесты Workiz интеграции
npm run test:normalize       # Тесты нормализации
npm run test:validator       # Тесты валидаторов
```

### Fly.io операции

```bash
# Деплой приложения
npm run fly:deploy
# или
~/.fly/bin/flyctl deploy --app rely-lead-processor

# Просмотр логов
npm run fly:logs
# или
~/.fly/bin/flyctl logs --app rely-lead-processor

# SSH подключение к контейнеру
npm run fly:ssh
# или
~/.fly/bin/flyctl ssh console --app rely-lead-processor

# Статус приложения
~/.fly/bin/flyctl status --app rely-lead-processor

# Управление секретами
~/.fly/bin/flyctl secrets list --app rely-lead-processor
~/.fly/bin/flyctl secrets set KEY=value --app rely-lead-processor
~/.fly/bin/flyctl secrets unset KEY --app rely-lead-processor

# Перезапуск приложения
~/.fly/bin/flyctl apps restart --app rely-lead-processor

# Мониторинг
~/.fly/bin/flyctl monitor --app rely-lead-processor
```

### Работа с переменными окружения

```bash
# Просмотр всех секретов
~/.fly/bin/flyctl secrets list --app rely-lead-processor

# Установка секрета
~/.fly/bin/flyctl secrets set VARIABLE_NAME="value" --app rely-lead-processor

# Удаление секрета
~/.fly/bin/flyctl secrets unset VARIABLE_NAME --app rely-lead-processor
```

---

## Переменные окружения

### Конфигурация

Все переменные окружения загружаются через `src/config/env.ts`. См. файл для полного списка доступных переменных.

### Основные переменные

**Для Rate Me:**
- `RATE_ME_API_URL` / `DB_APP_API_URL` - URL БД-приложения API
- `RATE_ME_API_KEY` / `DB_APP_API_KEY` - API ключ для БД-приложения
- `JOB_TOKEN_SECRET` - Секрет для подписи JWT токенов (должен совпадать с БД-приложением)

**Для Workiz:**
- `WORKIZ_API_URL` - URL Workiz API
- `WORKIZ_API_KEY` - API ключ Workiz
- `WORKIZ_API_SECRET` - API секрет Workiz

**Для Gmail:**
- `GMAIL_CLIENT_ID` - OAuth2 Client ID
- `GMAIL_CLIENT_SECRET` - OAuth2 Client Secret
- `GMAIL_REFRESH_TOKEN` - Refresh Token

**Для Redis:**
- `REDIS_URL` - URL подключения к Redis

**Для Telegram:**
- `TELEGRAM_BOT_TOKEN` - Токен Telegram бота
- `TELEGRAM_CHAT_ID` - ID чата для уведомлений

**Для сервера:**
- `API_KEY` - API ключ для внутренних запросов
- `PORT` - Порт сервера (по умолчанию 3000)
- `NODE_ENV` - Окружение (development/production/test)

### Управление секретами в Fly.io

Секреты хранятся в Fly.io и автоматически доступны как переменные окружения в контейнере. После установки секрета приложение автоматически перезапускается.

**Пример установки:**
```bash
# Установка RATE_ME_API_URL
~/.fly/bin/flyctl secrets set RATE_ME_API_URL="https://abc-metrics.fly.dev/api/v1" --app rely-lead-processor

# Установка API ключа
~/.fly/bin/flyctl secrets set RATE_ME_API_KEY="your-api-key" --app rely-lead-processor

# Установка JOB_TOKEN_SECRET
~/.fly/bin/flyctl secrets set JOB_TOKEN_SECRET="your-secret-key" --app rely-lead-processor
```

**Важно:** `JOB_TOKEN_SECRET` должен совпадать в обоих приложениях (Rate Me и БД-приложение).

Подробнее см. `docs/rate-me/ENV_SETUP_RATE_ME.md`.

---

## Связанная документация

### Основная документация
- [README.md](../README.md) - Обзор проекта и быстрый старт
- [docs/requirements.md](requirements.md) - Требования к проекту
- [docs/architecture.md](architecture.md) - Архитектура системы
- [docs/tasks.md](tasks.md) - Список задач проекта
- [docs/changelog.md](changelog.md) - История изменений

### Rate Me документация
- [docs/rate-me/RATE_ME_API_DOCS.md](rate-me/RATE_ME_API_DOCS.md) - Документация Rate Me API
- [docs/rate-me/ENV_SETUP_RATE_ME.md](rate-me/ENV_SETUP_RATE_ME.md) - Настройка переменных окружения
- [docs/rate-me/REDIS_CACHING_STRATEGY.md](rate-me/REDIS_CACHING_STRATEGY.md) - Стратегия кэширования Redis
- [docs/requirements-db-app.md](requirements-db-app.md) - Требования к БД-приложению

### Настройка и деплой
- [docs/agents/agent-07-deployer.md](agents/agent-07-deployer.md) - Инструкции для деплоя
- [FLY_SETUP_GUIDE.md](../FLY_SETUP_GUIDE.md) - Руководство по настройке Fly.io
- [docs/VERCEL_SETUP.md](VERCEL_SETUP.md) - Настройка Vercel

### API документация
- [docs/api/](../api/) - Документация API endpoints

---

## Контакты и поддержка

- **Репозиторий:** https://github.com/help-netizen/rely-lead-processor
- **Приложение:** https://rely-lead-processor.fly.dev
- **Мониторинг:** https://fly.io/apps/rely-lead-processor/monitoring

---

**Дата создания:** 2025-12-10  
**Последнее обновление:** 2025-12-10  
**Версия:** 1.0

