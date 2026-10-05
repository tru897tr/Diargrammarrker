import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramDataSchema } from '../src/validation/schema.js';

const base = { version: 1, viewport: { x: 0, y: 0, zoom: 1 } };
const parse = (elements) => diagramDataSchema.safeParse({ ...base, elements });
const box = (extra) => ({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60, ...extra });

test('các hình khối mới được chấp nhận', () => {
  for (const type of ['triangle', 'right-triangle', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'cylinder', 'document', 'cloud', 'callout', 'arrow-right', 'chevron', 'heart']) {
    assert.equal(parse([box({ type })]).success, true, type);
  }
});

test('màu: hex 3–8 số, rgb/hsl, tên màu; từ chối mã độc', () => {
  for (const c of ['#fff', '#ff880080', 'rgba(1,2,3,0.5)', 'hsl(210, 80%, 50%)', 'rebeccapurple', 'none', 'auto']) {
    assert.equal(parse([box({ style: { fill: c } })]).success, true, c);
  }
  for (const c of ['url(javascript:alert(1))', 'red;background:url(x)', '#12', '<script>', 'expression(alert(1))']) {
    assert.equal(parse([box({ style: { fill: c } })]).success, false, c);
  }
});

test('ảnh: chỉ nhận https hoặc data URI ảnh hợp lệ', () => {
  const img = (src) => parse([{ id: 'i', type: 'image', x: 0, y: 0, width: 10, height: 10, src }]);
  assert.equal(img('https://example.com/a.gif').success, true);
  assert.equal(img('data:image/gif;base64,R0lGODlhAQABAAAAACw=').success, true);
  assert.equal(img('javascript:alert(1)').success, false);
  assert.equal(img('http://example.com/a.png').success, false);
  assert.equal(img('data:text/html;base64,PHNjcmlwdD4=').success, false);
  assert.equal(parse([{ id: 'i', type: 'image', x: 0, y: 0 }]).success, false, 'thiếu src');
});

test('video: chỉ https', () => {
  const v = (src) => parse([{ id: 'v', type: 'video', x: 0, y: 0, width: 10, height: 10, src }]);
  assert.equal(v('https://cdn.example.com/clip.mp4').success, true);
  assert.equal(v('data:video/mp4;base64,AAAA').success, false);
  assert.equal(v('ftp://example.com/a.mp4').success, false);
});

test('nhúng: chỉ tên miền trong danh sách cho phép', () => {
  const e = (embedUrl) => parse([{ id: 'e', type: 'embed', x: 0, y: 0, width: 300, height: 200, embedUrl, provider: 'x' }]);
  assert.equal(e('https://www.canva.com/design/DAGBEKC8YbE/Qm3Stcq68MYnXpXUuQnSJQ/view?embed').success, true);
  assert.equal(e('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0').success, true);
  assert.equal(e('https://evil.example.com/x').success, false);
  assert.equal(e('http://www.youtube.com/embed/x').success, false);
  assert.equal(e('javascript:alert(1)').success, false);
});

test('tổng dung lượng ảnh tải lên trong một sơ đồ bị giới hạn', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(3.9 * 1024 * 1024);
  const imgs = [1, 2, 3].map((n) => ({ id: 'i' + n, type: 'image', x: 0, y: 0, width: 10, height: 10, src: big }));
  assert.equal(parse(imgs.slice(0, 2)).success, true);
  assert.equal(parse(imgs).success, false);
  const huge = 'data:image/png;base64,' + 'A'.repeat(5 * 1024 * 1024);
  assert.equal(parse([{ id: 'i', type: 'image', x: 0, y: 0, width: 10, height: 10, src: huge }]).success, false);
});

test('kiểu đường nối và đổ bóng', () => {
  assert.equal(parse([{ id: 'c', type: 'connector', x: 0, y: 0, points: [[0, 0], [10, 10]], style: { route: 'curve', shadow: true } }]).success, true);
  assert.equal(parse([{ id: 'c', type: 'connector', x: 0, y: 0, points: [[0, 0], [10, 10]], style: { route: 'zigzag' } }]).success, false);
});
