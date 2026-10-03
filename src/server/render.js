import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const VIEWS_DIR = path.join(config.rootDir, 'views');

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** JSON an toàn để nhúng trong <script type="application/json">. */
function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * Render một view HTML (SSR kiểu đơn giản).
 * - {{title}}: tiêu đề đã escape.
 * - {{boot}}: JSON khởi tạo cho client (user, csrfToken, dev, ...).
 *
 * Thay thế MỘT LẦN bằng hàm (không dùng chuỗi thay thế) để:
 *  - ký tự đặc biệt như "$&" trong tên sơ đồ không làm hỏng HTML;
 *  - nội dung do người dùng nhập (vd tên sơ đồ chứa "{{boot}}") không bị thay thế lần hai.
 */
export async function renderView(res, viewFile, { title, user = null, session = null, status = 200, extra = {} } = {}) {
  const template = await readFile(path.join(VIEWS_DIR, viewFile), 'utf8');
  const boot = {
    user,
    // CSRF token chỉ đưa vào trang khi đã đăng nhập; client gửi lại qua header X-CSRF-Token.
    csrfToken: user && session ? session.csrfToken : undefined,
    appUrl: config.appUrl,
    dev: config.isDevelopment,
    ...extra,
  };
  const values = { title: esc(title), boot: safeJson(boot), theme: '' };
  const html = template.replace(/\{\{(title|boot|theme)\}\}/g, (_m, key) => values[key]);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(html);
}
