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

/** Raw JSON parser co gioi han size va bao loi than thien. */
export function jsonBodyParser(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return next();

  const contentType = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType === '' && (parseInt(req.get('content-length') || '0', 10) > 0)) {
    return fail(res, 'UNSUPPORTED_MEDIA_TYPE', 'Thieu Content-Type.', 415);
  }
  if (contentType && contentType !== 'application/json') {
    return fail(res, 'UNSUPPORTED_MEDIA_TYPE', 'Chi ho tro Content-Type: application/json.', 415);
  }
  if (contentType === '') {
    // Body trong → req.body = {}
    req.body = {};
    return next();
  }

  const limit = config.limits.jsonBodyBytes;
  const len = parseInt(req.get('content-length') || '0', 10);
  if (len > limit) {
    return fail(res, 'BODY_TOO_LARGE', `Body qua lon (toi da ${Math.floor(limit / 1024)}KB).`, 413);
  }

  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => {
    /* client reset — khong lam gi */
  });
  req.on('end', () => {
    if (chunks.length === 0) {
      req.body = {};
      return next();
    }
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') { req.body = {}; return next(); }
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail(res, 'INVALID_JSON', 'Body phai la JSON object.', 400);
      }
      req.body = parsed;
      next();
    } catch (e) {
      if (size > limit) {
        return fail(res, 'BODY_TOO_LARGE', 'Body qua lon.', 413);
      }
      return fail(res, 'INVALID_JSON', 'JSON khong hop le: ' + safeJsonMsg(e), 400);
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
    return fail(res, 'METHOD_NOT_ALLOWED', `Endpoint chi ho tro: ${allowed.join(', ')}.`, 405);
  };
}
