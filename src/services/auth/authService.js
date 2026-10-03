import { getStore } from '../storage/index.js';
import { newSessionId, now } from '../../server/utils.js';
import { config } from '../../server/config.js';
import createLogger from '../../server/logger.js';
import { generateCsrfToken } from '../../security/csrf.js';

const log = createLogger('auth-service');

export const store = getStore();

async function getBcrypt() {
  return (await import('bcryptjs')).default;
}

/** Đăng ký user mới. Tài khoản ĐẦU TIÊN = admin (store đảm bảo atomic). */
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

  const bcrypt = await getBcrypt();
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

  const user = await store.user.createUser({ username, email, passwordHash });
  log.info('registered', { userId: user.id, role: user.role });
  return user;
}

/**
 * Hash giả để so sánh khi email không tồn tại → thời gian phản hồi giống nhau
 * (chống timing oracle dò email). Sinh một lần, đúng cost hiện tại.
 */
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = getBcrypt().then((bcrypt) => bcrypt.hash('dummy-password-for-timing', config.bcryptRounds));
  }
  return dummyHashPromise;
}

/** Kiểm tra email + password, trả về user (public) nếu đúng. */
export async function verifyLogin({ email, password }) {
  const bcrypt = await getBcrypt();
  const user = await store.user.getUserByEmail(email);
  if (!user) {
    await bcrypt.compare(password, await getDummyHash());
    return null;
  }
  // Public user không có hash → lấy bản nội bộ có passwordHash qua store.
  const internal = await store.user.getUserWithHashById(user.id);
  if (!internal) return null;
  const okPass = await bcrypt.compare(password, internal.passwordHash);
  if (!okPass) return null;
  if (user.status === 'locked') {
    const err = new Error('ACCOUNT_LOCKED');
    err.code = 'ACCOUNT_LOCKED';
    throw err;
  }
  return user;
}

/** Tạo session mới (login mới = session mới). */
export async function createSessionForUser(userId) {
  const csrfToken = generateCsrfToken();
  const session = await store.session.createSession({
    userId,
    csrfToken,
    ttlMs: config.sessionTtlMs,
  });
  return session;
}

/** Lấy user từ session hợp lệ (chưa hết hạn). */
export async function resolveSession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < 20) return null;
  const session = await store.session.getSession(sessionId);
  if (!session) return null;
  const user = await store.user.getUserById(session.userId);
  if (!user || user.status !== 'active') return null;
  return { session, user };
}

/** Logout: invalidate session phía server. */
export async function destroySession(sessionId) {
  if (typeof sessionId !== 'string') return false;
  return store.session.deleteSession(sessionId);
}

/** Đổi password: yêu cầu password hiện tại, invalidate toàn bộ session cũ. */
export async function changePassword(userId, currentPassword, newPassword) {
  const internal = await store.user.getUserWithHashById(userId);
  if (!internal) return { ok: false, reason: 'NOT_FOUND' };
  const bcrypt = await getBcrypt();
  const matches = await bcrypt.compare(currentPassword, internal.passwordHash);
  if (!matches) return { ok: false, reason: 'INVALID_PASSWORD' };
  const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await store.user.updateUser(userId, { passwordHash });
  await store.session.deleteSessionsForUser(userId);
  return { ok: true };
}

export { newSessionId, now };
