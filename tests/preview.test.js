import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview } from '../src/shared/preview.js';

test('sơ đồ trống → không có xem trước', () => {
  assert.equal(buildPreview([]), null);
  assert.equal(buildPreview(undefined), null);
});

test('xem trước gọn: hộp bao + các phần tử có màu', () => {
  const p = buildPreview([
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, style: { fill: '#fff', stroke: '#000' } },
    { id: 'b', type: 'ellipse', x: 200, y: 100, width: 80, height: 40, style: {} },
    { id: 'c', type: 'connector', x: 0, y: 0, points: [[100, 25], [200, 120]], style: { stroke: '#4f46e5' } },
    { id: 'd', type: 'embed', x: 0, y: 200, width: 320, height: 180 },
    { id: 'g', type: 'group', children: ['a', 'b'] },
  ]);
  assert.deepEqual(p.b, [0, 0, 320, 380]);
  assert.deepEqual(p.i.map((i) => i[0]), ['r', 'e', 'l', 'm']);
});

test('giới hạn số phần tử để phản hồi nhẹ', () => {
  const els = Array.from({ length: 500 }, (_, i) => ({ id: 'e' + i, type: 'rectangle', x: i, y: i, width: 5, height: 5 }));
  assert.equal(buildPreview(els, 60).i.length, 60);
});

test('không rò rỉ dữ liệu ảnh nặng vào xem trước', () => {
  const p = buildPreview([{ id: 'i', type: 'image', x: 0, y: 0, width: 10, height: 10, src: 'data:image/png;base64,' + 'A'.repeat(100000) }]);
  assert.ok(JSON.stringify(p).length < 200);
});
