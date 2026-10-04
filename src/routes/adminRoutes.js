import { Router } from 'express';
import { ok, fail } from '../server/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { getStats, listUsers, updateUser, revokeUserSessions } from '../services/admin/adminService.js';
import { adminUpdateUserSchema, zodFieldErrors } from '../validation/schema.js';
import { largeJsonBodyParser } from '../middleware/bodyParser.js';
import { rateLimit } from '../security/rateLimit.js';
import {
  buildBackup, backupFilename, importBackup, importOptionsSchema, BackupError,
} from '../services/admin/backupService.js';

const router = Router();

/**
 * Toan bo /api/v1/admin/* chi admin (backend enforce — user thuong goi API
 * truc tiep se nhan 403, ke ca khi bypass frontend).
 */
router.use(requireAdmin);

/** GET /api/v1/admin/stats */
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getStats();
    return ok(res, { stats });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/admin/users */
router.get('/users', async (req, res, next) => {
  try {
    const users = await listUsers();
    return ok(res, { users });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/v1/admin/users/:id — doi role / khoa-mo khoa. */
router.patch('/users/:id', async (req, res, next) => {
  try {
    const parsed = adminUpdateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Dữ liệu nhập không hợp lệ.', 400, zodFieldErrors(parsed.error));
    }
    const id = req.params.id;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const user = await updateUser(req.user.id, id, parsed.data);
    return ok(res, { user });
  } catch (err) {
    if (err.code === 'INVALID_REQUEST') {
      return fail(res, 'INVALID_REQUEST', err.message, 400);
    }
    next(err);
  }
});

/** POST /api/v1/admin/users/:id/revoke-sessions */
router.post('/users/:id/revoke-sessions', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const result = await revokeUserSessions(req.user.id, id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------ sao lưu / khôi phục ---

const backupLimiter = rateLimit({ name: 'admin-backup', max: 20, windowMs: 60 * 1000 });

/** "0", "false", "off", "no" → false; còn lại (kể cả vắng mặt) → mặc định. */
function flag(value, fallback = true) {
  if (value === undefined) return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

function backupFail(res, err) {
  return fail(res, err.code || 'INVALID_REQUEST', err.message, err.status || 400);
}

/**
 * GET /api/v1/admin/export?users=1&diagrams=1&shares=1
 * Tải về toàn bộ dữ liệu trang web dạng JSON (kèm mã băm mật khẩu + token chia sẻ → nhạy cảm).
 */
router.get('/export', backupLimiter, async (req, res, next) => {
  try {
    const payload = await buildBackup({
      by: req.user,
      sections: {
        users: flag(req.query.users),
        diagrams: flag(req.query.diagrams),
        shares: flag(req.query.shares),
      },
    });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${backupFilename()}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify(payload));
  } catch (err) {
    if (err instanceof BackupError) return backupFail(res, err);
    next(err);
  }
});

/**
 * POST /api/v1/admin/import
 * Body: { backup: <nội dung tệp sao lưu>, mode: "merge"|"replace", dryRun?: boolean, sections?: {users,diagrams,shares} }
 * requireAdmin đã chạy (router.use) TRƯỚC khi largeJsonBodyParser đọc body.
 */
router.post('/import', backupLimiter, largeJsonBodyParser, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.backup || typeof body.backup !== 'object' || Array.isArray(body.backup)) {
      return fail(res, 'INVALID_BACKUP', 'Thiếu nội dung tệp sao lưu.', 400);
    }
    const opts = importOptionsSchema.safeParse({ mode: body.mode, dryRun: body.dryRun, sections: body.sections });
    if (!opts.success) {
      return fail(res, 'VALIDATION_ERROR', 'Tùy chọn nhập không hợp lệ.', 400, zodFieldErrors(opts.error));
    }
    const result = await importBackup({ backup: body.backup, actor: req.user, ...opts.data });
    return ok(res, result);
  } catch (err) {
    if (err instanceof BackupError) return backupFail(res, err);
    next(err);
  }
});

export default router;
