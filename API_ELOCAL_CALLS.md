# API Documentation: Elocal Calls Extraction

## Endpoint Overview

**URL:** `/api/calls/elocal`  
**Method:** `GET`  
**Description:** Извлекает данные о звонках из elocal.com и возвращает их через API без сохранения в базу данных.

---

## Request Parameters

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_date` | string | No | Last 30 days | Начальная дата периода в формате `YYYY-MM-DD` |
| `end_date` | string | No | Yesterday | Конечная дата периода в формате `YYYY-MM-DD` |

**Примечания:**
- Если параметры не указаны, используется период: последние 30 дней (исключая текущий день)
- Оба параметра должны быть указаны вместе, либо оба не указаны
- Формат даты: `YYYY-MM-DD` (например, `2024-11-08`)

---

## Response Format

### Success Response

**Status Code:** `200 OK`

**Response Body:**
```json
{
  "success": true,
  "start_date": "2024-11-08",
  "end_date": "2024-12-07",
  "count": 165,
  "calls": [
    {
      "call_id": "32420419",
      "date": "2025-12-05",
      "duration": 143,
      "call_type": "Request Credit",
      "source": "elocals"
    },
    {
      "call_id": "32419351",
      "date": "2025-12-05",
      "duration": 233,
      "call_type": "Request Credit",
      "source": "elocals"
    }
  ]
}
```

### Error Response

**Status Code:** `500 Internal Server Error`

**Response Body:**
```json
{
  "success": false,
  "error": "Failed to authenticate with elocal.com",
  "details": "Error stack trace..."
}
```

---

## Data Structure

### Call Object

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `call_id` | string | Уникальный идентификатор звонка из elocal.com | `"32420419"` |
| `date` | string | Дата звонка в формате `YYYY-MM-DD` | `"2025-12-05"` |
| `duration` | number (optional) | Длительность звонка в секундах | `143` |
| `call_type` | string (optional) | Тип/статус звонка | `"Request Credit"` |
| `source` | string | Источник данных (всегда `"elocals"`) | `"elocals"` |

**Примечания:**
- `duration` конвертируется из формата `MM:SS` в секунды (например, `"02:23"` → `143`)
- `call_type` может быть `null` или отсутствовать для некоторых записей
- `date` нормализуется из различных форматов в стандартный `YYYY-MM-DD`

---

## Examples

### Example 1: Request with Date Range

**Request:**
```bash
curl -X GET "http://localhost:3001/api/calls/elocal?start_date=2024-11-01&end_date=2024-11-30"
```

**Response:**
```json
{
  "success": true,
  "start_date": "2024-11-01",
  "end_date": "2024-11-30",
  "count": 120,
  "calls": [...]
}
```

### Example 2: Request without Parameters (Default: Last 30 Days)

**Request:**
```bash
curl -X GET "http://localhost:3001/api/calls/elocal"
```

**Response:**
```json
{
  "success": true,
  "start_date": "2024-11-08",
  "end_date": "2024-12-07",
  "count": 165,
  "calls": [...]
}
```

### Example 3: JavaScript (Fetch API)

```javascript
// With date range
const response = await fetch('http://localhost:3001/api/calls/elocal?start_date=2024-11-01&end_date=2024-11-30');
const data = await response.json();

if (data.success) {
  console.log(`Found ${data.count} calls`);
  data.calls.forEach(call => {
    console.log(`Call ${call.call_id} on ${call.date}, duration: ${call.duration}s`);
  });
}

// Without parameters (default: last 30 days)
const defaultResponse = await fetch('http://localhost:3001/api/calls/elocal');
const defaultData = await defaultResponse.json();
```

### Example 4: Python (requests)

```python
import requests

# With date range
response = requests.get(
    'http://localhost:3001/api/calls/elocal',
    params={
        'start_date': '2024-11-01',
        'end_date': '2024-11-30'
    }
)
data = response.json()

if data['success']:
    print(f"Found {data['count']} calls")
    for call in data['calls']:
        print(f"Call {call['call_id']} on {call['date']}, duration: {call['duration']}s")

# Without parameters (default: last 30 days)
default_response = requests.get('http://localhost:3001/api/calls/elocal')
default_data = default_response.json()
```

### Example 5: Node.js (axios)

```javascript
const axios = require('axios');

