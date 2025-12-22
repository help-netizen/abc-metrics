# Примеры интеграции модуля метрик

## Пример 1: Express.js приложение

```typescript
// src/app.ts или src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import metricsModule from './metrics'; // <-- Импорт модуля метрик

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Ваши существующие routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Интеграция routes модуля метрик
app.use('/api/metrics', metricsModule.routes); // <-- Добавить эту строку

// Обработка ошибок
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Запуск планировщика метрик
  metricsModule.scheduler.start(); // <-- Добавить эту строку
});
```

## Пример 2: Приложение с отдельным server.ts

```typescript
// src/server.ts
import express from 'express';
import { createServer } from 'http';
import metricsModule from './metrics';

const app = express();
const server = createServer(app);

// ... настройка app ...

// Интеграция routes модуля метрик
app.use('/api/metrics', metricsModule.routes);

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Запуск планировщика метрик
  metricsModule.scheduler.start();
});
```

## Пример 3: Приложение с async/await инициализацией

```typescript
// src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import metricsModule from './metrics';

dotenv.config();

async function startServer() {
  const app = express();
  
  // Middleware
  app.use(express.json());
  
  // Ваши routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  
  // Интеграция routes модуля метрик
  app.use('/api/metrics', metricsModule.routes);
  
  // Запуск сервера
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Запуск планировщика метрик
    metricsModule.scheduler.start();
  });
}

startServer().catch(console.error);
```

## Пример 4: Приложение с условием запуска планировщика

```typescript
// src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import metricsModule from './metrics';

dotenv.config();

const app = express();

// ... настройка app ...

// Интеграция routes модуля метрик
app.use('/api/metrics', metricsModule.routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Запуск планировщика только если не в тестовом режиме
  if (process.env.NODE_ENV !== 'test') {
    metricsModule.scheduler.start();
  }
});
```

## Пример 5: Приложение с graceful shutdown

```typescript
// src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import metricsModule from './metrics';

dotenv.config();

const app = express();

// ... настройка app ...

// Интеграция routes модуля метрик
app.use('/api/metrics', metricsModule.routes);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Запуск планировщика метрик
  metricsModule.scheduler.start();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    // Планировщик остановится автоматически при завершении процесса
  });
});
```

## Пример 6: Минимальная интеграция (только routes)

Если вы не хотите запускать планировщик автоматически:

```typescript
// src/index.ts
import express from 'express';
import metricsModule from './metrics';

const app = express();

// Интеграция routes модуля метрик (без планировщика)
app.use('/api/metrics', metricsModule.routes);

// Планировщик можно запустить вручную позже:
// metricsModule.scheduler.start();
```

## Проверка интеграции

После интеграции проверьте, что все работает:

```bash
# 1. Проверка компиляции
npm run build

# 2. Запуск приложения
npm start

# 3. Тест endpoints
curl http://localhost:3000/api/metrics/test/workiz/jobs?start_date=2025-01-01

# 4. Проверка логов
# Должны появиться сообщения:
# [METRICS] Starting metrics scheduler...
# [METRICS] Metrics scheduler started successfully
```

## Важные замечания

1. **Порядок импортов:** Импортируйте `metricsModule` после других импортов, но до создания Express app
2. **Порядок routes:** Добавляйте `app.use('/api/metrics', metricsModule.routes)` после других routes, но до обработчиков ошибок
3. **Запуск планировщика:** Запускайте `metricsModule.scheduler.start()` после успешного запуска сервера
4. **Переменные окружения:** Убедитесь, что все необходимые переменные окружения установлены перед запуском



