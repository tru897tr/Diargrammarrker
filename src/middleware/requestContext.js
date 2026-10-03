import crypto from 'node:crypto';
import { config } from '../server/config.js';
import createLogger from '../server/logger.js';

const log = createLogger('request');

/**
 * Middleware dung dau pipeline:
 * - requestId cho debug (header X-Request-Id + log).
 * - Danh dau body da parse chua.
 * - Log method/path/status + thoi gian (khong log query/body).
 */
export function requestContext(req, res, next) {
  // Chỉ nhận request id an toàn từ client (tránh ký tự lạ lọt vào header/log).
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming)
    ? incoming
    : crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.requestId);

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms [${req.requestId}]`);
  });

  next();
}