// With date range
const response = await axios.get('http://localhost:3001/api/calls/elocal', {
  params: {
    start_date: '2024-11-01',
    end_date: '2024-11-30'
  }
});

if (response.data.success) {
  console.log(`Found ${response.data.count} calls`);
  response.data.calls.forEach(call => {
    console.log(`Call ${call.call_id} on ${call.date}`);
  });
}

// Without parameters (default: last 30 days)
const defaultResponse = await axios.get('http://localhost:3001/api/calls/elocal');
```

---

## Error Codes

| Status Code | Description | Possible Causes |
|-------------|-------------|-----------------|
| `200` | Success | Request completed successfully |
| `500` | Internal Server Error | Authentication failure, network error, parsing error |

### Common Error Messages

- `"Failed to authenticate with elocal.com"` - Ошибка аутентификации на elocal.com
- `"Received login page instead of CSV"` - Сессия истекла, требуется повторная аутентификация
- `"Received empty CSV response"` - Пустой ответ от elocal.com
- `"Failed to fetch CSV: ..."` - Ошибка сети или HTTP запроса

---

## Limitations and Notes

### Performance

- **Время выполнения:** ~60-80 секунд (зависит от количества данных и скорости сети)
- **Процесс:** Использует Puppeteer для автоматизации браузера, что требует времени на:
  - Запуск браузера (~5-10 секунд)
  - Аутентификацию (~60-70 секунд)
  - Загрузку CSV (~0.5-1 секунда)
  - Парсинг данных (~0.1 секунда)

### Rate Limiting

- Endpoint не имеет встроенного rate limiting
- Рекомендуется не делать более 1 запроса в минуту
- Одновременные запросы могут привести к конфликтам аутентификации

### Data Freshness

- Данные извлекаются в реальном времени из elocal.com
- Каждый запрос выполняет полный цикл: аутентификация → загрузка → парсинг
- Данные не кэшируются

### Authentication

- Endpoint использует учетные данные из переменных окружения:
  - `ELOCAL_USERNAME` (по умолчанию: `help@bostonmasters.com`)
  - `ELOCAL_PASSWORD` (по умолчанию: `Alga!B@r2`)
- Аутентификация выполняется автоматически при каждом запросе
- Сессии не сохраняются между запросами

### Browser Requirements

- Endpoint использует Puppeteer (headless Chrome)
- Требуется установленный Chrome/Chromium
- На macOS может быть предупреждение о производительности при использовании x64 Node.js

---

## Integration Notes

### Use Case

Этот endpoint предназначен для:
- Извлечения данных о звонках без сохранения в локальную БД
- Интеграции с внешними системами, которые сами сохраняют данные
- Получения актуальных данных в реальном времени

### Difference from `/api/calls`

- `/api/calls` - возвращает данные из локальной базы данных (быстро, но данные могут быть устаревшими)
- `/api/calls/elocal` - извлекает данные напрямую из elocal.com (медленнее, но всегда актуальные данные)

### Difference from `/api/test/elocal/calls/sync`

- `/api/test/elocal/calls/sync` - выполняет полную синхронизацию (извлечение + сохранение в БД)
- `/api/calls/elocal` - только извлечение без сохранения

---

## Testing

### Manual Testing

1. **Запустите сервер:**
   ```bash
   npm start
   # или
   npm run dev
   ```

2. **Протестируйте endpoint:**
   ```bash
   # С параметрами дат
   curl -X GET "http://localhost:3001/api/calls/elocal?start_date=2024-11-01&end_date=2024-11-30"
   
   # Без параметров (дефолтные 30 дней)
   curl -X GET "http://localhost:3001/api/calls/elocal"
   ```

3. **Проверьте ответ:**
   - Убедитесь, что `success: true`
   - Проверьте, что `calls` содержит массив объектов
   - Убедитесь, что структура данных соответствует документации

---

## Support

При возникновении проблем:
1. Проверьте логи сервера на наличие ошибок
2. Убедитесь, что переменные окружения `ELOCAL_USERNAME` и `ELOCAL_PASSWORD` установлены
3. Проверьте доступность elocal.com
4. Убедитесь, что Puppeteer установлен и Chrome доступен

