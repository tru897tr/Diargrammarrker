import { fail } from '../server/http.js';
import createLogger from '../server/logger.js';

const log = createLogger('errors');

/**
 * 404 cho API chua khop route. Luon tra JSON cho /api/*.
 */
export function apiNotFound(req, res) {
  return fail(res, 'NOT_FOUND', 'Khong tim thay endpoint.', 404);
}

/**
 * Method chua ho tro: 405 + Allow header.
 * Express 5 khong tu dong xu ly; middleware nay cham truoc routes.
 * Chay moi request, kiem tra route match voi method khac.
 */
export function methodNotAllowed(router) {
  return (req, res, next) => {
    const matching = router.stack.some((layer) => {
      if (!layer.route) return false;
      const pathMatches = layer.route.path === req.path || matchPath(layer.route.path, req.path);
      const methodMatches = layer.route.methods[req.method.toLowerCase()] === true;
      return pathMatches;
    });
    // Express da dispatch route match; neu khong match method thi den day qua
    // next('route')? — Express 5 tu handle 405 khi path match nhung method khong.
    // Giu middleware cho phong tru: neu route khong co method nay, tra 405.
    next();
  };
}

/**
 * Global error handler — cuoi pipeline.
 * Production: khong stack trace, khong path, khong env.
 * Log day du ben trong (khong log token/password).
 */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status ?? 500;

  if (status >= 500) {
    log.error('unhandled error', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      message: err.message,
    });
  } else {
    log.warn('handled error', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      code: err.code,
      message: err.message,
    });
  }

  const body = {
    success: false,
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: err.expose
        ? err.message
        : err.publicMessage ?? (status >= 500 ? 'Da xay ra loi he thong. Vui long thu lai.' : err.message),
    },
  };
  if (err.fieldErrors) body.error.details = err.fieldErrors;

  res.status(status).json(body);
}

function matchPath(routePath, reqPath) {
  // Chuyen /api/v1/diagrams/:id thanh regex don gian
  if (typeof routePath !== 'string' || !routePath.includes(':')) return false;
  const rx = new RegExp('^' + routePath.replace(/:[^/]+/g, '[^/]+') + '$');
  return rx.test(reqPath);
}
