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
  req.requestId = req.get('x-request-id') || crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.requestId);

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms [${req.requestId}]`);
  });

  next();
}
