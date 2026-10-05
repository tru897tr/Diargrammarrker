import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server/app.js';
import { createClient } from './helpers.js';

let server, base;
before(() => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

const data = (elements) => ({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, elements });
const canva = { id: 'e1', type: 'embed', x: 0, y: 0, width: 560, height: 329, provider: 'canva', embedUrl: 'https://www.canva.com/design/DAGBEKC8YbE/Qm3Stcq68MYnXpXUuQnSJQ/view?embed' };

test('tạo sơ đồ có nhúng Canva + ảnh GIF, đọc lại, danh sách có xem trước', async () => {
  const c = createClient(base);
  assert.equal((await c.register('apitest1')).status, 201);
  const gif = { id: 'g1', type: 'image', x: 0, y: 400, width: 100, height: 60, src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' };
  const created = await c.post('/api/v1/diagrams', { name: 'Có media', data: data([canva, gif, { id: 'r', type: 'rectangle', x: 700, y: 0, width: 100, height: 50, style: { fill: '#ef444480' } }]) });
  assert.equal(created.status, 201, created.text);
  const id = created.json.data.diagram.id;
  const got = await c.get(`/api/v1/diagrams/${id}`);
  assert.equal(got.json.data.diagram.data.elements.find((e) => e.id === 'e1').embedUrl, canva.embedUrl);
  const list = await c.get('/api/v1/diagrams');
  const item = list.json.data.diagrams.find((d) => d.id === id);
  assert.equal(item.elementCount, 3);
  assert.equal(item.mediaCount, 2);
  assert.ok(item.preview && item.preview.i.length === 3);
  assert.equal(JSON.stringify(item).includes('R0lGOD'), false, 'danh sách không được chứa dữ liệu ảnh');
});

test('từ chối nhúng tên miền lạ và ảnh javascript:', async () => {
  const c = createClient(base);
  await c.register('apitest2');
  const evil = await c.post('/api/v1/diagrams', { name: 'x', data: data([{ ...canva, embedUrl: 'https://evil.example.com/x' }]) });
  assert.equal(evil.status, 400);
  const js = await c.post('/api/v1/diagrams', { name: 'x', data: data([{ id: 'i', type: 'image', x: 0, y: 0, width: 5, height: 5, src: 'javascript:alert(1)' }]) });
  assert.equal(js.status, 400);
});

test('body lớn (ảnh tải lên) vượt giới hạn 512KB mặc định nhưng được phép trên /diagrams', async () => {
  const c = createClient(base);
  await c.register('apitest3');
  const big = 'data:image/png;base64,' + 'A'.repeat(1.5 * 1024 * 1024);
  const r = await c.post('/api/v1/diagrams', { name: 'ảnh lớn', data: data([{ id: 'i', type: 'image', x: 0, y: 0, width: 5, height: 5, src: big }]) });
  assert.equal(r.status, 201, r.text.slice(0, 200));
  const other = await c.patch('/api/v1/auth/profile', { username: 'apitest3', bio: 'x'.repeat(600 * 1024) });
  assert.ok([400, 404, 413].includes(other.status), 'các endpoint khác vẫn giữ giới hạn nhỏ: ' + other.status);
});

test('trang chia sẻ công khai trả về dữ liệu nhúng và CSP cho phép frame-src đúng tên miền', async () => {
  const c = createClient(base);
  await c.register('apitest4');
  const created = await c.post('/api/v1/diagrams', { name: 'Chia sẻ', data: data([canva]) });
  const id = created.json.data.diagram.id;
  const sh = await c.post(`/api/v1/diagrams/${id}/share`);
  const token = sh.json.data.share.token;
  const page = await fetch(`${base}/share/${token}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('present'), 'có nút trình chiếu');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /frame-src[^;]*https:\/\/\*\.canva\.com/);
  assert.match(csp, /frame-src[^;]*youtube-nocookie\.com/);
  assert.doesNotMatch(csp, /frame-src[^;]*evil/);
  assert.match(csp, /script-src 'self'/);
});

test('trang chủ: khách thấy landing, người đã đăng nhập thấy trang làm việc', async () => {
  const guest = await (await fetch(`${base}/`)).text();
  assert.ok(guest.includes('class="hero') || guest.includes('hero'), 'landing');
  assert.ok(!guest.includes('class="hu"'));
  const c = createClient(base);
  await c.register('apitest5');
  const home = await c.get('/');
  assert.ok(home.text.includes('class="hu"'), 'trang chủ đã đăng nhập');
});
