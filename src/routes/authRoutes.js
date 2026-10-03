import { Router } from 'express';
import { ok, fail } from '../server/http.js';
import {
  registerSchema, loginSchema, updateProfileSchema, changePasswordSchema, zodFieldErrors,
} from '../validation/schema.js';
import {
  registerUser, verifyLogin, createSessionForUser, destroySession, changePassword,
} from '../services/auth/authService.js';
import { requireAuth } from '../middleware/auth.js';
import { registerLimiter, authLimiter } from '../security/rateLimit.js';
import { getStore } from '../services/storage/index.js';
import { buildCsrfCookie, CSRF_COOKIE_NAME } from '../security/csrf.js';

const router = Router();
const store = getStore();

const SESSION_COOKIE = 'diagram_session';

/** Secure cookie khi chay HTTPS (Render proxy gui x-forwarded-proto). */
function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return proto === 'https';
}

function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
  };
}

function setSessionCookies(req, res, session) {
  res.cookie(SESSION_COOKIE, session.id, sessionCookieOptions(req));
  // CSRF cookie: KHONG HttpOkunly de JS doc duoc (HMAC-signed double-submit).
  res.cookie(CSRF_COOKIE_NAME, buildCsrfCookie(session.csrfToken), {
    httpOnly: false,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
  });
}

function clearSessionCookies(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

/** POST /api/v1/auth/register — tai khoan DAU TIEN tu dong la admin. */
router.post('/register', registerLimiter(), async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Du lieu nhap khong hop le.', 400, zodFieldErrors(parsed.error));
    }
    const user = await registerUser(parsed.data);
    const session = await createSessionForUser(user.id);
    setSessionCookies(req, res, session);
    return ok(res, { user, csrfToken: session.csrfToken }, 201);
  } catch (err) {
    if (err.code === 'CONFLICT_EMAIL') {
      return fail(res, 'CONFLICT', 'Email da duoc su dung.', 409);
    }
    if (err.code === 'CONFLICT_USERNAME') {
      return fail(res, 'CONFLICT', 'Username da duoc su dung.', 409);
    }
    next(err);
  }
});

/** POST /api/v1/auth/login */
router.post('/login', authLimiter(), async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Du lieu nhap khong hop le.', 400, zodFieldErrors(parsed.error));
    }
    const user = await verifyLogin(parsed.data);
    if (!user) {
      return fail(res, 'INVALID_CREDENTIALS', 'Tai khoan hoac mat khau khong dung.', 401);
    }
    const session = await createSessionForUser(user.id);
    setSessionCookies(req, res, session);
    return ok(res, { user, csrfToken: session.csrfToken });
  } catch (err) {
    if (err.code === 'ACCOUNT_LOCKED') {
      return fail(res, 'ACCOUNT_LOCKED', 'Tai khoan da bi khoa.', 403);
    }
    next(err);
  }
});

/** POST /api/v1/auth/logout — invalidate session phia server. */
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await destroySession(req.cookies?.[SESSION_COOKIE]);
    clearSessionCookies(res);
    return ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/auth/me */
router.get('/me', requireAuth, (req, res) => {
  return ok(res, { user: req.user, csrfToken: req.session.csrfToken });
});

/** PATCH /api/v1/auth/me — cap nhat profile. */
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Du lieu nhap khong hop le.', 400, zodFieldErrors(parsed.error));
    }
    const user = await store.user.updateUser(req.user.id, parsed.data);
    return ok(res, { user });
  } catch (err) {
    if (err.code === 'CONFLICT_EMAIL') {
      return fail(res, 'CONFLICT', 'Email da duoc su dung.', 409);
    }
    if (err.code === 'CONFLICT_USERNAME') {
      return fail(res, 'CONFLICT', 'Username da duoc su dung.', 409);
    }
    next(err);
  }
});

/** POST /api/v1/auth/change-password — yeu cau mat khau hien tai. */
router.post('/change-password', requireAuth, authLimiter(), async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Du lieu nhap khong hop le.', 400, zodFieldErrors(parsed.error));
    }
    const result = await changePassword(req.user.id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!result.ok) {
      const msg = result.reason === 'NOT_FOUND' ? 'Khong tim thay tai khoan.' : 'Mat khau hien tai khong dung.';
      return fail(res, 'INVALID_CREDENTIALS', msg, 400);
    }
    const session = await createSessionForUser(req.user.id);
    setSessionCookies(req, res, session);
    return ok(res, { changed: true, csrfToken: session.csrfToken });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/auth/logout-all — dang xuat tat ca thiet bi. */
router.post('/logout-all', requireAuth, async (req, res, next) => {
  try {
    const count = await store.session.deleteSessionsForUser(req.user.id);
    clearSessionCookies(res);
    return ok(res, { revoked: count });
  } catch (err) {
    next(err);
  }
});

export default router;
