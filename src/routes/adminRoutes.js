import { Router } from 'express';
import { ok, fail } from '../server/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { getStats, listUsers, updateUser, revokeUserSessions } from '../services/admin/adminService.js';
import { adminUpdateUserSchema, zodFieldErrors } from '../validation/schema.js';

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

export default router;
