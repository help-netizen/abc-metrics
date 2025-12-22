import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Конфигурация rate limiting
const WINDOW_MS = 60 * 1000; // 1 минута
const MAX_REQUESTS = 100; // максимум 100 запросов в минуту

/**
 * Middleware для rate limiting API БД
 * Ограничивает количество запросов с одного IP адреса
 */
export function dbRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const clientId = req.ip || 'unknown';
  const now = Date.now();

  // Очистка старых записей
  Object.keys(store).forEach(key => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });

  // Получение или создание записи для клиента
  if (!store[clientId]) {
    store[clientId] = {
      count: 0,
      resetTime: now + WINDOW_MS,
    };
  }

  const clientData = store[clientId];

  // Проверка лимита
  if (clientData.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((clientData.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Maximum ${MAX_REQUESTS} requests per minute.`,
      retryAfter,
    });
  }

  // Увеличение счетчика
  clientData.count++;

  // Установка заголовков для информации о лимите
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS.toString());
  res.setHeader('X-RateLimit-Remaining', (MAX_REQUESTS - clientData.count).toString());
  res.setHeader('X-RateLimit-Reset', new Date(clientData.resetTime).toISOString());

  next();
}



