import crypto from 'node:crypto';
import { config } from '../server/config.js';

/**
 * CSRF bang double-submit cookie + HMAC.
 *
 * - Khi tao session, server sinh csrfToken (random 32B) va tra ve client
 *   qua GET /api/v1/auth/csrf (body JSON) + cookie csrf (KHONG HttpOnly de JS doc duoc).
 * - Moi request POST/PATCH/DELETE phai kem:
 *     Header: X-CSRF-Token: <token>  hoac  Body: _csrf
 * - Server kiem tra HMAC(csrfSecret, token) hop le va khop voi session.csrfToken.
 *
 * SameSite=Lax + HMAC double-submit → chong CSRF ma khong phu thuoc Referer.
 */

const COOKIE_NAME = 'diagram_csrf';

export function generateCsrfToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return raw;
}

/** HMAC token voi secret — dung verify token la server-issued. */
function signToken(token) {
  return crypto.createHmac('sha256', config.csrfSecret).update(token).digest('base64url');
}

/** Sinh cookie gia tri csrf=<token>.<hmac> (doc duoc boi JS de gui header). */
export function buildCsrfCookie(token) {
  return `${token}.${signToken(token)}`;
}

/** Kiem tra cookie csrf hop le, tra ve raw token neu dung. */
export function verifyCsrfCookie(value) {
  if (typeof value !== 'string') return null;
  const idx = value.lastIndexOf('.');
  if (idx <= 0) return null;
  const token = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = signToken(token);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return token;
}

/**
 * Middleware: yeu cau CSRF cho method lam thay doi trang thai.
 * So sanh timing-safe voi session.csrfToken.
 */
export function csrfProtection(req, res, next) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const session = req.session;
  if (!session) return next(); // chua dang nhap — auth middleware se xu ly

  const headerToken = req.get('x-csrf-token');
  const bodyToken = typeof req.body?._csrf === 'string' ? req.body._csrf : null;
  const token = headerToken || bodyToken;

  if (!token) {
    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_INVALID', message: 'Thiếu CSRF token.' },
    });
  }

  const a = Buffer.from(String(token));
  const b = Buffer.from(session.csrfToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_INVALID', message: 'CSRF token không hợp lệ.' },
    });
  }
  next();
}

export const CSRF_COOKIE_NAME = COOKIE_NAME;
