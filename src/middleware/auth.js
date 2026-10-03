import { resolveSession } from '../services/auth/authService.js';
import { fail } from '../server/http.js';

/**
 * Auth middleware — doc session cookie, gan req.user/req.session.
 * Khong chan request; route quyet dinh co yeu cau login hay khong.
 */
export async function attachSession(req, _res, next) {
  req.user = null;
  req.session = null;
  const raw = req.cookies?.diagram_session;
  if (raw) {
    try {
      const resolved = await resolveSession(raw);
      if (resolved) {
        req.user = resolved.user;
        req.session = resolved.session;
      }
    } catch {
      // Session khong hop le → coi nhu chua dang nhap
    }
  }
  next();
}

/** Yeu cau dang nhap. 401 JSON neu khong. */
export function requireAuth(req, res, next) {
  if (!req.user || !req.session) {
    return fail(res, 'UNAUTHORIZED', 'Ban can dang nhap de thuc hien hanh dong nay.', 401);
  }
  next();
}

/** Yeu cau admin. 403 JSON neu khong (backend enforce, khong the bypass frontend). */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return fail(res, 'UNAUTHORIZED', 'Ban can dang nhap de thuc hien hanh dong nay.', 401);
  }
  if (req.user.role !== 'admin') {
    return fail(res, 'FORBIDDEN', 'Ban khong co quyen thuc hien hanh dong nay.', 403);
  }
  next();
}
