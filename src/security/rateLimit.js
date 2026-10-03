import { config } from '../server/config.js';
import createLogger from '../server/logger.js';

const log = createLogger('ratelimit');

/**
 * Rate limiter in-memory theo IP + bucket key.
 * Khong can dependency: Map + cua so thoi gian, don dep bang setInterval khi store con nho.
 */

const buckets = new Map(); // key -> { count, resetAt }

function cleanup() {
  const t = Date.now();
  if (buckets.size > 10000) {
    for (const [k, b] of buckets) if (b.resetAt < t) buckets.delete(k);
  }
}

export function rateLimit({ name, max, windowMs, keyFn }) {
  return (req, res, next) => {
    cleanup();
    const key = `${name}:${keyFn ? keyFn(req) : req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - b.count));
    res.setHeader('RateLimit-Reset', Math.ceil(b.resetAt / 1000));
    if (b.count > max) {
      log.warn('rate limited', { bucket: name, ip: req.ip });
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Qua nhieu yeu cau. Vui long thu lai sau it phut.',
        },
      });
    }
    next();
  };
}

/** Factory dung cho auth endpoints (dung rieng). */
export const authLimiter = () =>
  rateLimit({ name: 'auth', max: config.rateLimits.auth, windowMs: config.rateLimits.authWindowMs });

export const registerLimiter = () =>
  rateLimit({ name: 'register', max: config.rateLimits.register, windowMs: config.rateLimits.authWindowMs });

export const apiLimiter = () =>
  rateLimit({ name: 'api', max: config.rateLimits.api, windowMs: config.rateLimits.apiWindowMs });

export const shareLimiter = () =>
  rateLimit({ name: 'share', max: config.rateLimits.share, windowMs: config.rateLimits.shareWindowMs });

export default rateLimit;
