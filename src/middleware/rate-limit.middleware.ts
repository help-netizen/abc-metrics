import rateLimit from 'express-rate-limit';

const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '100', 10);

/**
 * Rate limiting middleware для Rate Me API
 * Лимит: 100 запросов в минуту по умолчанию (настраивается через RATE_LIMIT_PER_MINUTE)
 */
export const rateMeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: RATE_LIMIT_PER_MINUTE,
  message: {
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Maximum ${RATE_LIMIT_PER_MINUTE} requests per minute.`
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req: any, res: any) => {
    const resetTime = req.rateLimit?.resetTime || Date.now() + 60000;
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Maximum ${RATE_LIMIT_PER_MINUTE} requests per minute.`,
      retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
    });
  }
});

