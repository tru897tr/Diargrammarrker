import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
// test: chỉ lỗi | development: đầy đủ (debug) | production: từ info trở lên
const current = LEVELS[config.isTest ? 'error' : config.isDevelopment ? 'debug' : 'info'] ?? 20;

function fmt(id) {
  const ts = new Date().toISOString();
  return id ? `[${ts}] [${id}]` : `[${ts}]`;
}

function emit(level, id, args) {
  if ((LEVELS[level] ?? 20) < current) return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(fmt(id), `[${level}]`, ...args);
}

/**
 * Logger thong nhat. Khong log du lieu nhay cam: password, token, cookie.
 * requestId de debug (duoc them boi request middleware).
 */
export function createLogger(scope = 'app') {
  return {
    debug: (...a) => emit('debug', scope, a),
    info: (...a) => emit('info', scope, a),
    warn: (...a) => emit('warn', scope, a),
    error: (...a) => emit('error', scope, a),
  };
}

export const logger = createLogger('app');
export default createLogger;
