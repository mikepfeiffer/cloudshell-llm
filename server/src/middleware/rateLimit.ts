import rateLimit from 'express-rate-limit';

export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many requests. Please wait a moment before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const shellRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many shell requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});
