import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.js';
import { fail } from '../server/http.js';
import { attachSession } from '../middleware/auth.js';
import { resolveSession } from '../services/auth/authService.js';
import { getStore } from '../services/storage/index.js';
import { getSharedDiagram } from '../services/diagrams/diagramService.js';

const router = Router();
const store = getStore();

const VIEWS_DIR = path.join(process.cwd(), 'views');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

/**
 * SSR kieu don gian: template HTML + inject user state qua data-attribute.
 * An toan XSS: user data chi duoc escape vao JSON string, client doc qua
 * JSON.parse — khong innerHTML user input.
 */

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function render(res, viewFile, { title, user = null, extra = {} }) {
  let html = await readFile(path.join(VIEWS_DIR, viewFile), 'utf8');
  const boot = {
    user,
    appUrl: config.appUrl,
    ...extra,
  };
  const json = JSON.stringify(boot).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  html = html
    .replaceAll('{{title}}', esc(title))
    .replaceAll('{{boot}}', json)
    .replaceAll('{{theme}}', '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(res.statusCode || 200).send(html);
}

/** HOME — landing page (public, hien dang nhap neu co session). */
router.get('/', async (req, res, next) => {
  try {
    const raw = req.cookies?.diagram_session;
    let user = null;
    if (raw) {
      const r = await resolveSession(raw);
      if (r) user = r.user;
    }
    await render(res, 'home.html', { title: 'Diagram — Tao so do tren canvas vo han', user });
  } catch (err) {
    next(err);
  }
});

/** Auth pages */
router.get('/login', async (req, res, next) => {
  try {
    const raw = req.cookies?.diagram_session;
    if (raw) {
      const r = await resolveSession(raw);
      if (r) return res.redirect('/diagrams');
    }
    await render(res, 'auth/login.html', { title: 'Dang nhap — Diagram' });
  } catch (err) {
    next(err);
  }
});

router.get('/register', async (req, res, next) => {
  try {
    const raw = req.cookies?.diagram_session;
    if (raw) {
      const r = await resolveSession(raw);
      if (r) return res.redirect('/diagrams');
    }
    await render(res, 'auth/register.html', { title: 'Dang ky — Diagram' });
  } catch (err) {
    next(err);
  }
});

/** Yeu cau dang nhap cho cac trang sau (redirect /login). */
async function requirePage(req, res, next) {
  const raw = req.cookies?.diagram_session;
  if (!raw) return res.redirect('/login');
  const r = await resolveSession(raw);
  if (!r) return res.redirect('/login');
  req.user = r.user;
  req.session = r.session;
  next();
}

router.get('/create', requirePage, async (req, res, next) => {
  try {
    await render(res, 'editor/editor.html', {
      title: 'Tao so do — Diagram',
      user: req.user,
      extra: { mode: 'create' },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/edit/:id', requirePage, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) return fail(res, 'NOT_FOUND', 'Khong tim thay so do.', 404);
    const diagram = await store.diagram.getDiagram(id);
    if (!diagram || diagram.ownerId !== req.user.id) {
      // 404 de khong phoi lo ton tai — dong bo voi API
      return render404(req, res);
    }
    await render(res, 'editor/editor.html', {
      title: `${diagram.name} — Diagram`,
      user: req.user,
      extra: { mode: 'edit', diagram },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/diagrams', requirePage, async (req, res, next) => {
  try {
    await render(res, 'diagrams/list.html', { title: 'So do cua ban — Diagram', user: req.user });
  } catch (err) {
    next(err);
  }
});

router.get('/settings', requirePage, async (req, res, next) => {
  try {
    await render(res, 'settings/settings.html', { title: 'Cai dat — Diagram', user: req.user });
  } catch (err) {
    next(err);
  }
});

/** /admin — chi admin (server check role, redirect 403 page neu khong). */
router.get('/admin', requirePage, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return render403(req, res);
    }
    await render(res, 'admin/admin.html', { title: 'Quan ly — Diagram', user: req.user });
  } catch (err) {
    next(err);
  }
});

/** /share/:token — public, read-only, khong yeu cau login. */
router.get('/share/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
      return render(res, 'share/missing.html', { title: 'Lien ket khong ton tai — Diagram' });
    }
    try {
      const data = await getSharedDiagram(token);
      await render(res, 'share/view.html', {
        title: `${data.diagram.name} — Diagram (chi xem)`,
        extra: { mode: 'share', shareData: data },
      });
    } catch {
      await render(res, 'share/missing.html', { title: 'Lien ket khong ton tai — Diagram' });
    }
  } catch (err) {
    next(err);
  }
});

async function render404(req, res) {
  await render(res, 'errors/404.html', { title: '404 — Diagram' });
}
async function render403(req, res) {
  await render(res, 'errors/403.html', { title: '403 — Diagram' });
}

// Method protection cho trang: GET only
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return fail(res, 'METHOD_NOT_ALLOWED', 'Trang chi ho tro GET.', 405);
  }
  next();
});

// 404 page (cuoi cung)
router.use(async (req, res) => {
  const wantsJson = req.path.startsWith('/api/');
  if (wantsJson) {
    return fail(res, 'NOT_FOUND', 'Khong tim thay endpoint.', 404);
  }
  await render404(req, res);
});

export default router;
