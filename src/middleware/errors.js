import path from 'node:path';
import { fail, errorMessages } from '../server/http.js';
import { config } from '../server/config.js';
import { renderView } from '../server/render.js';
import createLogger from '../server/logger.js';

const log = createLogger('errors');

/** 404 cho API chưa khớp route. Luôn trả JSON cho /api/*. */
export function apiNotFound(_req, res) {
  return fail(res, 'NOT_FOUND', 'Không tìm thấy endpoint.', 404);
}

/** HTTP status → mã lỗi chuẩn của API. */
const STATUS_TO_CODE = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'BODY_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

// ---------------------------------------------------------------- debug ---

const rootPosix = config.rootDir.split(path.sep).join('/');

/** Rút gọn đường dẫn tuyệt đối thành đường dẫn tương đối với thư mục project. */
function relativize(text) {
  return String(text ?? '')
    .replaceAll('\\', '/')
    .replaceAll('file://', '')
    .replaceAll(`/${rootPosix}/`, '')
    .replaceAll(`${rootPosix}/`, '');
}

/** Tìm dòng đầu tiên trong stack nằm trong code của app (bỏ node_modules và node:internal). */
function firstAppFrame(stack) {
  for (const line of String(stack ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    if (trimmed.includes('node_modules') || trimmed.includes('node:')) continue;
    const m = trimmed.match(/\(?([^()\s]+):(\d+):(\d+)\)?$/);
    if (m) return `${relativize(m[1])}:${m[2]}:${m[3]}`;
  }
  return null;
}

/**
 * Thông tin debug — CHỈ gắn vào response khi NODE_ENV=development.
 * Không bao giờ đưa body, cookie, header, token vào đây (tránh lộ mật khẩu).
 */
function buildDebugInfo(err, req, status) {
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    status,
    location: firstAppFrame(err.stack),
    stack: relativize(err.stack),
    cause: err.cause ? relativize(err.cause.stack ?? String(err.cause)) : undefined,
    request: { method: req.method, url: req.originalUrl, requestId: req.requestId },
    time: new Date().toISOString(),
    node: process.version,
  };
}

// -------------------------------------------------------------- handler ---

function wantsJson(req) {
  if (req.originalUrl.startsWith('/api/')) return true;
  const accept = req.get('accept') || '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function normalizeError(err) {
  if (err instanceof Error) return err;
  const wrapped = new Error(typeof err === 'string' ? err : 'Lỗi không xác định (giá trị được throw không phải Error).');
  wrapped.original = err;
  return wrapped;
}

/**
 * Global error handler — cuối pipeline.
 * - Luôn log đầy đủ (kèm stack) ở server.
 * - Production: client chỉ nhận thông điệp chung, KHÔNG có stack/path/env.
 * - Development: client nhận thêm `error.debug` (stack + file:dòng) để hiện toast + popup.
 */
export async function errorHandler(rawErr, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(rawErr);

  const err = normalizeError(rawErr);
  const rawStatus = Number(err.status ?? err.statusCode);
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

  const meta = { requestId: req.requestId, method: req.method, path: req.path, code: err.code };
  if (status >= 500) {
    log.error(`unhandled error: ${err.message}`, meta, '\n' + relativize(err.stack));
  } else {
    log.warn(`handled error: ${err.message}`, meta);
  }

  // Mã lỗi công khai: chỉ dùng err.code khi là mã của API, tránh lộ mã hệ thống (ENOENT, ...).
  const code = errorMessages[err.code] ? err.code : (STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR');
  const message = err.expose
    ? err.message
    : err.publicMessage ?? errorMessages[code] ?? errorMessages.INTERNAL_ERROR;

  const debug = config.isDevelopment ? buildDebugInfo(err, req, status) : undefined;

  if (wantsJson(req)) {
    const body = { success: false, error: { code, message } };
    if (err.fieldErrors) body.error.details = err.fieldErrors;
    if (debug) body.error.debug = debug;
    return res.status(status).json(body);
  }

  // Request tải trang: trả trang lỗi HTML. Development: nhúng debug để client hiện toast + popup.
  try {
    const view = status === 404 ? 'errors/404.html' : status === 403 ? 'errors/403.html' : 'errors/500.html';
    return await renderView(res, view, {
      title: `${status} — Diagram`,
      status,
      extra: debug ? { debugError: { ...debug, message: err.message } } : {},
    });
  } catch (renderErr) {
    log.error('không render được trang lỗi:', renderErr.message);
    res.status(status).type('text/plain; charset=utf-8').send(message);
  }
}
