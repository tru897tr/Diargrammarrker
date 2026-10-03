import { Router } from 'express';
import { ok } from '../server/http.js';
import { getStore } from '../services/storage/index.js';
import { config } from '../server/config.js';

const router = Router();
const store = getStore();

const startedAt = Date.now();

/**
 * GET /api/v1/health — Render health check.
 * Khong phai sensitive: chi status + uptime + provider.
 */
router.get('/health', async (_req, res) => {
  const [users, diagrams, sessions] = await Promise.all([
    store.user.countUsers(),
    store.diagram.countDiagrams(),
    store.session.countActiveSessions(),
  ]);
  return ok(res, {
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    storage: { provider: config.storageProvider === 'firebase' ? 'firebase' : 'memory' },
    counts: { users, diagrams, activeSessions: sessions },
    timestamp: new Date().toISOString(),
  });
});

export default router;
