import { Router } from 'express';
import { fail } from '../server/http.js';
import { renderView } from '../server/render.js';
import { resolveSession } from '../services/auth/authService.js';
import { getStore } from '../services/storage/index.js';
import { getSharedDiagram } from '../services/diagrams/diagramService.js';

const router = Router();
const store = getStore();

/**
 * SSR kiểu đơn giản: template HTML + dữ liệu khởi tạo (user, csrfToken, dev...)
 * nhúng trong <script type="application/json" id="boot-data">.
 * An toàn XSS: dữ liệu người dùng chỉ được escape vào JSON, client đọc qua JSON.parse
 * — không dùng innerHTML với dữ liệu người dùng. Xem src/server/render.js.
 */

const render404 = (res) => renderView(res, 'errors/404.html', { title: '404 — Diagram', status: 404 });
const render403 = (res) => renderView(res, 'errors/403.html', { title: '403 — Diagram', status: 403 });

/** Đọc session từ cookie (nếu có). Trả về { user, session } hoặc null. */
async function currentSession(req) {
  const raw = req.cookies?.diagram_session;
  if (!raw) return null;
  return resolveSession(raw);
}

/** HOME — landing page (public, hiện trạng thái đăng nhập nếu có session). */
router.get('/', async (req, res, next) => {
  try {
    const r = await currentSession(req);
    await renderView(res, 'home.html', {
      title: 'Diagram — Tạo sơ đồ trên canvas vô hạn',
      user: r?.user ?? null,
      session: r?.session ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/** Trang đăng nhập / đăng ký (đã đăng nhập thì chuyển về danh sách sơ đồ). */
router.get('/login', async (req, res, next) => {
  try {
    if (await currentSession(req)) return res.redirect('/diagrams');
    await renderView(res, 'auth/login.html', { title: 'Đăng nhập — Diagram' });
  } catch (err) {
    next(err);
  }
});

router.get('/register', async (req, res, next) => {
  try {
    if (await currentSession(req)) return res.redirect('/diagrams');
    await renderView(res, 'auth/register.html', { title: 'Đăng ký — Diagram' });
  } catch (err) {
    next(err);
  }
});

/** Yêu cầu đăng nhập cho các trang sau (redirect /login). */
async function requirePage(req, res, next) {
  try {
    const r = await currentSession(req);
    if (!r) return res.redirect('/login');
    req.user = r.user;
    req.session = r.session;
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/create', requirePage, async (req, res, next) => {
  try {
    await renderView(res, 'editor/editor.html', {
      title: 'Tạo sơ đồ — Diagram',
      user: req.user,
      session: req.session,
      extra: { mode: 'create' },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/edit/:id', requirePage, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) return await render404(res);
    const diagram = await store.diagram.getDiagram(id);
    if (!diagram || diagram.ownerId !== req.user.id) {
      // 404 để không phơi lộ sự tồn tại — đồng bộ với API
      return await render404(res);
    }
    await renderView(res, 'editor/editor.html', {
      title: `${diagram.name} — Diagram`,
      user: req.user,
      session: req.session,
      extra: { mode: 'edit', diagram },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/diagrams', requirePage, async (req, res, next) => {
  try {
    await renderView(res, 'diagrams/list.html', {
      title: 'Sơ đồ của bạn — Diagram',
      user: req.user,
      session: req.session,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/settings', requirePage, async (req, res, next) => {
  try {
    await renderView(res, 'settings/settings.html', {
      title: 'Cài đặt — Diagram',
      user: req.user,
      session: req.session,
    });
  } catch (err) {
    next(err);
  }
});

/** /admin — chỉ admin (server kiểm tra role, trả trang 403 nếu không phải admin). */
router.get('/admin', requirePage, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return await render403(res);
    await renderView(res, 'admin/admin.html', {
      title: 'Quản lý — Diagram',
      user: req.user,
      session: req.session,
    });
  } catch (err) {
    next(err);
  }
});

/** /share/:token — public, chỉ đọc, không yêu cầu đăng nhập. */
router.get('/share/:token', async (req, res, next) => {
  const missing = () => renderView(res, 'share/missing.html', {
    title: 'Liên kết không tồn tại — Diagram',
    status: 404,
  });
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return await missing();

    let data;
    try {
      data = await getSharedDiagram(token);
    } catch (err) {
      // Chỉ "không tìm thấy" mới hiện trang missing; lỗi khác (bug, storage...) đi tới error handler.
      if (err.code === 'SHARE_NOT_FOUND') return await missing();
      throw err;
    }
    await renderView(res, 'share/view.html', {
      title: `${data.diagram.name} — Diagram (chỉ xem)`,
      extra: { mode: 'share', shareData: data },
    });
  } catch (err) {
    next(err);
  }
});

// Method protection cho trang: chỉ GET/HEAD
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return fail(res, 'METHOD_NOT_ALLOWED', 'Trang chỉ hỗ trợ GET.', 405);
  }
  next();
});

// Trang 404 (cuối cùng)
router.use(async (_req, res, next) => {
  try {
    await render404(res);
  } catch (err) {
    next(err);
  }
});

export default router;
