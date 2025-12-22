import { Request, Response, NextFunction } from 'express';

const DB_APP_API_KEY = process.env.DB_APP_API_KEY || '';

if (!DB_APP_API_KEY) {
  console.warn('WARNING: DB_APP_API_KEY is not set. API authentication will fail.');
}

/**
 * Middleware для аутентификации через API ключ
 * Поддерживает два формата:
 * 1. Authorization: Bearer {apiKey}
 * 2. X-API-Key: {apiKey}
 */
export function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  if (!DB_APP_API_KEY) {
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'API key authentication is not configured'
    });
  }

  // Try Bearer token first
  const authHeader = req.headers.authorization;
  let providedKey = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7);
  } else if (req.headers['x-api-key']) {
    // Fallback to X-API-Key header
    providedKey = req.headers['x-api-key'] as string;
  }

  if (!providedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key is required. Use Authorization: Bearer {apiKey} or X-API-Key header.'
    });
  }

  if (providedKey !== DB_APP_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key'
    });
  }

  // Log request (without sensitive data)
  console.log(`[API] ${req.method} ${req.path} - API key authenticated`);

  next();
}



