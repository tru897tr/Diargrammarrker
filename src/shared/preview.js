/**
 * Dữ liệu xem trước (thumbnail) rất gọn cho danh sách sơ đồ.
 * Không gửi nguyên sơ đồ (có thể chứa ảnh nặng) — chỉ hộp bao + màu của tối đa `max` phần tử.
 * Định dạng: { b: [minX, minY, w, h], i: [ [loại, ...số, màu...], ... ] }
 *   'r' hình hộp:  ['r', x, y, w, h, fill, stroke]
 *   'e' ellipse:   ['e', x, y, w, h, fill, stroke]
 *   'l' đường:     ['l', x1, y1, x2, y2, stroke]
 *   't' chữ:       ['t', x, y, w, h, màu]
 *   'm' phương tiện: ['m', x, y, w, h, 'image'|'video'|'embed']
 */
const POINT_TYPES = new Set(['line', 'arrow', 'connector']);
const MEDIA = new Set(['image', 'video', 'embed']);
const n = (v) => Math.round(Number(v) || 0);
const col = (v, d) => (typeof v === 'string' && v.length <= 24 ? v : d);

export function buildPreview(elements, max = 60) {
  if (!Array.isArray(elements)) return null;
  const items = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const e of elements) {
    if (items.length >= max) break;
    if (!e || e.type === 'group') continue;
    const st = e.style || {};
    if (POINT_TYPES.has(e.type)) {
      const p = e.points;
      if (!Array.isArray(p) || p.length < 2) continue;
      const a = p[0], b = p[p.length - 1];
      items.push(['l', n(a[0]), n(a[1]), n(b[0]), n(b[1]), col(st.stroke, '#64748b')]);
      grow(n(a[0]), n(a[1])); grow(n(b[0]), n(b[1]));
      continue;
    }
    const x = n(e.x), y = n(e.y), w = Math.max(1, n(e.width)), h = Math.max(1, n(e.height));
    if (e.type === 'text') items.push(['t', x, y, w, h, col(st.textColor, '#334155')]);
    else if (MEDIA.has(e.type)) items.push(['m', x, y, w, h, e.type]);
    else if (e.type === 'ellipse') items.push(['e', x, y, w, h, col(st.fill, 'none'), col(st.stroke, '#64748b')]);
    else items.push(['r', x, y, w, h, col(st.fill, 'none'), col(st.stroke, '#64748b')]);
    grow(x, y); grow(x + w, y + h);
  }
  if (!items.length || minX === Infinity) return null;
  return { b: [minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY)], i: items };
}
