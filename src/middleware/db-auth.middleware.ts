import { Request, Response, NextFunction } from 'express';

/**
 * Middleware для аутентификации API БД через API ключ
 * Проверяет заголовок X-API-Key или query параметр api_key
 */

// Track unauthorized attempts per IP to reduce log noise
interface UnauthorizedAttempt {
  count: number;
  lastLogged: number;
}

const unauthorizedAttempts = new Map<string, UnauthorizedAttempt>();
const UNAUTHORIZED_LOG_INTERVAL = 60000; // Log at most once per minute per IP
const MAX_UNAUTHORIZED_LOGS_PER_IP = 5; // Log first 5 attempts, then only once per minute

export function dbAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string || req.query.api_key as string;
  const expectedApiKey = process.env.DB_API_KEY;

  if (!expectedApiKey) {
    console.error('DB_API_KEY is not configured');
    return res.status(500).json({ 
      error: 'Server configuration error',
      message: 'API key authentication is not configured' 
    });
  }

  if (!apiKey || apiKey !== expectedApiKey) {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = unauthorizedAttempts.get(clientIp) || { count: 0, lastLogged: 0 };
    attempt.count++;
    
    // Log only if:
    // 1. First 5 attempts, OR
    // 2. More than 1 minute has passed since last log
    const shouldLog = attempt.count <= MAX_UNAUTHORIZED_LOGS_PER_IP || 
                      (now - attempt.lastLogged) >= UNAUTHORIZED_LOG_INTERVAL;
    
    if (shouldLog) {
      const hasKey = !!apiKey;
      const keyPreview = hasKey ? `${apiKey.substring(0, 8)}...` : 'missing';
      console.warn(`[Unauthorized] API access attempt from ${clientIp} to ${req.path} (key: ${keyPreview}, attempt #${attempt.count})`);
      attempt.lastLogged = now;
    }
    
    unauthorizedAttempts.set(clientIp, attempt);
    
    // Clean up old entries (older than 5 minutes) to prevent memory leak
    if (unauthorizedAttempts.size > 1000) {
      for (const [ip, data] of unauthorizedAttempts.entries()) {
        if (now - data.lastLogged > 300000) {
          unauthorizedAttempts.delete(ip);
        }
      }
    }
    
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing API key' 
    });
  }

  next();
}

