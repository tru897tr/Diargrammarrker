/* Diagram engine: tài liệu, lịch sử, canvas vô hạn, vẽ SVG, hit-test, màu.
 * Dùng chung cho trình soạn thảo (editor.js) và trang xem/chia sẻ (share-view.js).
 * Quy ước an toàn: chữ của người dùng chỉ đi vào DOM bằng textContent, không dùng innerHTML.
 */
(function () {
"use strict";

const SVGNS = "http://www.w3.org/2000/svg";
const GRID = 8;

/* ============ helpers ============ */

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
function uid() {
  return "e" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function snap(v) { return Math.round(v / GRID) * GRID; }
function rad(deg) { return (deg * Math.PI) / 180; }
function round(v, n = 2) { const k = 10 ** n; return Math.round(v * k) / k; }

/** Xoay điểm (px,py) quanh (cx,cy) một góc deg (độ, chiều kim đồng hồ trên màn hình). */
function rotatePoint(px, py, cx, cy, deg) {
  if (!deg) return [px, py];
  const r = rad(deg), c = Math.cos(r), s = Math.sin(r);
  const dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/* ============ màu sắc ============ */

const Color = (() => {
  let ctx2d = null;
  function canvasCtx() {
    if (ctx2d) return ctx2d;
    try { ctx2d = document.createElement("canvas").getContext("2d"); } catch { ctx2d = null; }
    return ctx2d;
  }
  const h2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }

  /** Phân tích mọi dạng màu CSS thường gặp → {r,g,b,a} (a: 0–1) hoặc null. "none"/"transparent" → a = 0. */
  function parse(input) {
    if (input == null) return null;
    let s = String(input).trim().toLowerCase();
    if (!s) return null;
    if (s === "none" || s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    // hex không có dấu #: "ff8800"
    if (/^[0-9a-f]{3,4}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/.test(s)) s = "#" + s;
    let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
      return {
        r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? round(parseInt(h.slice(6, 8), 16) / 255, 3) : 1,
      };
    }
    const num = (t) => (t.endsWith("%") ? parseFloat(t) : parseFloat(t));
    m = /^rgba?\(\s*([^)]+)\)$/.exec(s);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const ch = (t) => (t.endsWith("%") ? (parseFloat(t) / 100) * 255 : parseFloat(t));
      const r = ch(parts[0]), g = ch(parts[1]), b = ch(parts[2]);
      let a = 1;
      if (parts[3] != null) a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
      if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
      return { r: Math.round(clamp(r, 0, 255)), g: Math.round(clamp(g, 0, 255)), b: Math.round(clamp(b, 0, 255)), a: clamp(a, 0, 1) };
    }
    m = /^hsla?\(\s*([^)]+)\)$/.exec(s);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const h = parseFloat(parts[0]), sat = num(parts[1]), l = num(parts[2]);
      let a = 1;
      if (parts[3] != null) a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
      if ([h, sat, l, a].some((n) => Number.isNaN(n))) return null;
      return { ...hslToRgb(h, sat, l), a: clamp(a, 0, 1) };
    }
    // Tên màu CSS (red, tomato, rebeccapurple...) — nhờ canvas chuẩn hóa; hai lần thử để phát hiện tên sai.
    const c = canvasCtx();
    if (c && /^[a-z]{3,24}$/.test(s)) {
      c.fillStyle = "#010203"; c.fillStyle = s; const a = c.fillStyle;
      c.fillStyle = "#040506"; c.fillStyle = s; const b = c.fillStyle;
      if (a === b && /^#[0-9a-f]{6}$/.test(a)) return parse(a);
    }
    return null;
  }

  /** {r,g,b,a} → "#rrggbb" hoặc "#rrggbbaa" (khi có độ trong suốt). */
  function toHex(c, forceAlpha = false) {
    if (!c) return "#000000";
    const base = "#" + h2(c.r) + h2(c.g) + h2(c.b);
    return c.a < 1 || forceAlpha ? base + h2(c.a * 255) : base;
  }
  /** Chuỗi lưu trong tài liệu: "none" khi trong suốt hoàn toàn. */
  function normalize(input, fallback = null) {
    const c = parse(input);
    if (!c) return fallback;
    if (c.a === 0) return "none";
    return toHex(c);
  }
  function isNone(v) { const c = parse(v); return !v || !c || c.a === 0; }

  /** Gán fill/stroke cho node SVG, tách alpha thành *-opacity để tương thích mọi trình duyệt. */
  function paint(node, attr, value, fallback = "none") {
    const c = value == null ? parse(fallback) : parse(value);
    if (!c || c.a === 0) { node.setAttribute(attr, "none"); return; }
    node.setAttribute(attr, "#" + h2(c.r) + h2(c.g) + h2(c.b));
    if (c.a < 1) node.setAttribute(attr + "-opacity", String(round(c.a, 3)));
  }
  function luminance(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  return { parse, toHex, normalize, isNone, paint, hslToRgb, rgbToHsl, rgbToHsv, hsvToRgb, luminance };
})();

/* ============ đo chữ + ngắt dòng ============ */

const FONT_FAMILIES = {
  sans: '"Be Vietnam Pro", "Segoe UI", system-ui, -apple-system, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
};
function fontCss(style, size) {
  const fam = FONT_FAMILIES[style?.fontFamily] || FONT_FAMILIES.sans;
  return `${style?.fontStyle === "italic" ? "italic " : ""}${style?.fontWeight === "bold" ? "700 " : "400 "}${size}px ${fam}`;
}

const TextMeasure = (() => {
  let ctx = null;
  const cache = new Map();
  function get() {
    if (ctx) return ctx;
    try { ctx = document.createElement("canvas").getContext("2d"); } catch { ctx = null; }
    return ctx;
  }
  /** Chiều rộng một dòng chữ (px, ở cỡ chữ `size`). Dự phòng 0.56em/ký tự nếu không có canvas. */
  function width(text, style, size) {
    const c = get();
    if (!c) return String(text).length * size * 0.56;
    const font = fontCss(style, size);
    const key = font + "|" + text;
    let w = cache.get(key);
    if (w == null) {
      c.font = font;
      w = c.measureText(text).width;
      if (cache.size > 4000) cache.clear();
      cache.set(key, w);
    }
    return w;
  }
  return { width };
})();

/** Ngắt dòng theo chiều rộng thật của chữ; từ quá dài được cắt theo ký tự. */
function wrapText(text, style, size, maxWidth) {
  if (!text) return [];
  const out = [];
  for (const para of String(text).split("\n")) {
    if (maxWidth <= 0 || TextMeasure.width(para, style, size) <= maxWidth) { out.push(para); continue; }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const test = line + word;
      if (TextMeasure.width(test.trimEnd(), style, size) <= maxWidth) { line = test; continue; }
      if (line.trim()) { out.push(line.trimEnd()); line = ""; }
      if (/^\s+$/.test(word)) continue;
      // từ dài hơn cả dòng → cắt theo ký tự
      let chunk = "";
      for (const ch of word) {
        if (chunk && TextMeasure.width(chunk + ch, style, size) > maxWidth) { out.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    if (line.trim() || out.length === 0) out.push(line.trimEnd());
  }
  return out;
}

/* ============ kiểu mặc định ============ */

const BASE_SHAPE = { fill: "#eef2ff", stroke: "#4f46e5", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#1f2430" };
const DEFAULT_STYLES = {
  "rectangle":         { ...BASE_SHAPE, radius: 0 },
  "rounded-rectangle": { fill: "#e0f2fe", stroke: "#0284c7", strokeWidth: 2, radius: 16, fontSize: 15, textAlign: "center", textColor: "#0c4a6e" },
  "ellipse":           { fill: "#f0fdf4", stroke: "#059669", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#064e3b" },
  "diamond":           { fill: "#fdf4ff", stroke: "#a21caf", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#701a75" },
  "triangle":          { fill: "#fff7ed", stroke: "#ea580c", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#7c2d12" },
  "right-triangle":    { fill: "#fff7ed", stroke: "#ea580c", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#7c2d12" },
  "parallelogram":     { fill: "#ecfeff", stroke: "#0891b2", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#164e63" },
  "trapezoid":         { fill: "#f0fdfa", stroke: "#0d9488", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#134e4a" },
  "pentagon":          { fill: "#fefce8", stroke: "#ca8a04", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#713f12" },
  "hexagon":           { fill: "#faf5ff", stroke: "#9333ea", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#581c87" },
  "octagon":           { fill: "#fef2f2", stroke: "#dc2626", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#7f1d1d" },
  "star":              { fill: "#fef9c3", stroke: "#eab308", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#713f12" },
  "plus":              { fill: "#ecfdf5", stroke: "#10b981", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#064e3b" },
  "cylinder":          { fill: "#eff6ff", stroke: "#2563eb", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#1e3a8a" },
  "document":          { fill: "#f8fafc", stroke: "#475569", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#1e293b" },
  "cloud":             { fill: "#f0f9ff", stroke: "#0ea5e9", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#0c4a6e" },
  "callout":           { fill: "#fff1f2", stroke: "#e11d48", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#881337" },
  "arrow-right":       { fill: "#eef2ff", stroke: "#4f46e5", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#312e81" },
  "chevron":           { fill: "#fdf2f8", stroke: "#db2777", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#831843" },
  "heart":             { fill: "#fff1f2", stroke: "#f43f5e", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#881337" },
  "text":              { fill: "none", stroke: "none", fontSize: 18, textColor: "auto", textAlign: "left" },
  "note":              { fill: "#fde68a", stroke: "#d97706", strokeWidth: 1.5, radius: 4, fontSize: 14, textAlign: "left", textColor: "#78350f", shadow: true },
  "frame":             { fill: "none", stroke: "#94a3b8", strokeWidth: 2, radius: 12, fontSize: 13, textAlign: "left", textColor: "#64748b" },
  "line":              { stroke: "#475569", strokeWidth: 2, arrowStart: "none", arrowEnd: "none" },
  "arrow":             { stroke: "#475569", strokeWidth: 2, arrowStart: "none", arrowEnd: "arrow" },
  "connector":         { stroke: "#4f46e5", strokeWidth: 2, arrowStart: "none", arrowEnd: "arrow", route: "elbow" },
  "image":             { opacity: 1 },
  "video":             { opacity: 1 },
  "embed":             { opacity: 1 },
};

/* ============ thư viện hình khối (toạ độ thế giới) ============ */

function polyD(pts) { return "M" + pts.map((p) => `${round(p[0])} ${round(p[1])}`).join(" L") + " Z"; }
/** Co giãn một đa giác bất kỳ cho vừa khít khung (x,y,w,h). */
function fitPoly(pts, x, y, w, h) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of pts) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
  const sw = maxX - minX || 1, sh = maxY - minY || 1;
  return pts.map(([px, py]) => [x + ((px - minX) / sw) * w, y + ((py - minY) / sh) * h]);
}
function regularPoly(n, startDeg = -90) {
  return Array.from({ length: n }, (_, i) => {
    const a = rad(startDeg + (360 / n) * i);
    return [Math.cos(a), Math.sin(a)];
  });
}
function starPts() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.382;
    const a = rad(-90 + 36 * i);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}
/** Vẽ đường cong tham chiếu 100×H rồi co giãn vào khung. */
function scaled(d, refW, refH, x, y, w, h) {
  // chỉ gồm lệnh M C L Z V H với toạ độ tuyệt đối → có thể co giãn bằng cách nhân toạ độ
  const sx = w / refW, sy = h / refH;
  return d.replace(/([MLCVHZ])([^MLCVHZ]*)/g, (_m, cmd, args) => {
    const nums = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    if (cmd === "Z") return "Z";
    if (cmd === "H") return "H" + round(x + nums[0] * sx);
    if (cmd === "V") return "V" + round(y + nums[0] * sy);
    const out = [];
    for (let i = 0; i < nums.length; i += 2) out.push(round(x + nums[i] * sx) + " " + round(y + nums[i + 1] * sy));
    return cmd + out.join(" ");
  });
}

/** Mỗi hình: nhóm trong menu, nhãn, hàm tạo path, và vùng chữ (tỉ lệ l,t,r,b trong khung). */
const SHAPES = {
  "rectangle":         { group: "basic", label: "Chữ nhật", kind: "rect", text: [0, 0, 1, 1] },
  "rounded-rectangle": { group: "basic", label: "Chữ nhật bo góc", kind: "rect", text: [0.04, 0.04, 0.96, 0.96] },
  "ellipse":           { group: "basic", label: "Ellipse", kind: "ellipse", text: [0.15, 0.15, 0.85, 0.85] },
  "triangle":          { group: "basic", label: "Tam giác", text: [0.22, 0.42, 0.78, 0.95],
    path: (x, y, w, h) => polyD([[x + w / 2, y], [x + w, y + h], [x, y + h]]) },
  "right-triangle":    { group: "basic", label: "Tam giác vuông", text: [0.06, 0.4, 0.62, 0.95],
    path: (x, y, w, h) => polyD([[x, y], [x + w, y + h], [x, y + h]]) },
  "diamond":           { group: "basic", label: "Hình thoi", text: [0.25, 0.25, 0.75, 0.75],
    path: (x, y, w, h) => polyD([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]) },
  "parallelogram":     { group: "basic", label: "Bình hành", text: [0.15, 0.05, 0.85, 0.95],
    path: (x, y, w, h) => { const o = Math.min(w * 0.25, h * 0.6); return polyD([[x + o, y], [x + w, y], [x + w - o, y + h], [x, y + h]]); } },
  "trapezoid":         { group: "basic", label: "Hình thang", text: [0.12, 0.05, 0.88, 0.95],
    path: (x, y, w, h) => { const o = Math.min(w * 0.2, h * 0.6); return polyD([[x + o, y], [x + w - o, y], [x + w, y + h], [x, y + h]]); } },
  "pentagon":          { group: "basic", label: "Ngũ giác", text: [0.2, 0.25, 0.8, 0.9],
    path: (x, y, w, h) => polyD(fitPoly(regularPoly(5), x, y, w, h)) },
  "hexagon":           { group: "basic", label: "Lục giác", text: [0.14, 0.1, 0.86, 0.9],
    path: (x, y, w, h) => { const o = Math.min(w * 0.25, h * 0.5); return polyD([[x + o, y], [x + w - o, y], [x + w, y + h / 2], [x + w - o, y + h], [x + o, y + h], [x, y + h / 2]]); } },
  "octagon":           { group: "basic", label: "Bát giác", text: [0.1, 0.1, 0.9, 0.9],
    path: (x, y, w, h) => { const o = Math.min(w, h) * 0.29; return polyD([[x + o, y], [x + w - o, y], [x + w, y + o], [x + w, y + h - o], [x + w - o, y + h], [x + o, y + h], [x, y + h - o], [x, y + o]]); } },
  "star":              { group: "basic", label: "Sao 5 cánh", text: [0.28, 0.38, 0.72, 0.78],
    path: (x, y, w, h) => polyD(fitPoly(starPts(), x, y, w, h)) },
  "plus":              { group: "basic", label: "Dấu cộng", text: [0.33, 0.33, 0.67, 0.67],
    path: (x, y, w, h) => { const a = 0.33, b = 0.67; return polyD([[x + a * w, y], [x + b * w, y], [x + b * w, y + a * h], [x + w, y + a * h], [x + w, y + b * h], [x + b * w, y + b * h], [x + b * w, y + h], [x + a * w, y + h], [x + a * w, y + b * h], [x, y + b * h], [x, y + a * h], [x + a * w, y + a * h]]); } },
  "heart":             { group: "basic", label: "Trái tim", text: [0.22, 0.2, 0.78, 0.65],
    path: (x, y, w, h) => scaled("M50 88C10 56 -2 30 14 14C28 0 46 8 50 22C54 8 72 0 86 14C102 30 90 56 50 88Z".replace(/-2/g, "0").replace(/102/g, "100"), 100, 90, x, y, w, h) },
  "cylinder":          { group: "flow", label: "Cơ sở dữ liệu", text: [0.05, 0.28, 0.95, 0.95],
    path: (x, y, w, h) => {
      const ry = Math.min(h * 0.16, w / 4), rx = w / 2;
      return `M${round(x)} ${round(y + ry)}A${round(rx)} ${round(ry)} 0 0 1 ${round(x + w)} ${round(y + ry)}V${round(y + h - ry)}A${round(rx)} ${round(ry)} 0 0 1 ${round(x)} ${round(y + h - ry)}Z`
        + `M${round(x)} ${round(y + ry)}A${round(rx)} ${round(ry)} 0 0 0 ${round(x + w)} ${round(y + ry)}`;
    } },
  "document":          { group: "flow", label: "Tài liệu", text: [0.05, 0.05, 0.95, 0.75],
    path: (x, y, w, h) => scaled("M0 0L100 0L100 86C78 72 62 100 50 88C38 76 20 74 0 88Z", 100, 100, x, y, w, h) },
  "cloud":             { group: "flow", label: "Đám mây", text: [0.16, 0.26, 0.84, 0.82],
    path: (x, y, w, h) => scaled("M25 58C8 58 0 45 8 35C2 23 14 11 28 15C33 3 55 1 62 13C75 5 95 13 92 31C104 37 100 58 82 58Z".replace(/104/g, "100"), 100, 60, x, y, w, h) },
  "callout":           { group: "flow", label: "Bong bóng thoại", text: [0.04, 0.04, 0.96, 0.74],
    path: (x, y, w, h) => {
      const bh = h * 0.78, r = Math.min(14, w / 6, bh / 4);
      return `M${round(x + r)} ${round(y)}H${round(x + w - r)}Q${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + r)}V${round(y + bh - r)}Q${round(x + w)} ${round(y + bh)} ${round(x + w - r)} ${round(y + bh)}H${round(x + w * 0.42)}L${round(x + w * 0.2)} ${round(y + h)}L${round(x + w * 0.26)} ${round(y + bh)}H${round(x + r)}Q${round(x)} ${round(y + bh)} ${round(x)} ${round(y + bh - r)}V${round(y + r)}Q${round(x)} ${round(y)} ${round(x + r)} ${round(y)}Z`;
    } },
  "arrow-right":       { group: "flow", label: "Mũi tên khối", text: [0.04, 0.3, 0.62, 0.7],
    path: (x, y, w, h) => polyD([[x, y + h * 0.3], [x + w * 0.6, y + h * 0.3], [x + w * 0.6, y], [x + w, y + h / 2], [x + w * 0.6, y + h], [x + w * 0.6, y + h * 0.7], [x, y + h * 0.7]]) },
  "chevron":           { group: "flow", label: "Chevron", text: [0.25, 0.1, 0.72, 0.9],
    path: (x, y, w, h) => { const o = Math.min(w * 0.3, h * 0.6); return polyD([[x, y], [x + w - o, y], [x + w, y + h / 2], [x + w - o, y + h], [x, y + h], [x + o, y + h / 2]]); } },
};
const SHAPE_GROUPS = [
  { id: "basic", label: "Hình cơ bản" },
  { id: "flow", label: "Lưu đồ & chú thích" },
];

/** Các loại phần tử có "hộp" (x,y,width,height) — khác với đường (points). */
const POINT_TYPES = new Set(["line", "arrow", "connector"]);
const MEDIA_TYPES = new Set(["image", "video", "embed"]);
const isPointType = (t) => POINT_TYPES.has(t);

/* ============ hình học ============ */

/** Hộp chưa xoay của phần tử: {x,y,w,h}. Với đường: bao quanh các điểm. */
function elementBox(e) {
  if (e.type === "group") {
    const doc = e._doc;
    const b = doc ? boundsOf(doc.leaves([e.id]).map((id) => doc.byId(id)).filter(Boolean)) : null;
    return b ? { x: b.minX, y: b.minY, w: b.w, h: b.h } : { x: e.x || 0, y: e.y || 0, w: 0, h: 0 };
  }
  if (isPointType(e.type) && e.points && e.points.length) {
    const pts = routePoints(e);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of pts) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: e.x || 0, y: e.y || 0, w: e.width || 0, h: e.height || 0 };
}
function elementCenter(e) {
  const b = elementBox(e);
  return [b.x + b.w / 2, b.y + b.h / 2];
}
/** 4 góc đã xoay theo thứ tự: trái-trên, phải-trên, phải-dưới, trái-dưới. */
function elementCorners(e) {
  const b = elementBox(e);
  const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
  const rot = isPointType(e.type) ? 0 : e.rotation || 0;
  return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([px, py]) => rotatePoint(px, py, cx, cy, rot));
}
/** Hộp bao (AABB) trong toạ độ thế giới, đã tính góc xoay. */
function worldBBox(e) {
  const cs = elementCorners(e);
  const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function boundsOf(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of elements) {
    if (e.type === "group") continue;
    const b = worldBBox(e);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/* ============ kết nối (connector) ============ */

const SIDE_DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Điểm neo trên cạnh của hình (có tính xoay). */
function anchorPoint(shape, side) {
  const w = shape.width || 0, h = shape.height || 0;
  let p;
  switch (side) {
    case "top": p = [shape.x + w / 2, shape.y]; break;
    case "bottom": p = [shape.x + w / 2, shape.y + h]; break;
    case "left": p = [shape.x, shape.y + h / 2]; break;
    case "right": p = [shape.x + w, shape.y + h / 2]; break;
    default: p = [shape.x + w / 2, shape.y + h / 2];
  }
  return rotatePoint(p[0], p[1], shape.x + w / 2, shape.y + h / 2, shape.rotation || 0);
}
/** Cạnh gần điểm world nhất (trong hệ toạ độ của hình, đã bỏ xoay). */
function nearestSide(shape, world) {
  const w = shape.width || 1, h = shape.height || 1;
  const cx = shape.x + w / 2, cy = shape.y + h / 2;
  const [lx, ly] = rotatePoint(world.x ?? world[0], world.y ?? world[1], cx, cy, -(shape.rotation || 0));
  const dx = lx - cx, dy = ly - cy;
  return Math.abs(dx) * h > Math.abs(dy) * w ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top");
}
/** Hướng thoát của một cạnh sau khi hình xoay. */
function sideDirection(shape, side) {
  const d = SIDE_DIR[side];
  if (!d) return [0, 0];
  const r = rad(shape?.rotation || 0);
  return [d[0] * Math.cos(r) - d[1] * Math.sin(r), d[0] * Math.sin(r) + d[1] * Math.cos(r)];
}

/**
 * Cập nhật điểm đầu/cuối của đường nối theo hình mà nó gắn vào.
 * Cạnh nối (startSide/endSide) có thể do người dùng chọn cố định; nếu để trống thì tự chọn cạnh
 * quay về phía đầu bên kia và tính lại mỗi lần (lưu tạm ở _ss/_es, không ghi vào dữ liệu).
 */
function updateConnectorPoints(doc, conn) {
  const start = conn.startId ? doc.byId(conn.startId) : null;
  const end = conn.endId ? doc.byId(conn.endId) : null;
  const pts = conn.points && conn.points.length >= 2 ? conn.points : [[conn.x || 0, conn.y || 0], [conn.x || 0, conn.y || 0]];
  let p0 = pts[0], p1 = pts[pts.length - 1];
  const centerOf = (s) => [s.x + (s.width || 0) / 2, s.y + (s.height || 0) / 2];
  conn._ss = conn._es = undefined;
  // Mục tiêu để chọn cạnh: tâm hình ở đầu kia (nếu có) hoặc điểm tự do
  const aim0 = end ? centerOf(end) : p1;
  const aim1 = start ? centerOf(start) : p0;
  if (start) {
    const side = conn.startSide || nearestSide(start, aim0);
    conn._ss = side;
    p0 = anchorPoint(start, side);
  }
  if (end) {
    const side = conn.endSide || nearestSide(end, start ? anchorPoint(start, conn._ss) : aim1);
    conn._es = side;
    p1 = anchorPoint(end, side);
  }
  conn.points = [p0, ...pts.slice(1, -1), p1];
}

/** Tạo danh sách điểm (đa tuyến) mô tả đường đi của line/arrow/connector. */
function routePoints(e) {
  const pts = e.points || [];
  if (pts.length < 2) return pts;
  const route = e.style?.route;
  if (e.type !== "connector" && !route) return pts;
  if (!route || route === "straight" || pts.length > 2) return pts;
  const p0 = pts[0], p1 = pts[pts.length - 1];
  const doc = e._doc;
  const sShape = e.startId && doc ? doc.byId(e.startId) : null;
  const eShape = e.endId && doc ? doc.byId(e.endId) : null;
  const ss = e.startSide || e._ss, es = e.endSide || e._es;
  const d0 = ss && sShape ? sideDirection(sShape, ss) : null;
  const d1 = es && eShape ? sideDirection(eShape, es) : null;
  if (route === "curve") {
    const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const k = Math.max(30, dist / 2.5);
    const c1 = d0 ? [p0[0] + d0[0] * k, p0[1] + d0[1] * k] : [p0[0] + (p1[0] - p0[0]) / 3, p0[1]];
    const c2 = d1 ? [p1[0] + d1[0] * k, p1[1] + d1[1] * k] : [p1[0] - (p1[0] - p0[0]) / 3, p1[1]];
    const out = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      out.push([
        u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p1[0],
        u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p1[1],
      ]);
    }
    out._bezier = [p0, c1, c2, p1];
    return out;
  }
  // elbow: đường gấp khúc vuông góc
  const horiz = (d) => d && Math.abs(d[0]) >= Math.abs(d[1]);
  const gap = 24;
  const h0 = d0 ? horiz(d0) : Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]);
  const h1 = d1 ? horiz(d1) : h0;
  if (h0 && h1) {
    const facing = d0 && d1 && d0[0] * (p1[0] - p0[0]) > 0 && d1[0] * (p0[0] - p1[0]) > 0;
    if (!d0 || !d1 || facing) { const mx = (p0[0] + p1[0]) / 2; return [p0, [mx, p0[1]], [mx, p1[1]], p1]; }
    const X = d0[0] > 0 ? Math.max(p0[0], p1[0]) + gap : Math.min(p0[0], p1[0]) - gap;
    return [p0, [X, p0[1]], [X, p1[1]], p1];
  }
  if (!h0 && !h1) {
    const facing = d0 && d1 && d0[1] * (p1[1] - p0[1]) > 0 && d1[1] * (p0[1] - p1[1]) > 0;
    if (!d0 || !d1 || facing) { const my = (p0[1] + p1[1]) / 2; return [p0, [p0[0], my], [p1[0], my], p1]; }
    const Y = d0[1] > 0 ? Math.max(p0[1], p1[1]) + gap : Math.min(p0[1], p1[1]) - gap;
    return [p0, [p0[0], Y], [p1[0], Y], p1];
  }
  return h0 ? [p0, [p1[0], p0[1]], p1] : [p0, [p0[0], p1[1]], p1];
}

/* ============ tài liệu ============ */

const COPY_FIELDS = ["src", "embedUrl", "provider", "title", "alt", "lockRatio", "loop", "muted", "autoplay", "controls"];

class DiagramDoc {
  constructor(data) {
    this.version = 1;
    this.viewport = { x: 0, y: 0, zoom: 1 };
    this.elements = [];
    if (data) {
      this.viewport = { x: 0, y: 0, zoom: 1, ...(data.viewport || {}) };
      this.elements = (data.elements || []).map((e) => this.migrate(e));
    }
    this.bindDoc();
  }

  /** Gắn tham chiếu ẩn _doc để routePoints() tra cứu hình đầu/cuối (không được serialize). */
  bindDoc() {
    for (const e of this.elements) Object.defineProperty(e, "_doc", { value: this, enumerable: false, configurable: true, writable: true });
  }

  migrate(e) {
    const out = {
      id: e.id || uid(),
      type: e.type,
      x: e.x || 0,
      y: e.y || 0,
      width: e.width ?? 0,
      height: e.height ?? 0,
      points: e.points ? e.points.map((p) => [...p]) : undefined,
      rotation: e.rotation || 0,
      text: e.text || "",
      style: { ...(DEFAULT_STYLES[e.type] || {}), ...(e.style || {}) },
      startId: e.startId,
      endId: e.endId,
      startSide: e.startSide,
      endSide: e.endSide,
      children: e.children ? [...e.children] : undefined,
    };
    for (const k of COPY_FIELDS) if (e[k] !== undefined) out[k] = e[k];
    if (out.type === "text" && !out.width) fitText(out);
    Object.defineProperty(out, "_doc", { value: this, enumerable: false, configurable: true, writable: true });
    return out;
  }
  migrateAll(elements) { return elements.map((e) => this.migrate(e)); }

  serialize() {
    return {
      version: 1,
      viewport: { x: round(this.viewport.x, 2), y: round(this.viewport.y, 2), zoom: round(this.viewport.zoom, 4) },
      elements: this.elements.map((e) => {
        const out = { id: e.id, type: e.type, x: round(e.x), y: round(e.y) };
        if (e.width) out.width = round(e.width);
        if (e.height) out.height = round(e.height);
        if (e.points) out.points = e.points.map((p) => [round(p[0]), round(p[1])]);
        if (e.rotation) out.rotation = round(e.rotation);
        if (e.text) out.text = e.text;
        if (e.style) out.style = { ...e.style };
        if (e.startId) out.startId = e.startId;
        if (e.endId) out.endId = e.endId;
        if (e.startSide) out.startSide = e.startSide;
        if (e.endSide) out.endSide = e.endSide;
        if (e.children) out.children = [...e.children];
        for (const k of COPY_FIELDS) if (e[k] !== undefined && e[k] !== "") out[k] = e[k];
        return out;
      }),
    };
  }

  replaceFrom(data) {
    this.elements = (data.elements || []).map((e) => this.migrate(e));
    this.viewport = { x: 0, y: 0, zoom: 1, ...(data.viewport || {}) };
  }

  byId(id) { return this.elements.find((e) => e.id === id); }
  bounds(elements) { return boundsOf(elements); }

  add(element) {
    Object.defineProperty(element, "_doc", { value: this, enumerable: false, configurable: true, writable: true });
    this.elements.push(element);
    return element;
  }

  /** Nhóm cha trực tiếp của phần tử (nếu có). */
  parentOf(id) { return this.elements.find((g) => g.type === "group" && g.children?.includes(id)) || null; }
  /** Nhóm ngoài cùng chứa phần tử; nếu không thuộc nhóm nào trả về chính nó. */
  rootOf(e) {
    let cur = e, p;
    while ((p = this.parentOf(cur.id))) cur = p;
    return cur;
  }
  /** Mở rộng danh sách id: nhóm → tất cả phần tử con (đệ quy), loại bỏ nhóm. */
  leaves(ids) {
    const out = new Set();
    const walk = (id) => {
      const e = this.byId(id);
      if (!e) return;
      if (e.type === "group") (e.children || []).forEach(walk); else out.add(id);
    };
    ids.forEach(walk);
    return [...out];
  }
  /** Mở rộng id: giữ cả nhóm lẫn mọi phần tử con (dùng khi xóa/sao chép/đổi lớp). */
  withDescendants(ids) {
    const out = new Set();
    const walk = (id) => {
      const e = this.byId(id);
      if (!e || out.has(id)) return;
      out.add(id);
      if (e.type === "group") (e.children || []).forEach(walk);
    };
    ids.forEach(walk);
    return [...out];
  }

  remove(ids) {
    const set = new Set(this.withDescendants(ids));
    this.elements = this.elements.filter((e) => !set.has(e.id));
    // Đường nối gắn vào hình đã xóa: giữ lại nhưng thả đầu nối (không xóa mất nét vẽ của người dùng)
    for (const e of this.elements) {
      if (e.startId && set.has(e.startId)) { e.startId = undefined; e.startSide = undefined; }
      if (e.endId && set.has(e.endId)) { e.endId = undefined; e.endSide = undefined; }
      if (e.type === "group") e.children = (e.children || []).filter((c) => !set.has(c));
    }
    this.elements = this.elements.filter((e) => !(e.type === "group" && (!e.children || e.children.length === 0)));
  }

  /** Đổi thứ tự lớp: mode = "front" | "back" | "forward" | "backward". Nhận danh sách id đã mở rộng. */
  reorder(ids, mode) {
    const set = new Set(this.withDescendants(ids));
    const picked = this.elements.filter((e) => set.has(e.id));
    if (!picked.length) return;
    if (mode === "front") {
      this.elements = [...this.elements.filter((e) => !set.has(e.id)), ...picked];
    } else if (mode === "back") {
      this.elements = [...picked, ...this.elements.filter((e) => !set.has(e.id))];
    } else if (mode === "forward") {
      for (let i = this.elements.length - 2; i >= 0; i--) {
        if (set.has(this.elements[i].id) && !set.has(this.elements[i + 1].id)) {
          [this.elements[i], this.elements[i + 1]] = [this.elements[i + 1], this.elements[i]];
        }
      }
    } else if (mode === "backward") {
      for (let i = 1; i < this.elements.length; i++) {
        if (set.has(this.elements[i].id) && !set.has(this.elements[i - 1].id)) {
          [this.elements[i], this.elements[i - 1]] = [this.elements[i - 1], this.elements[i]];
        }
      }
    }
  }
  zTop(id) { this.reorder([id], "front"); }
  zBottom(id) { this.reorder([id], "back"); }

  /** Cập nhật mọi đường nối đang gắn vào hình. */
  refreshConnectors() {
    for (const e of this.elements) {
      if (isPointType(e.type) && (e.startId || e.endId)) updateConnectorPoints(this, e);
    }
  }
}

/* ============ lịch sử hoàn tác / làm lại ============ */

/**
 * Lưu danh sách trạng thái (ảnh chụp JSON) sau mỗi thao tác; con trỏ `index` trỏ vào trạng thái hiện tại.
 * Hoàn tác = lùi con trỏ, làm lại = tiến con trỏ. Trạng thái đầu tiên là lúc mở sơ đồ.
 * commit(label, key): các lần commit liên tiếp cùng `key` trong 900ms được gộp thành một bước
 * (vd kéo thanh chọn màu, gõ số) để Ctrl+Z không phải bấm hàng chục lần.
 */
class History {
  constructor(doc, onChange) {
    this.doc = doc;
    this.onChange = onChange || (() => {});
    this.states = [{ label: "open", key: null, t: 0, data: JSON.stringify(doc.serialize()) }];
    this.index = 0;
    this.limit = 100;
  }
  commit(label, key = null) {
    const data = JSON.stringify(this.doc.serialize());
    if (data === this.states[this.index].data) return false; // không có gì thay đổi
    const now = Date.now();
    const cur = this.states[this.index];
    this.states.length = this.index + 1; // bỏ nhánh "làm lại" cũ
    if (key && cur.key === key && now - cur.t < 900 && this.index > 0) {
      cur.data = data; cur.t = now;
    } else {
      this.states.push({ label, key, t: now, data });
      if (this.states.length > this.limit) this.states.shift();
      this.index = this.states.length - 1;
    }
    this.onChange("commit");
    return true;
  }
  /** Tương thích mã cũ. */
  snapshot(label, key) { return this.commit(label, key); }
  undo() {
    if (!this.canUndo) return false;
    this.index--;
    this.restore();
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.index++;
    this.restore();
    return true;
  }
  restore() {
    const keepViewport = { ...this.doc.viewport };
    const parsed = JSON.parse(this.states[this.index].data);
    this.doc.replaceFrom(parsed);
    this.doc.viewport = keepViewport; // hoàn tác không làm nhảy khung nhìn
    this.onChange("restore");
  }
  /** Đánh dấu trạng thái hiện tại là mốc "đã lưu". */
  markSaved() { this.savedIndex = this.index; this.savedData = this.states[this.index].data; }
  get isAtSaved() { return this.savedData === this.states[this.index].data; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.states.length - 1; }
}

/* ============ chữ trong hình ============ */

function lineHeightOf(fs) { return fs * 1.3; }

/** Tự tính lại kích thước khung của phần tử "text" (chữ trần) theo nội dung. */
function fitText(e) {
  const s = e.style || {};
  const fs = s.fontSize || 18;
  const lines = String(e.text || "").split("\n");
  let w = 0;
  for (const l of lines) w = Math.max(w, TextMeasure.width(l, s, fs));
  e.width = Math.max(24, Math.ceil(w) + 8);
  e.height = Math.ceil(lines.length * lineHeightOf(fs)) + 6;
}

/** Vùng chứa chữ bên trong hình (toạ độ thế giới, chưa xoay). */
function textBoxOf(e) {
  const w = e.width || 0, h = e.height || 0;
  const def = SHAPES[e.type]?.text || [0, 0, 1, 1];
  const pad = 8;
  let x = e.x + def[0] * w + pad, y = e.y + def[1] * h + pad;
  let tw = (def[2] - def[0]) * w - pad * 2, th = (def[3] - def[1]) * h - pad * 2;
  if (e.type === "frame") { y = e.y + 6; th = 28; x = e.x + 12; tw = w - 24; }
  return { x, y, w: Math.max(8, tw), h: Math.max(8, th) };
}

/* ============ vẽ phần tử ra SVG ============ */

function dashFor(s) {
  if (s.strokeDasharray) return s.strokeDasharray;
  if (s.lineType === "dashed") return "8 6";
  if (s.lineType === "dotted") return "2 5";
  return "";
}
function applyStroke(node, s, fallbackColor = "none", fallbackWidth = 2) {
  Color.paint(node, "stroke", s.stroke, fallbackColor);
  node.setAttribute("stroke-width", String(s.strokeWidth ?? fallbackWidth));
  const dash = dashFor(s);
  if (dash) node.setAttribute("stroke-dasharray", dash);
  node.setAttribute("stroke-linejoin", "round");
}

const Render = {
  /** Vẽ một phần tử thành <g>. Luôn tạo mới — đơn giản và an toàn (xem CanvasView.renderContent cho bản có cache). */
  element(e) {
    const g = el("g", { "data-id": e.id, class: "element-node", "data-type": e.type });
    const s = e.style || {};
    if (s.opacity != null && s.opacity < 1) g.setAttribute("opacity", String(s.opacity));
    if (s.shadow) g.setAttribute("filter", "url(#dg-shadow)");
    const pointy = isPointType(e.type);
    if (!pointy && e.rotation) {
      const [cx, cy] = elementCenter(e);
      g.setAttribute("transform", `rotate(${e.rotation} ${cx} ${cy})`);
    }
    const w = e.width || 0, h = e.height || 0;

    switch (e.type) {
      case "rectangle": case "rounded-rectangle": case "note": case "frame": {
        const r = Math.min(s.radius || 0, w / 2, h / 2);
        const n = el("rect", { x: e.x, y: e.y, width: w, height: h, rx: r });
        Color.paint(n, "fill", s.fill);
        applyStroke(n, s, "none", 1.5);
        g.appendChild(n);
        break;
      }
      case "ellipse": {
        const n = el("ellipse", { cx: e.x + w / 2, cy: e.y + h / 2, rx: w / 2, ry: h / 2 });
        Color.paint(n, "fill", s.fill);
        applyStroke(n, s, "none", 1.5);
        g.appendChild(n);
        break;
      }
      case "line": case "arrow": case "connector": {
        const pts = routePoints(e);
        if (pts.length >= 2) {
          let d;
          if (pts._bezier) {
            const [a, b, c, f] = pts._bezier;
            d = `M${a[0]} ${a[1]}C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${f[0]} ${f[1]}`;
          } else {
            d = "M" + pts.map((p) => `${round(p[0])} ${round(p[1])}`).join("L");
          }
          const n = el("path", { d, fill: "none", "stroke-linecap": "round" });
          applyStroke(n, s, "#475569", 2);
          g.appendChild(n);
          this.arrows(g, pts, s);
        }
        break;
      }
      case "text": {
        if (!e.width) fitText(e);
        const fs = s.fontSize || 18, lh = lineHeightOf(fs);
        const lines = String(e.text || "").split("\n");
        const anchor = s.textAlign === "center" ? "middle" : s.textAlign === "right" ? "end" : "start";
        const tx = anchor === "middle" ? e.x + e.width / 2 : anchor === "end" ? e.x + e.width - 4 : e.x + 4;
        g.appendChild(this.textNode(lines, tx, e.y + 3, lh, anchor, s, fs));
        break;
      }
      case "image": {
        const img = el("image", { x: e.x, y: e.y, width: w, height: h, preserveAspectRatio: "none" });
        if (e.src) img.setAttribute("href", e.src);
        if (e.alt) img.setAttribute("aria-label", e.alt);
        g.appendChild(img);
        break;
      }
      case "video": case "embed": case "group":
        // video/nhúng do MediaLayer vẽ bằng HTML; nhóm chỉ là vỏ logic.
        break;
      default: {
        const def = SHAPES[e.type];
        if (def && def.path) {
          const n = el("path", { d: def.path(e.x, e.y, w, h) });
          Color.paint(n, "fill", s.fill);
          applyStroke(n, s, "none", 1.5);
          g.appendChild(n);
        }
      }
    }

    // Nhãn chữ của hình
    if (e.text && !["text", "line", "arrow", "connector", "image", "video", "embed", "group"].includes(e.type)) {
      const fs = s.fontSize || 15;
      const tb = textBoxOf(e);
      const lh = lineHeightOf(fs);
      const lines = wrapText(e.text, s, fs, tb.w);
      const align = s.textAlign || "center";
      const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
      const tx = anchor === "start" ? tb.x : anchor === "end" ? tb.x + tb.w : tb.x + tb.w / 2;
      const total = lines.length * lh;
      const topAligned = e.type === "note" || e.type === "frame";
      const top = topAligned ? tb.y : tb.y + Math.max(0, (tb.h - total) / 2);
      g.appendChild(this.textNode(lines, tx, top, lh, anchor, s, fs));
    }
    return g;
  },

  textNode(lines, tx, top, lh, anchor, s, fs) {
    const t = el("text", {
      "text-anchor": anchor, "font-size": fs, "dominant-baseline": "central",
      "font-family": FONT_FAMILIES[s.fontFamily] || FONT_FAMILIES.sans,
      "font-weight": s.fontWeight === "bold" ? "700" : "400",
      "font-style": s.fontStyle === "italic" ? "italic" : "normal",
      "pointer-events": "none",
    });
    // "auto": chữ tự đổi theo giao diện sáng/tối (var --canvas-ink); màu khác thì dùng đúng màu đã chọn
    if (s.textColor === "auto") t.style.fill = "var(--canvas-ink, #1f2430)";
    else Color.paint(t, "fill", s.textColor, "#1f2430");
    if (s.textDecoration === "underline") t.setAttribute("text-decoration", "underline");
    lines.forEach((line, i) => {
      const ts = el("tspan", { x: tx, y: round(top + lh * (i + 0.5)) });
      ts.textContent = line === "" ? "\u200b" : line; // textContent = an toàn XSS
      t.appendChild(ts);
    });
    return t;
  },

  /** Cập nhật tại chỗ một node ảnh (tránh gán lại data URI hàng MB mỗi khung hình khi kéo). */
  patchImage(g, e) {
    const img = g.firstChild;
    if (!img) return;
    img.setAttribute("x", e.x); img.setAttribute("y", e.y);
    img.setAttribute("width", e.width || 0); img.setAttribute("height", e.height || 0);
    const s = e.style || {};
    if (s.opacity != null && s.opacity < 1) g.setAttribute("opacity", String(s.opacity)); else g.removeAttribute("opacity");
    if (e.rotation) { const [cx, cy] = elementCenter(e); g.setAttribute("transform", `rotate(${e.rotation} ${cx} ${cy})`); } else g.removeAttribute("transform");
    if (s.shadow) g.setAttribute("filter", "url(#dg-shadow)"); else g.removeAttribute("filter");
  },

  arrows(g, points, style) {
    const head = (kind, from, tip) => {
      if (!kind || kind === "none") return;
      const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
      const sw = style.strokeWidth ?? 2;
      const size = 9 + sw * 1.6;
      const back = Math.PI / 6.5;
      const p1 = [tip[0] - size * Math.cos(angle - back), tip[1] - size * Math.sin(angle - back)];
      const p2 = [tip[0] - size * Math.cos(angle + back), tip[1] - size * Math.sin(angle + back)];
      if (kind === "triangle") {
        const n = el("polygon", { points: `${tip[0]},${tip[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`, "stroke-linejoin": "round" });
        Color.paint(n, "fill", style.stroke, "#475569");
        Color.paint(n, "stroke", style.stroke, "#475569");
        n.setAttribute("stroke-width", "1");
        g.appendChild(n);
      } else {
        const n = el("path", { d: `M${p1[0]} ${p1[1]}L${tip[0]} ${tip[1]}L${p2[0]} ${p2[1]}`, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
        Color.paint(n, "stroke", style.stroke, "#475569");
        n.setAttribute("stroke-width", String(sw));
        g.appendChild(n);
      }
    };
    // tìm điểm khác biệt gần đầu/cuối nhất để tính hướng (tránh đoạn có độ dài 0)
    const far = (arr, from, step) => {
      for (let i = from; i >= 0 && i < arr.length; i += step) {
        if (Math.hypot(arr[i][0] - arr[from - step][0], arr[i][1] - arr[from - step][1]) > 0.5) return arr[i];
      }
      return null;
    };
    const n = points.length;
    if (n < 2) return;
    const startRef = far(points, 1, 1), endRef = far(points, n - 2, -1);
    if (startRef) head(style.arrowStart, startRef, points[0]);
    if (endRef) head(style.arrowEnd, endRef, points[n - 1]);
  },
};

/* ============ hit-test ============ */

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(px, py, pts[i], pts[i + 1]));
  return best;
}

/** Phần tử trên cùng tại điểm world (wx, wy). tol = độ nhạy tính theo đơn vị thế giới. */
function hitTest(doc, wx, wy, tol = 6, opts = {}) {
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const e = doc.elements[i];
    if (e.type === "group") continue;
    if (opts.skip && opts.skip.has(e.id)) continue;
    if (opts.only && !opts.only(e)) continue;
    const s = e.style || {};
    if (isPointType(e.type)) {
      const pts = routePoints(e);
      if (pts.length >= 2 && distToPolyline(wx, wy, pts) <= tol + (s.strokeWidth || 2) / 2) return e;
      continue;
    }
    const b = elementBox(e);
    const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
    const [lx, ly] = rotatePoint(wx, wy, cx, cy, -(e.rotation || 0));
    const inside = lx >= b.x - tol && lx <= b.x + b.w + tol && ly >= b.y - tol && ly <= b.y + b.h + tol;
    if (!inside) continue;
    const edge = Math.min(Math.abs(lx - b.x), Math.abs(lx - b.x - b.w), Math.abs(ly - b.y), Math.abs(ly - b.y - b.h));
    if (e.type === "frame") {
      if (edge <= tol + 2 || (ly <= b.y + 30 && lx <= b.x + Math.min(b.w, 220))) return e;
      continue;
    }
    if (e.type === "ellipse") {
      const rx = b.w / 2 + tol, ry = b.h / 2 + tol;
      if (((lx - cx) / rx) ** 2 + ((ly - cy) / ry) ** 2 > 1) continue;
    } else if (e.type === "diamond") {
      if (Math.abs(lx - cx) / (b.w / 2 + tol) + Math.abs(ly - cy) / (b.h / 2 + tol) > 1) continue;
    }
    // Hình rỗng ruột: chỉ chọn được khi bấm vào viền hoặc vào chữ
    const hollow = !MEDIA_TYPES.has(e.type) && e.type !== "text" && Color.isNone(s.fill) && !e.text;
    if (hollow && edge > tol + (s.strokeWidth || 2) / 2) continue;
    return e;
  }
  return null;
}

window.__DIAGRAM_ENGINE__ = {
  SVGNS, GRID, el, uid, clamp, snap, rad, round, rotatePoint, Color, FONT_FAMILIES, fontCss, TextMeasure, wrapText,
  DEFAULT_STYLES, SHAPES, SHAPE_GROUPS, POINT_TYPES, MEDIA_TYPES, isPointType,
  elementBox, elementCenter, elementCorners, worldBBox, boundsOf, anchorPoint, nearestSide, sideDirection,
  updateConnectorPoints, routePoints, DiagramDoc, History, Render, hitTest, distToPolyline, fitText, textBoxOf, lineHeightOf,
};

/* ============ khung nhìn canvas (pan / zoom / lưới) ============ */

class CanvasView {
  /**
   * opts: { readOnly, gridVisible, snapEnabled, onZoom(z), onViewChange() }
   * Cấu trúc DOM: host > [lớp media HTML] + svg > scene > (content, overlay)
   */
  constructor(host, svg, doc, opts = {}) {
    this.host = host;
    this.svg = svg;
    this.doc = doc;
    this.opts = opts;
    this.readOnly = !!opts.readOnly;
    this.zoom = doc.viewport.zoom || 1;
    this.panX = doc.viewport.x || 0;
    this.panY = doc.viewport.y || 0;
    this.gridVisible = opts.gridVisible !== false;
    this.snapEnabled = opts.snapEnabled !== false;
    this.pinching = false;
    this.pointers = new Map();
    this.nodeCache = new Map();

    const defs = el("defs");
    defs.innerHTML = '<filter id="dg-shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.22"/></filter>';
    svg.appendChild(defs);
    this.scene = el("g", { id: "scene" });
    this.content = el("g");
    this.overlay = el("g");
    this.scene.append(this.content, this.overlay);
    svg.appendChild(this.scene);

    const M = window.__DIAGRAM_MEDIA__;
    this.media = M ? new M.MediaLayer(host, svg, { readOnly: this.readOnly }) : null;

    host.classList.add("canvas-host");
    this.bindGestures();
    this.applyTransform();
  }

  /* ---- toạ độ ---- */
  screenToWorld(px, py) {
    const r = this.host.getBoundingClientRect();
    return { x: (px - r.left - this.panX) / this.zoom, y: (py - r.top - this.panY) / this.zoom };
  }
  worldToScreen(x, y) {
    const r = this.host.getBoundingClientRect();
    return { x: x * this.zoom + this.panX + r.left, y: y * this.zoom + this.panY + r.top };
  }

  /* ---- biến đổi ---- */
  applyTransform() {
    this.scene.setAttribute("transform", `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
    this.media?.setTransform(this.panX, this.panY, this.zoom);
    // lưới chấm bằng CSS: nhẹ hơn nhiều so với pattern SVG, không bị lệch khi phóng to
    let step = GRID * this.zoom;
    while (step < 14) step *= 5;
    this.host.style.setProperty("--grid-size", step + "px");
    this.host.style.setProperty("--grid-x", this.panX - step / 2 + "px");
    this.host.style.setProperty("--grid-y", this.panY - step / 2 + "px");
    this.host.classList.toggle("grid-on", this.gridVisible);
    this.doc.viewport = { x: this.panX, y: this.panY, zoom: this.zoom };
    this.opts.onZoom?.(this.zoom);
    this.opts.onViewChange?.();
  }
  setGrid(v) { this.gridVisible = !!v; this.applyTransform(); }
  toggleGrid() { this.setGrid(!this.gridVisible); return this.gridVisible; }
  toggleSnap() { this.snapEnabled = !this.snapEnabled; return this.snapEnabled; }

  zoomAt(factor, px, py) {
    const r = this.host.getBoundingClientRect();
    const cx = px - r.left, cy = py - r.top;
    const old = this.zoom;
    this.zoom = clamp(old * factor, 0.05, 20);
    if (this.zoom === old) return;
    this.panX = cx - ((cx - this.panX) / old) * this.zoom;
    this.panY = cy - ((cy - this.panY) / old) * this.zoom;
    this.applyTransform();
  }
  center() {
    const r = this.host.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  zoomIn() { this.zoomAt(1.2, ...this.center()); }
  zoomOut() { this.zoomAt(1 / 1.2, ...this.center()); }
  resetZoom() { this.zoomAt(1 / this.zoom, ...this.center()); }

  fit(elements, pad = 80) {
    const list = elements && elements.length ? elements : this.doc.elements;
    const b = boundsOf(list);
    const r = this.host.getBoundingClientRect();
    if (!b || (b.w < 1 && b.h < 1) || r.width < 10) {
      this.panX = r.width / 2; this.panY = r.height / 2; this.zoom = 1;
      this.applyTransform();
      return;
    }
    const p = Math.min(pad, Math.min(r.width, r.height) / 6);
    this.zoom = clamp(Math.min((r.width - p * 2) / Math.max(b.w, 1), (r.height - p * 2) / Math.max(b.h, 1)), 0.05, 4);
    this.panX = r.width / 2 - (b.minX + b.w / 2) * this.zoom;
    this.panY = r.height / 2 - (b.minY + b.h / 2) * this.zoom;
    this.applyTransform();
  }
  /** Đưa một điểm world vào giữa màn hình (không đổi zoom). */
  centerOn(x, y) {
    const r = this.host.getBoundingClientRect();
    this.panX = r.width / 2 - x * this.zoom;
    this.panY = r.height / 2 - y * this.zoom;
    this.applyTransform();
  }

  /* ---- thao tác chuột/cảm ứng ---- */
  bindGestures() {
    const host = this.host;
    host.addEventListener("wheel", (e) => {
      if (this.media?.isInteracting && e.target.closest?.(".media-box.is-interactive")) return; // cuộn trong video/nhúng
      e.preventDefault();
      if (e.shiftKey && !e.ctrlKey) {
        this.panX -= e.deltaY || e.deltaX; this.applyTransform(); return;
      }
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const factor = Math.pow(1.0015, -e.deltaY * unit);
      this.zoomAt(factor, e.clientX, e.clientY);
    }, { passive: false });

    // Chụm hai ngón để zoom (cảm ứng)
    let pinch = null;
    host.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom, panX: this.panX, panY: this.panY, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        this.pinching = true;
        this.opts.onPinchStart?.();
        e.stopImmediatePropagation();
      }
    });
    host.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const r = host.getBoundingClientRect();
        const z = clamp(pinch.zoom * (d / pinch.d), 0.05, 20);
        // giữ điểm chụm cố định + theo dõi di chuyển trung điểm
        const wx = (pinch.mx - r.left - pinch.panX) / pinch.zoom, wy = (pinch.my - r.top - pinch.panY) / pinch.zoom;
        this.zoom = z;
        this.panX = mx - r.left - wx * z;
        this.panY = my - r.top - wy * z;
        this.applyTransform();
        e.stopImmediatePropagation();
      }
    });
    const end = (e) => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size < 2) { pinch = null; setTimeout(() => { if (this.pointers.size < 2) this.pinching = false; }, 60); }
    };
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);

    // Chạm đúp (cảm ứng) → sự kiện "dbltap"
    let lastTap = null, downAt = null;
    host.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; }, true);
    host.addEventListener("pointerup", (e) => {
      if (this.pinching || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) { lastTap = null; return; } // vừa kéo, không phải nhấp
      const t = Date.now();
      if (lastTap && t - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < (e.pointerType === "mouse" ? 6 : 28)) {
        host.dispatchEvent(new CustomEvent("dbltap", { detail: { clientX: e.clientX, clientY: e.clientY } }));
        lastTap = null;
      } else lastTap = { t, x: e.clientX, y: e.clientY };
    });

    // Chế độ chỉ xem: kéo bất kỳ đâu để di chuyển
    if (this.readOnly) {
      host.addEventListener("pointerdown", (e) => {
        if (this.pinching || (e.button !== 0 && e.pointerType === "mouse")) return;
        if (e.target.closest?.(".media-box.is-interactive")) return;
        this.startPan(e);
      });
      host.style.cursor = "grab";
    }
  }

  /** Nhận cả dblclick (chuột) và chạm đúp (cảm ứng), chống gọi trùng. */
  onDouble(fn) {
    let last = 0;
    const call = (cx, cy, ev) => {
      const t = Date.now();
      if (t - last < 500) return;
      last = t;
      fn(this.screenToWorld(cx, cy), ev);
    };
    this.host.addEventListener("dblclick", (ev) => call(ev.clientX, ev.clientY, ev));
    this.host.addEventListener("dbltap", (ev) => call(ev.detail.clientX, ev.detail.clientY, ev));
  }

  startPan(e) {
    const startX = e.clientX, startY = e.clientY;
    const startPanX = this.panX, startPanY = this.panY;
    const prev = this.host.style.cursor;
    this.host.style.cursor = "grabbing";
    const move = (ev) => {
      if (this.pinching) return;
      this.panX = startPanX + (ev.clientX - startX);
      this.panY = startPanY + (ev.clientY - startY);
      this.applyTransform();
    };
    const up = () => {
      this.host.style.cursor = this.readOnly ? "grab" : prev;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /* ---- vẽ nội dung (có cache để kéo thả mượt, không tạo lại ảnh nặng) ---- */
  renderContent(afterNode) {
    this.doc.refreshConnectors();
    const seen = new Set();
    const wanted = [];
    for (const e of this.doc.elements) {
      if (e.type === "group") continue;
      seen.add(e.id);
      const sig = this.signature(e);
      let c = this.nodeCache.get(e.id);
      if (c && c.sig === sig) {
        // giữ node cũ
      } else if (c && e.type === "image" && c.src === e.src) {
        Render.patchImage(c.node, e);
        c.sig = sig;
      } else {
        const node = Render.element(e);
        c = { node, sig, src: e.src };
        this.nodeCache.set(e.id, c);
      }
      afterNode?.(c.node, e);
      wanted.push(c.node);
    }
    for (const id of [...this.nodeCache.keys()]) if (!seen.has(id)) this.nodeCache.delete(id);
    // Đồng bộ DOM tại chỗ: chỉ chèn/di chuyển node khi thứ tự thật sự đổi.
    // (Gỡ rồi gắn lại node ở mỗi lần vẽ làm trình duyệt mất chuỗi nhấp đúp.)
    const parent = this.content;
    let cur = parent.firstChild;
    for (const n of wanted) {
      if (n === cur) cur = cur.nextSibling;
      else parent.insertBefore(n, cur);
    }
    while (cur) { const next = cur.nextSibling; parent.removeChild(cur); cur = next; }
    this.media?.sync(this.doc.elements);
  }
  signature(e) {
    // Bỏ src (có thể nặng vài MB) khỏi chữ ký; dùng độ dài + đuôi để phân biệt.
    const { src, ...rest } = e;
    return JSON.stringify(rest) + (src ? "|" + src.length + src.slice(-24) : "");
  }
  invalidate() { this.nodeCache.clear(); }
}

Object.assign(window.__DIAGRAM_ENGINE__, { CanvasView });
})();
