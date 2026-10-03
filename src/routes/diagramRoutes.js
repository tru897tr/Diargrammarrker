import { Router } from 'express';
import { ok, fail } from '../server/http.js';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter } from '../security/rateLimit.js';
import {
  createDiagram, getDiagramForUser, listUserDiagrams, updateDiagram, deleteDiagram,
  duplicateDiagram, createShare, revokeShare,
} from '../services/diagrams/diagramService.js';
import {
  createDiagramSchema, updateDiagramSchema, shareTokenSchema, zodFieldErrors,
} from '../validation/schema.js';
import { newShareToken } from '../server/utils.js';

const router = Router();

// Toan bo route diagrams yeu cau dang nhap.
router.use(requireAuth);

/** GET /api/v1/diagrams — list cua user hien tai. */
router.get('/', async (req, res, next) => {
  try {
    const diagrams = await listUserDiagrams(req.user.id);
    return ok(res, { diagrams });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/diagrams — tao moi. */
router.post('/', apiLimiter(), async (req, res, next) => {
  try {
    const parsed = createDiagramSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Dữ liệu nhập không hợp lệ.', 400, zodFieldErrors(parsed.error));
    }
    const diagram = await createDiagram(req.user.id, parsed.data);
    return ok(res, { diagram }, 201);
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/diagrams/:id */
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const diagram = await getDiagramForUser(req.user.id, req.params.id);
    return ok(res, { diagram });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/v1/diagrams/:id — luu ten + data. */
router.patch('/:id', apiLimiter(), async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const parsed = updateDiagramSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Dữ liệu nhập không hợp lệ.', 400, zodFieldErrors(parsed.error));
    }
    const diagram = await updateDiagram(req.user.id, req.params.id, parsed.data);
    return ok(res, { diagram });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/v1/diagrams/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const deleted = await deleteDiagram(req.user.id, req.params.id);
    return ok(res, { deleted: true, id: deleted.id });
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/diagrams/:id/duplicate */
router.post('/:id/duplicate', apiLimiter(), async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const copy = await duplicateDiagram(req.user.id, req.params.id);
    return ok(res, { diagram: copy }, 201);
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/diagrams/:id/share — tao/lay share link. */
router.post('/:id/share', apiLimiter(), async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const share = await createShare(req.user.id, req.params.id);
    return ok(res, { share: { token: share.token, createdAt: share.createdAt } }, 201);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/v1/diagrams/:id/share — revoke. */
router.delete('/:id/share', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return fail(res, 'INVALID_REQUEST', 'ID không hợp lệ.', 400);
    }
    const result = await revokeShare(req.user.id, req.params.id);
    return ok(res, { revoked: Boolean(result) });
  } catch (err) {
    next(err);
  }
});

function isValidId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(id);
}

export default router;
