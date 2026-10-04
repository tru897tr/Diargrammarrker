import { fail, errorMessages } from '../server/http.js';
import { config } from '../server/config.js';
import createLogger from '../server/logger.js';

const log = createLogger('body');

/**
 * Request hardening:
 * - Malformed JSON → 400 INVALID_JSON (khong crash).
 * - Body qua lon → 413 BODY_TOO_LARGE.
 * - Content-Type sai voi endpoint JSON → 415.
 * - Method khong hop le → 405 + Allow (chi cho GET → POST/PUT/PATCH/DELETE tra 405).
 */

/**
 * Route nhận body lớn (tệp sao lưu của admin). Parser mặc định BỎ QUA route này;
 * route tự gắn `largeJsonBodyParser` SAU khi đã xác thực admin, để người chưa đăng nhập
 * không thể bắt server đọc hàng chục MB vào RAM.
 */
const LARGE_BODY_PATHS = new Set(['/api/v1/admin/import']);

function isLargeBodyRoute(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  return LARGE_BODY_PATHS.has(path);
}

function formatLimit(bytes) {
  return bytes >= 1024 * 1024 ? `${Math.floor(bytes / 1024 / 1024)}MB` : `${Math.floor(bytes / 1024)}KB`;
}

/** Parser JSON mặc định cho toàn bộ API (giới hạn nhỏ). */
export function jsonBodyParser(req, res, next) {
  if (isLargeBodyRoute(req)) return next();
  return parseJsonBody(config.limits.jsonBodyBytes)(req, res, next);
}

/** Parser JSON cho route nhận tệp lớn (giới hạn config.limits.importBodyBytes). */
export function largeJsonBodyParser(req, res, next) {
  return parseJsonBody(config.limits.importBodyBytes)(req, res, next);
}

/** Raw JSON parser co gioi han size va bao loi than thien. */
function parseJsonBody(limit) {
  return (req, res, next) => handleJsonBody(req, res, next, limit);
}

function handleJsonBody(req, res, next, limit) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return next();

  const contentType = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType === '' && (parseInt(req.get('content-length') || '0', 10) > 0)) {
    return fail(res, 'UNSUPPORTED_MEDIA_TYPE', 'Thiếu Content-Type.', 415);
  }
  if (contentType && contentType !== 'application/json') {
    return fail(res, 'UNSUPPORTED_MEDIA_TYPE', 'Chỉ hỗ trợ Content-Type: application/json.', 415);
  }
  if (contentType === '') {
    // Body trong → req.body = {}
    req.body = {};
    return next();
  }

  const len = parseInt(req.get('content-length') || '0', 10);
  if (len > limit) {
    return fail(res, 'BODY_TOO_LARGE', `Body quá lớn (tối đa ${formatLimit(limit)}).`, 413);
  }

  let size = 0;
  let rejected = false;
  const chunks = [];
  req.on('data', (chunk) => {
    if (rejected) return;
    size += chunk.length;
    if (size > limit) {
      // Trả 413 cho client rồi mới ngắt kết nối (destroy ngay sẽ làm client chỉ thấy "lỗi mạng").
      rejected = true;
      chunks.length = 0;
      res.setHeader('Connection', 'close');
      fail(res, 'BODY_TOO_LARGE', `Body quá lớn (tối đa ${formatLimit(limit)}).`, 413);
      res.on('finish', () => req.destroy());
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => {
    /* client reset — khong lam gi */
  });
  req.on('end', () => {
    if (rejected) return;
    if (chunks.length === 0) {
      req.body = {};
      return next();
    }
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') { req.body = {}; return next(); }
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail(res, 'INVALID_JSON', 'Body phải là JSON object.', 400);
      }
      req.body = parsed;
      next();
    } catch (e) {
      return fail(res, 'INVALID_JSON', 'JSON không hợp lệ: ' + safeJsonMsg(e), 400);
    }
  });
}

function safeJsonMsg(e) {
  const m = String(e.message || '');
  return m.length > 120 ? m.slice(0, 120) + '...' : m;
}

/**
 * Method protection cho endpoint chi doc:
 * req.methods = ['get'] → cac method khac tra 405 + Allow.
 */
export function allowOnly(...methods) {
  const allowed = methods.map((m) => m.toUpperCase());
  const allowedSet = new Set(allowed.map((m) => m.toLowerCase()));
  return (req, res, next) => {
    const m = req.method.toLowerCase();
    if (allowedSet.has(m)) return next();
    res.setHeader('Allow', allowed.join(', '));
    return fail(res, 'METHOD_NOT_ALLOWED', `Endpoint chỉ hỗ trợ: ${allowed.join(', ')}.`, 405);
  };
}
