import { getStore } from '../storage/index.js';
import createLogger from '../../server/logger.js';
import { config } from '../../server/config.js';

const log = createLogger('admin-service');
const store = getStore();

/** Thong ke dashboard cho admin. Khong log du lieu nhay cam. */
export async function getStats() {
  const [userCount, diagramCount, sessionCount, shareCount] = await Promise.all([
    store.user.countUsers(),
    store.diagram.countDiagrams(),
    store.session.countActiveSessions(),
    store.share.countActiveShares(),
  ]);

  const mem = process.memoryUsage();
  return {
    users: userCount,
    diagrams: diagramCount,
    activeSessions: sessionCount,
    activeShares: shareCount,
    storage: {
      provider: config.storageProvider === 'firebase' ? 'firebase' : 'memory',
      persistent: false,
      note: 'Memory storage: dữ liệu tạm thời, mất khi khởi động lại.',
    },
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    nodeVersion: process.version,
    env: config.env,
  };
}

export async function listUsers() {
  return store.user.listUsers();
}

/**
 * Cap nhat user (role/status). Bao ve:
 * - Khong cho admin cuoi cung tu ha cap chinh minh (khong con admin nao).
 * - Khong khoa chinh minh.
 */
export async function updateUser(adminId, targetUserId, patch) {
  const target = await store.user.getUserById(targetUserId);
  if (!target) {
    const err = new Error('Không tìm thấy người dùng.');
    err.code = 'NOT_FOUND';
    err.status = 404;
    err.expose = true;
    throw err;
  }

  if (patch.status === 'locked' && target.id === adminId) {
    const err = new Error('Không thể khóa tài khoản của chính mình.');
    err.code = 'INVALID_REQUEST';
    err.expose = true;
    throw err;
  }

  if (patch.role === 'user' && target.role === 'admin') {
    const all = await store.user.listUsers();
    const adminCount = all.filter((u) => u.role === 'admin' && u.status === 'active').length;
    if (adminCount <= 1) {
      const err = new Error('Phải tồn tại ít nhất một admin đang hoạt động.');
      err.code = 'INVALID_REQUEST';
      err.expose = true;
      throw err;
    }
  }

  const updated = await store.user.updateUser(targetUserId, patch);

  // Khoa tai khoan → revoke toan bo session cua user do
  if (patch.status === 'locked') {
    await store.session.deleteSessionsForUser(targetUserId);
  }
  return updated;
}

/** Dang xuat toan bo thiet bi cua mot user. */
export async function revokeUserSessions(adminId, targetUserId) {
  const target = await store.user.getUserById(targetUserId);
  if (!target) {
    const err = new Error('Không tìm thấy người dùng.');
    err.code = 'NOT_FOUND';
    err.status = 404;
    err.expose = true;
    throw err;
  }
  const count = await store.session.deleteSessionsForUser(targetUserId);
  log.info('sessions revoked', { by: adminId, target: targetUserId, count });
  return { revoked: count };
}
