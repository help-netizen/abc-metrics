# Настройка Workiz API

## Переменные окружения

### Обязательные

```bash
WORKIZ_API_KEY=api_scw87tvl56jom24qrph08ktc52ly3pti
```

**Описание:** API токен Workiz. Используется в URL: `https://api.workiz.com/api/v1/{WORKIZ_API_KEY}`

**Без него клиент выбрасывает ошибку при инициализации.**

### Опциональные

```bash
WORKIZ_API_SECRET=sec_1974068835629754589542939595
```

**Описание:** Секретный ключ для аутентификации. Используется в поле `auth_secret` при создании/обновлении лидов через API.

**Если не указан, используется `WORKIZ_API_KEY` как fallback.**

```bash
WORKIZ_API_URL=https://api.workiz.com
```

**Описание:** Базовый URL API. По умолчанию: `https://api.workiz.com`

**Можно переопределить для тестирования или другого окружения.**

## Установка переменных окружения

### Локальная разработка

Создайте файл `.env` в корне проекта:

```env
WORKIZ_API_KEY=api_scw87tvl56jom24qrph08ktc52ly3pti
WORKIZ_API_SECRET=sec_1974068835629754589542939595
WORKIZ_API_URL=https://api.workiz.com
```

### Fly.io

Установите переменные через flyctl:

```bash
flyctl secrets set WORKIZ_API_KEY="api_scw87tvl56jom24qrph08ktc52ly3pti" -a abc-metrics
flyctl secrets set WORKIZ_API_SECRET="sec_1974068835629754589542939595" -a abc-metrics
flyctl secrets set WORKIZ_API_URL="https://api.workiz.com" -a abc-metrics
```

Или установите все сразу:

```bash
flyctl secrets set \
  WORKIZ_API_KEY="api_scw87tvl56jom24qrph08ktc52ly3pti" \
  WORKIZ_API_SECRET="sec_1974068835629754589542939595" \
  WORKIZ_API_URL="https://api.workiz.com" \
  -a abc-metrics
```

## Формат API запросов

Workiz API использует следующий формат URL:

```
https://api.workiz.com/api/v1/{WORKIZ_API_KEY}/{endpoint}
```

### Примеры endpoints:

- **Jobs:** `GET /api/v1/{API_KEY}/jobs?start_date=2024-11-01&end_date=2024-11-30`
- **Leads:** `GET /api/v1/{API_KEY}/leads?start_date=2024-11-01&end_date=2024-11-30`
- **Payments:** `GET /api/v1/{API_KEY}/payments?start_date=2024-11-01&end_date=2024-11-30`
- **Calls:** `GET /api/v1/{API_KEY}/calls?start_date=2024-11-01&end_date=2024-11-30`

## Автоматическая синхронизация

Сервис автоматически синхронизирует данные из Workiz по расписанию:

- **Jobs:** каждый час в :00
- **Leads:** каждый час в :05
- **Payments:** каждый час в :10
- **Calls:** каждые 6 часов

## Проверка подключения

После установки переменных окружения, проверьте подключение:

```bash
# Локально
npm run dev

# На Fly.io
flyctl logs -a abc-metrics
```

В логах вы должны увидеть:
- `Starting scheduler...`
- `Running Workiz jobs sync...`
- `Saved X jobs from Workiz` (если есть данные)

## Обработка ошибок

Если `WORKIZ_API_KEY` не установлен, сервис выбросит ошибку при старте:

```
Error: WORKIZ_API_KEY is required
```

Если API ключ неверный, в логах будут ошибки вида:

```
Error fetching Workiz jobs: { status: 401, message: 'Unauthorized' }
```

## Безопасность

⚠️ **Важно:** Никогда не коммитьте API ключи в Git!

- Добавьте `.env` в `.gitignore`
- Используйте `flyctl secrets` для production
- Ротация ключей: если ключ скомпрометирован, создайте новый в Workiz и обновите переменные окружения

