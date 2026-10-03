import { getStore } from '../storage/index.js';
import { MemoryStore as _MS } from '../storage/MemoryStore.js';
import { newSessionId, now } from '../../server/utils.js';
import { config } from '../../server/config.js';
import createLogger from '../../server/logger.js';
import { generateCsrfToken } from '../../security/csrf.js';

const log = createLogger('auth-service');

export const store = getStore();

/** Dang ky user moi. Tai khoan DAU TIEN = admin (store dam bao atomic). */
export async function registerUser({ username, email, password }) {
  const existingEmail = await store.user.getUserByEmail(email);
  if (existingEmail) {
    const err = new Error('EMAIL_TAKEN');
    err.code = 'CONFLICT_EMAIL';
    throw err;
  }
  const existingName = await store.user.getUserByUsername(username);
  if (existingName) {
    const err = new Error('USERNAME_TAKEN');
    err.code = 'CONFLICT_USERNAME';
    throw err;
  }

  const bcrypt = (await import('bcryptjs')).default;
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

  const user = await store.user.createUser({ username, email, passwordHash });
  log.info('registered', { userId: user.id, role: user.role });
  return user;
}

/** Kiem tra email + password, tra ve user neu dung. */
export async function verifyLogin({ email, password }) {
  const user = await store.user.getUserByEmail(email);
  if (!user) {
    // Hash gia de tranh timing oracle (luon mat ~1 hash time)
    await import('bcryptjs').then((m) => m.default.compare(password, DUMMY_HASH));
    return null;
  }
  // Lay passwordHash goc tu store internal (public user khong co hash)
  const internal = await getInternalUser(user.id);
  if (!internal) return null;
  const bcrypt = (await import('bcryptjs')).default;
  const okPass = await bcrypt.compare(password, internal.passwordHash);
  if (!okPass) return null;
  if (user.status === 'locked') {
    const err = new Error('ACCOUNT_LOCKED');
    err.code = 'ACCOUNT_LOCKED';
    throw err;
  }
  return user;
}

/** Tao session moi (login moi = session moi). Tra ve { session, user }. */
export async function createSessionForUser(userId) {
  const csrfToken = generateCsrfToken();
  const session = await store.session.createSession({
    userId,
    csrfToken,
    ttlMs: config.sessionTtlMs,
  });
  return session;
}

/** Lay user tu session hop le (chua het han). */
export async function resolveSession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < 20) return null;
  const session = await store.session.getSession(sessionId);
  if (!session) return null;
  const user = await store.user.getUserById(session.userId);
  if (!user || user.status !== 'active') return null;
  return { session, user };
}

/** Logout: invalidate session phia server. */
export async function destroySession(sessionId) {
  if (typeof sessionId !== 'string') return false;
  return store.session.deleteSession(sessionId);
}

/** Doi password: require password hien tai, invalidate toan bo session cu. */
export async function changePassword(userId, currentPassword, newPassword) {
  const internal = await getInternalUser(userId);
  if (!internal) return { ok: false, reason: 'NOT_FOUND' };
  const bcrypt = (await import('bcryptjs')).default;
  const ok = await bcrypt.compare(currentPassword, internal.passwordHash);
  if (!ok) return { ok: false, reason: 'INVALID_PASSWORD' };
  const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await store.user.updateUser(userId, { passwordHash });
  await store.session.deleteSessionsForUser(userId);
  return { ok: true };
}

// MemoryStore tra public user (khong hash) — can hash de verify.
// Voi store khac (Firebase) can ham getInternalUser rieng; o day dung
// back-door cua MemoryStore qua private map. de dong bo, dinh nghia o day.
async function getInternalUser(userId) {
  if (store instanceof _MS) {
    const u = store.users.get(userId);
    return u ? { ...u } : null;
  }
  // Firebase skeleton: TODO getUserWithHash
  return null;
}

// Hash gia cho timing-safe login that bai (dung bcrypt cost thap vi chi la delay)
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.yBpGhX5Z6/jqxG2JZxGxGxGxGxGxGxG';

export { newSessionId, now };
