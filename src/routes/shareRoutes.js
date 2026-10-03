import { Router } from 'express';
import { ok, fail } from '../server/http.js';
import { getSharedDiagram } from '../services/diagrams/diagramService.js';
import { shareTokenSchema } from '../validation/schema.js';
import { shareLimiter } from '../security/rateLimit.js';

const router = Router();

/**
 * GET /api/v1/share/:token — public, khong can dang nhap.
 * Chi tra: ten + diagram data. Khong tra owner, session, internal IDs.
 */
router.get('/:token', shareLimiter(), async (req, res, next) => {
  try {
    const parsed = shareTokenSchema.safeParse(req.params.token);
    if (!parsed.success) {
      return fail(res, 'NOT_FOUND', 'Khong tim thay so do hoac lien ket da het hieu luc.', 404);
    }
    const result = await getSharedDiagram(parsed.data);
    return ok(res, result);
  } catch (err) {
    if (err.code === 'SHARE_NOT_FOUND') {
      return fail(res, 'NOT_FOUND', 'Khong tim thay so do hoac lien ket da het hieu luc.', 404);
    }
    next(err);
  }
});

export default router;
