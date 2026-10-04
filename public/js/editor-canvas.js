/* Diagram engine: infinite SVG canvas, elements, text layout, fonts, tools, history.
 * Dữ liệu chữ chỉ được đưa vào DOM qua textContent — không bao giờ innerHTML với dữ liệu người dùng.
 * Mọi thao tác vẽ được snapshot vào History (undo/redo).
 */
"use strict";

/* ============ helpers ============ */

const SVGNS = "http://www.w3.org/2000/svg";
const GRID = 8;
const DEG = Math.PI / 180;

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
/** Chuẩn hóa góc về [0, 360). */
function normAngle(a) { const r = (+a || 0) % 360; return r < 0 ? r + 360 : r; }
function round2(v) { return Math.round(v * 100) / 100; }
/** Xoay điểm (px,py) quanh (cx,cy) một góc `deg` độ (chiều kim đồng hồ trên màn hình, như SVG rotate()). */
function rotPoint(px, py, cx, cy, deg) {
  if (!deg) return [px, py];
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  const dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
const LINE_TYPES = new Set(["line", "arrow", "connector"]);
const TEXT_TYPES = new Set(["rectangle", "rounded-rectangle", "ellipse", "diamond", "note", "frame", "text"]);
function isLineType(type) { return LINE_TYPES.has(type); }

const DEFAULT_STYLES = {
  "rectangle":      { fill: "#eef2ff", stroke: "#4f46e5", strokeWidth: 2, radius: 0, fontSize: 15, textAlign: "center", textColor: "#1f2430" },
  "rounded-rectangle": { fill: "#e0f2fe", stroke: "#0284c7", strokeWidth: 2, radius: 16, fontSize: 15, textAlign: "center", textColor: "#0c4a6e" },
  "ellipse":        { fill: "#f0fdf4", stroke: "#059669", strokeWidth: 2, fontSize: 15, textAlign: "center", textColor: "#064e3b" },
  "diamond":        { fill: "#fdf4ff", stroke: "#a21caf", strokeWidth: 2, fontSize: 14, textAlign: "center", textColor: "#701a75" },
  "text":           { fill: "none", stroke: "none", fontSize: 18, textColor: "#1f2430", textAlign: "left" },
  "note":           { fill: "#fde68a", stroke: "#d97706", strokeWidth: 1.5, radius: 4, fontSize: 14, textAlign: "left", textColor: "#78350f" },
  "frame":          { fill: "none", stroke: "#94a3b8", strokeWidth: 2, radius: 12, fontSize: 13, textAlign: "left", textColor: "#64748b" },
  "line":           { stroke: "#475569", strokeWidth: 2, arrowStart: "none", arrowEnd: "none" },
  "arrow":          { stroke: "#475569", strokeWidth: 2, arrowStart: "none", arrowEnd: "arrow" },
  "connector":      { stroke: "#4f46e5", strokeWidth: 2, arrowStart: "none", arrowEnd: "arrow" },
};

/* ============ Hình học (có xoay) ============ */

const Geometry = {
  center(e) { return [e.x + (e.width || 0) / 2, e.y + (e.height || 0) / 2]; },

  /** 4 góc của khung (đã xoay) theo thứ tự: trên-trái, trên-phải, dưới-phải, dưới-trái. */
  corners(e) {
    const w = e.width || 0, h = e.height || 0;
    const pts = [[e.x, e.y], [e.x + w, e.y], [e.x + w, e.y + h], [e.x, e.y + h]];
    if (!e.rotation) return pts;
    const [cx, cy] = this.center(e);
    return pts.map(([x, y]) => rotPoint(x, y, cx, cy, e.rotation));
  },

  /** Điểm thế giới → hệ tọa độ chưa xoay của phần tử. */
  toLocal(e, wx, wy) {
    if (!e.rotation) return [wx, wy];
    const [cx, cy] = this.center(e);
    return rotPoint(wx, wy, cx, cy, -e.rotation);
  },
  /** Điểm trong hệ chưa xoay của phần tử → thế giới. */
  toWorld(e, lx, ly) {
    if (!e.rotation) return [lx, ly];
    const [cx, cy] = this.center(e);
    return rotPoint(lx, ly, cx, cy, e.rotation);
  },

  /** Hình chữ nhật bao (không xoay) của phần tử — tính cả góc xoay và điểm của đường. */
  aabb(e) {
    const pts = e.points && e.points.length ? e.points : this.corners(e);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of pts) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY };
  },
};

/* ============ Phông chữ ============ */

/** Phông có sẵn trên hầu hết máy: [tên, font-family CSS]. */
const SYSTEM_FONTS = [
  ["Segoe UI", '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'],
  ["Arial", 'Arial, "Helvetica Neue", Helvetica, sans-serif'],
  ["Helvetica", 'Helvetica, "Helvetica Neue", Arial, sans-serif'],
  ["Verdana", "Verdana, Geneva, sans-serif"],
  ["Tahoma", "Tahoma, Geneva, Verdana, sans-serif"],
  ["Trebuchet MS", '"Trebuchet MS", "Lucida Grande", sans-serif'],
  ["Calibri", 'Calibri, Carlito, "Segoe UI", sans-serif'],
  ["Times New Roman", '"Times New Roman", Times, "Liberation Serif", serif'],
  ["Georgia", 'Georgia, "Times New Roman", serif'],
  ["Cambria", 'Cambria, "Times New Roman", serif'],
  ["Palatino Linotype", '"Palatino Linotype", Palatino, "Book Antiqua", serif'],
  ["Consolas", 'Consolas, "Courier New", monospace'],
  ["Courier New", '"Courier New", Courier, monospace'],
  ["Lucida Console", '"Lucida Console", Monaco, monospace'],
  ["Impact", 'Impact, "Arial Black", sans-serif'],
  ["Comic Sans MS", '"Comic Sans MS", "Comic Neue", cursive'],
];

/** Google Fonts có hỗ trợ tiếng Việt: [tên, họ chung, các độ đậm cần tải (null = chỉ 1 độ đậm)]. */
const GOOGLE_FONTS = [
  ["Roboto", "sans-serif", "400;700"],
  ["Open Sans", "sans-serif", "400;700"],
  ["Noto Sans", "sans-serif", "400;700"],
  ["Inter", "sans-serif", "400;700"],
  ["Montserrat", "sans-serif", "400;700"],
  ["Raleway", "sans-serif", "400;700"],
  ["Be Vietnam Pro", "sans-serif", "400;700"],
  ["Nunito", "sans-serif", "400;700"],
  ["Quicksand", "sans-serif", "400;700"],
  ["Lexend", "sans-serif", "400;700"],
  ["Source Sans 3", "sans-serif", "400;700"],
  ["Barlow", "sans-serif", "400;700"],
  ["Josefin Sans", "sans-serif", "400;700"],
  ["Space Grotesk", "sans-serif", "400;700"],
  ["Comfortaa", "sans-serif", "400;700"],
  ["Baloo 2", "sans-serif", "400;700"],
  ["Oswald", "sans-serif", "400;700"],
  ["Noto Serif", "serif", "400;700"],
  ["Merriweather", "serif", "400;700"],
  ["Lora", "serif", "400;700"],
  ["Playfair Display", "serif", "400;700"],
  ["Roboto Mono", "monospace", "400;700"],
  ["JetBrains Mono", "monospace", "400;700"],
  ["Dancing Script", "cursive", "400;700"],
  ["Pacifico", "cursive", null],
  ["Lobster", "cursive", null],
  ["Patrick Hand", "cursive", null],
  ["Sriracha", "cursive", null],
  ["Bangers", "cursive", null],
];

const DEFAULT_FONT = "Segoe UI";
const LEGACY_FONTS = { sans: "Segoe UI", serif: "Georgia", mono: "Consolas" }; // giá trị cũ của bản trước
const DEFAULT_STACK = SYSTEM_FONTS[0][1];

/** Chỉ giữ ký tự an toàn trong tên phông (chữ, số, khoảng trắng, _ . -). */
function cleanFontName(name) {
  return String(name ?? "").replace(/[^\p{L}\p{N} _.\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

const FontCatalog = (() => {
  const index = new Map();
  for (const [name, stack] of SYSTEM_FONTS) index.set(name, { name, stack, google: false });
  for (const [name, generic, weights] of GOOGLE_FONTS) {
    index.set(name, { name, stack: `"${name}", system-ui, ${generic}`, google: true, weights, generic });
  }

  const groups = [
    { id: "system", label: "Có sẵn trên máy", fonts: SYSTEM_FONTS.map(([n]) => index.get(n)) },
    { id: "google", label: "Google Fonts (cần Internet, tải khi dùng)", fonts: GOOGLE_FONTS.map(([n]) => index.get(n)) },
  ];

  const requested = new Set();
  const listeners = new Set();
  let timer = null;

  function find(name) { return index.get(LEGACY_FONTS[name] || name) || null; }

  /** Giá trị CSS font-family cho một tên phông (kể cả phông tự gõ). */
  function stack(name) {
    const f = find(name);
    if (f) return f.stack;
    const clean = cleanFontName(name);
    return clean ? `"${clean}", ${DEFAULT_STACK}` : DEFAULT_STACK;
  }

  function notify() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      Layout.clearCache();
      for (const cb of listeners) { try { cb(); } catch (err) { console.error(err); } }
    }, 40);
  }

  /** Tải Google Font khi cần (chỉ một lần cho mỗi phông). */
  function ensure(name) {
    const f = find(name);
    if (!f || !f.google || requested.has(f.name)) return;
    requested.add(f.name);
    const family = encodeURIComponent(f.name).replace(/%20/g, "+");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${family}${f.weights ? ":wght@" + f.weights : ""}&display=swap`;
    link.addEventListener("load", () => {
      const loads = [`400 16px "${f.name}"`, `700 16px "${f.name}"`, `italic 400 16px "${f.name}"`]
        .map((spec) => (document.fonts ? document.fonts.load(spec, "Aa Ăâ Êô Ơư Đđ").catch(() => null) : null));
      Promise.all(loads).then(notify, notify);
    });
    link.addEventListener("error", () => { /* offline / bị chặn: dùng phông dự phòng */ });
    document.head.appendChild(link);
  }

  /** Nạp tất cả Google Fonts (dùng khi muốn xem trước toàn bộ danh sách). */
  function ensureAll() { for (const [n] of GOOGLE_FONTS) ensure(n); }

  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  if (typeof document !== "undefined" && document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener("loadingdone", notify);
  }

  return { groups, find, stack, ensure, ensureAll, onChange, clean: cleanFontName, DEFAULT_FONT };
})();

/* ============ Bố cục chữ (đo bằng canvas, wrap thật, auto-fit) ============ */

const FONT_SIZE_PRESETS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
const MIN_FONT = 4;
const MAX_FONT = 1000;

/** Cỡ chữ kế tiếp theo kiểu PowerPoint (nút Tăng/Giảm cỡ chữ). dir = +1 | -1. */
function stepFontSize(cur, dir) {
  const c = +cur || 16;
  const P = FONT_SIZE_PRESETS, top = P[P.length - 1];
  if (dir > 0) {
    if (c >= top) return Math.min(MAX_FONT, Math.floor(c / 10) * 10 + 10);
    return P.find((p) => p > c + 1e-6);
  }
  if (c > top) return Math.max(top, Math.ceil(c / 10) * 10 - 10);
  for (let i = P.length - 1; i >= 0; i--) if (P[i] < c - 1e-6) return P[i];
  return Math.max(MIN_FONT, c - 1);
}

const Layout = (() => {
  const PAD_SHAPE = { x: 8, y: 6 };
  const PAD_TEXT = { x: 4, y: 2 };
  const MIN_W = 16;
  const MIN_H = 16;
  const cache = new Map();
  let ctx = null;

  function clearCache() { cache.clear(); }

  function measure(str, font, ls) {
    const key = font + "|" + ls + "|" + str;
    let w = cache.get(key);
    if (w === undefined) {
      if (!ctx) ctx = document.createElement("canvas").getContext("2d");
      ctx.font = font;
      w = ctx.measureText(str).width + (ls ? ls * [...str].length : 0);
      if (cache.size > 30000) cache.clear();
      cache.set(key, w);
    }
    return w;
  }

  function isQuarter(deg) {
    const r = normAngle(deg);
    return Math.abs(r - 90) < 0.01 || Math.abs(r - 270) < 0.01;
  }

  function applyCase(text, mode) {
    if (mode === "upper") return text.toUpperCase();
    if (mode === "lower") return text.toLowerCase();
    if (mode === "capitalize") return text.replace(/(^|\s)(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
    return text;
  }

  /** Gom mọi thuộc tính chữ của một phần tử thành một object tính toán được. */
  function textStyle(e) {
    const s = e.style || {};
    const isText = e.type === "text";
    const deco = String(s.textDecoration || "none");
    const decoParts = [];
    if (deco.includes("underline")) decoParts.push("underline");
    if (deco.includes("line-through")) decoParts.push("line-through");
    const famName = s.fontFamily || DEFAULT_FONT;
    return {
      famName,
      stack: FontCatalog.stack(famName),
      size: clamp(+s.fontSize || (isText ? 16 : 15), MIN_FONT, MAX_FONT),
      weight: s.fontWeight === "bold" ? 700 : 400,
      italic: s.fontStyle === "italic",
      deco: decoParts.join(" "),
      align: s.textAlign === "left" || s.textAlign === "right" ? s.textAlign : (s.textAlign === "center" ? "center" : (isText ? "left" : "center")),
      valign: s.verticalAlign === "top" || s.verticalAlign === "bottom" ? s.verticalAlign : "middle",
      lh: clamp(+s.lineHeight || 1.25, 0.8, 4),
      ls: clamp(+s.letterSpacing || 0, -10, 100),
      transform: s.textTransform || "none",
      color: s.textColor || "#1f2430",
      autoFit: s.autoFit === "shrink" || s.autoFit === "resize" || s.autoFit === "none" ? s.autoFit : (isText ? "resize" : "none"),
      wrap: isText ? s.wrap === true : true,
      rot: isText ? 0 : (+s.textRotation || 0),
    };
  }

  function fontCss(ts, fs) {
    return `${ts.italic ? "italic " : ""}${ts.weight} ${fs}px ${ts.stack}`;
  }

  /** Vùng chứa chữ (đổi chỗ rộng/cao khi chữ xoay 90°/270°). */
  function labelBox(e, ts) {
    const w = e.width || 0, h = e.height || 0;
    if (isQuarter(ts.rot)) {
      const [cx, cy] = Geometry.center(e);
      return { x: cx - h / 2, y: cy - w / 2, w: h, h: w, quarter: true };
    }
    return { x: e.x, y: e.y, w, h, quarter: false };
  }

  /** Xuống dòng theo bề rộng thật; từ quá dài được cắt theo ký tự. */
  function wrapLines(text, maxW, m) {
    const out = [];
    for (const para of text.split("\n")) {
      if (maxW === Infinity || para === "" || m(para) <= maxW) { out.push(para); continue; }
      let line = "";
      for (const word of para.split(" ")) {
        const trial = line === "" ? word : line + " " + word;
        if (m(trial) <= maxW) { line = trial; continue; }
        if (line !== "") { out.push(line); line = ""; }
        if (m(word) <= maxW) { line = word; continue; }
        let chunk = "";
        for (const ch of [...word]) {
          if (chunk !== "" && m(chunk + ch) > maxW) { out.push(chunk); chunk = ch; } else chunk += ch;
        }
        line = chunk;
      }
      out.push(line);
    }
    return out;
  }

  /** Tính bố cục chữ cho phần tử. opts.noWrap: không xuống dòng (đo bề rộng tự nhiên). */
  function compute(e, opts = {}) {
    const ts = textStyle(e);
    const pad = e.type === "text" ? PAD_TEXT : PAD_SHAPE;
    const text = applyCase(e.text || "", ts.transform);
    const box = labelBox(e, ts);
    const availW = Math.max(4, box.w - pad.x * 2);
    const availH = Math.max(4, box.h - pad.y * 2);
    const wrapW = ts.wrap && !opts.noWrap ? availW : Infinity;

    const build = (fs) => {
      const font = fontCss(ts, fs);
      const m = (str) => measure(str, font, ts.ls);
      const lines = wrapLines(text, wrapW, m);
      let maxW = 0;
      const widths = lines.map((l) => { const w = m(l); if (w > maxW) maxW = w; return w; });
      const lh = ts.lh * fs;
      return { fs, lines, widths, maxW, lh, blockH: lines.length * lh };
    };

    let lay = build(ts.size);
    if (ts.autoFit === "shrink" && text && !opts.noWrap) {
      const fits = (L) => L.blockH <= availH + 0.5 && L.maxW <= availW + 0.5;
      if (!fits(lay)) {
        let lo = MIN_FONT, hi = ts.size, best = null;
        for (let i = 0; i < 12 && hi - lo > 0.2; i++) {
          const mid = (lo + hi) / 2;
          const L = build(mid);
          if (fits(L)) { best = L; lo = mid; } else { hi = mid; }
        }
        lay = best || build(lo);
      }
    }
    return { ...lay, ts, pad, box, availW, availH };
  }

  /** Cập nhật width/height của phần tử theo chữ (Text tự giãn; hình dạng khi bật "Khung vừa với chữ"). */
  function fit(e) {
    if (!TEXT_TYPES.has(e.type)) return;
    const isText = e.type === "text";
    const ts = textStyle(e);
    const needInit = isText && !(e.width > 0 && e.height > 0);
    if (ts.autoFit !== "resize" && !needInit) return;
    if (!isText && isQuarter(ts.rot)) return;

    const natural = isText && (!ts.wrap || needInit);
    const c = compute(e, { noWrap: natural });
    const pad = isText ? PAD_TEXT : PAD_SHAPE;
    if (natural) e.width = Math.max(MIN_W, Math.ceil(c.maxW + pad.x * 2));
    e.height = Math.max(MIN_H, Math.ceil(c.blockH + pad.y * 2));
  }

  return { compute, fit, textStyle, fontCss, isQuarter, clearCache, measure, PAD_SHAPE, PAD_TEXT };
})();

/* ============ Diagram document ============ */

class DiagramDoc {
  constructor(data) {
    if (data) {
      this.version = 1;
      this.viewport = { ...data.viewport };
      this.elements = data.elements.map((e) => this.migrate(e));
    } else {
      this.version = 1;
      this.viewport = { x: 0, y: 0, zoom: 1 };
      this.elements = [];
    }
    this.refit();
  }

  migrate(e) {
    return {
      id: e.id || uid(),
      type: e.type,
      x: e.x || 0,
      y: e.y || 0,
      width: e.width ?? 0,
      height: e.height ?? 0,
      points: e.points ? e.points.map((p) => [...p]) : undefined,
      rotation: isLineType(e.type) ? 0 : normAngle(e.rotation || 0),
      text: e.text || "",
      style: { ...(DEFAULT_STYLES[e.type] || {}), ...(e.style || {}) },
      startId: e.startId,
      endId: e.endId,
      startSide: e.startSide,
      endSide: e.endSide,
      children: e.children ? [...e.children] : undefined,
    };
  }

  migrateAll(elements) { return elements.map((e) => this.migrate(e)); }

  /** Tính lại kích thước các phần tử theo chữ (gọi khi phông tải xong hoặc sau undo). */
  refit() { for (const e of this.elements) Layout.fit(e); }

  serialize() {
    return {
      version: 1,
      viewport: { ...this.viewport },
      elements: this.elements.map((e) => {
        const out = { id: e.id, type: e.type, x: e.x, y: e.y };
        if (e.width) out.width = e.width;
        if (e.height) out.height = e.height;
        if (e.points) out.points = e.points.map((p) => [...p]);
        if (e.rotation) out.rotation = round2(e.rotation);
        if (e.text) out.text = e.text;
        if (e.style) out.style = { ...e.style };
        if (e.startId) out.startId = e.startId;
        if (e.endId) out.endId = e.endId;
        if (e.startSide) out.startSide = e.startSide;
        if (e.endSide) out.endSide = e.endSide;
        if (e.children) out.children = [...e.children];
        return out;
      }),
    };
  }

  byId(id) { return this.elements.find((e) => e.id === id); }

  bounds(elements) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of elements) {
      const b = Geometry.aabb(e);
      if (!Number.isFinite(b.minX)) continue;
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  /** Hình chữ nhật bao (đã tính xoay) — dùng cho marquee hit-test. */
  hitRect(e) {
    const b = Geometry.aabb(e);
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  add(element) { this.elements.push(element); return element; }
  remove(ids) {
    const set = new Set(ids);
    this.elements = this.elements.filter((e) => !set.has(e.id));
    // Connector liên quan cũng bị xóa
    this.elements = this.elements.filter(
      (e) => !(e.startId && set.has(e.startId)) && !(e.endId && set.has(e.endId))
    );
  }
  zTop(id) {
    const i = this.elements.findIndex((e) => e.id === id);
    if (i >= 0) this.elements.push(this.elements.splice(i, 1)[0]);
  }
  zBottom(id) {
    const i = this.elements.findIndex((e) => e.id === id);
    if (i >= 0) this.elements.unshift(this.elements.splice(i, 1)[0]);
  }
}

/* ============ Biến đổi: xoay / dịch chuyển ============ */

const Transform = {
  /** Xoay một phần tử `delta` độ quanh `pivot` ([x,y]). Đường gắn shape thì bỏ qua (tự theo shape). */
  rotateBy(e, delta, pivot) {
    if (isLineType(e.type)) {
      if (e.startId || e.endId || !e.points) return;
      e.points = e.points.map(([x, y]) => rotPoint(x, y, pivot[0], pivot[1], delta));
      return;
    }
    const [cx, cy] = Geometry.center(e);
    const [ncx, ncy] = rotPoint(cx, cy, pivot[0], pivot[1], delta);
    e.x = ncx - (e.width || 0) / 2;
    e.y = ncy - (e.height || 0) / 2;
    e.rotation = round2(normAngle((e.rotation || 0) + delta));
  },

  /** Đặt góc xoay tuyệt đối cho phần tử (quanh tâm của chính nó). */
  setRotation(e, deg) {
    if (isLineType(e.type)) return;
    e.rotation = round2(normAngle(deg));
  },

  translate(e, dx, dy) {
    e.x += dx; e.y += dy;
    if (e.points) e.points = e.points.map(([x, y]) => [x + dx, y + dy]);
  },
};

/* ============ History (undo/redo) ============ */

class History {
  constructor(doc, onChange) {
    this.doc = doc;
    this.onChange = onChange;
    this.states = [this.capture()];
    this.index = 0;
    this.lastKey = null;
    this.lastTime = 0;
  }
  capture() { return JSON.stringify(this.doc.serialize().elements); }

  /**
   * Ghi lại trạng thái SAU một thao tác. Không có thay đổi → không ghi.
   * coalesceKey: các thao tác liên tiếp cùng khóa trong ~0,9 giây được gộp thành 1 bước undo
   * (vd kéo bảng chọn màu, gõ số trong ô cỡ chữ).
   */
  snapshot(_label, coalesceKey) {
    const data = this.capture();
    if (data === this.states[this.index]) return false;
    const t = Date.now();
    if (coalesceKey && coalesceKey === this.lastKey && t - this.lastTime < 900 && this.index > 0) {
      this.states[this.index] = data;
    } else {
      this.states.length = this.index + 1;
      this.states.push(data);
      if (this.states.length > 100) this.states.shift();
      this.index = this.states.length - 1;
    }
    this.lastKey = coalesceKey || null;
    this.lastTime = t;
    this.onChange();
    return true;
  }
  undo() {
    if (!this.canUndo) return false;
    this.index--;
    this.restore(this.states[this.index]);
    this.onChange();
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.index++;
    this.restore(this.states[this.index]);
    this.onChange();
    return true;
  }
  restore(data) {
    this.doc.elements = this.doc.migrateAll(JSON.parse(data)); // giữ nguyên viewport hiện tại
    this.doc.refit();
  }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.states.length - 1; }
}

/* ============ Canvas view (pan/zoom/render) ============ */

class CanvasView {
  constructor(host, svg, doc, opts = {}) {
    this.host = host;
    this.svg = svg;
    this.doc = doc;
    this.opts = opts;
    this.zoom = doc.viewport.zoom || 1;
    this.panX = doc.viewport.x || 0;
    this.panY = doc.viewport.y || 0;
    this.gridVisible = opts.gridVisible !== false;
    this.snapEnabled = opts.snapEnabled !== false;

    // Dựng DOM theo đúng thứ tự: defs → lưới → scene (lưới luôn nằm dưới scene).
    this.gridPattern = el("pattern", { id: "dgrid", width: GRID, height: GRID, patternUnits: "userSpaceOnUse" });
    this.gridPattern.appendChild(el("path", {
      d: `M${GRID} 0H0V${GRID}`, fill: "none", stroke: "currentColor", "stroke-opacity": "0.10", "stroke-width": "1",
    }));
    const defs = el("defs");
    defs.appendChild(this.gridPattern);
    this.svg.appendChild(defs);

    this.gridRect = el("rect", { width: "100%", height: "100%", fill: "url(#dgrid)" });
    this.gridRect.style.color = "var(--border-strong)";
    this.gridRect.style.display = this.gridVisible ? "" : "none";
    this.svg.appendChild(this.gridRect);

    this.scene = el("g", { id: "scene" });
    this.content = el("g");
    this.overlay = el("g"); // tay cầm chọn / xoay / đổi cỡ
    this.scene.appendChild(this.content);
    this.scene.appendChild(this.overlay);
    this.svg.appendChild(this.scene);
    this.marquee = null;

    this.bindPointer();
    this.applyTransform();
  }

  toggleGrid() {
    this.gridVisible = !this.gridVisible;
    this.gridRect.style.display = this.gridVisible ? "" : "none";
  }
  toggleSnap() {
    this.snapEnabled = !this.snapEnabled;
    return this.snapEnabled;
  }

  screenToWorld(px, py) {
    const rect = this.host.getBoundingClientRect();
    return { x: (px - rect.left - this.panX) / this.zoom, y: (py - rect.top - this.panY) / this.zoom };
  }
  worldToScreen(wx, wy) {
    return { x: wx * this.zoom + this.panX, y: wy * this.zoom + this.panY };
  }

  applyTransform() {
    this.scene.setAttribute("transform", `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
    this.gridPattern.setAttribute("patternTransform", `translate(${this.panX % GRID} ${this.panY % GRID}) scale(${this.zoom})`);
    if (this.opts.onZoom) this.opts.onZoom(this.zoom);
    this.doc.viewport = { x: this.panX, y: this.panY, zoom: this.zoom };
  }

  zoomAt(factor, px, py) {
    const rect = this.host.getBoundingClientRect();
    const cx = px - rect.left;
    const cy = py - rect.top;
    const old = this.zoom;
    this.zoom = clamp(old * factor, 0.05, 20);
    if (this.zoom === old) return;
    this.panX = cx - ((cx - this.panX) / old) * this.zoom;
    this.panY = cy - ((cy - this.panY) / old) * this.zoom;
    this.applyTransform();
  }

  zoomIn() { this.zoomAt(1.2, ...this.center()); }
  zoomOut() { this.zoomAt(1 / 1.2, ...this.center()); }
  resetZoom() { this.zoom = 1; this.applyTransform(); }
  center() {
    const r = this.host.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  fit(elements) {
    const b = this.doc.bounds(elements && elements.length ? elements : this.doc.elements);
    const r = this.host.getBoundingClientRect();
    if (!b || b.w === 0 || b.h === 0) {
      this.panX = r.width / 2;
      this.panY = r.height / 2;
      this.zoom = 1;
      this.applyTransform();
      return;
    }
    const pad = 80;
    this.zoom = clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h), 0.05, 4);
    this.panX = r.width / 2 - (b.minX + b.w / 2) * this.zoom;
    this.panY = r.height / 2 - (b.minY + b.h / 2) * this.zoom;
    this.applyTransform();
  }

  bindPointer() {
    this.host.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
        const factor = Math.pow(1.0015, -e.deltaY);
        this.zoomAt(factor, e.clientX, e.clientY);
      }
    }, { passive: false });
  }

  /** Pan bằng chuột giữa hoặc hand tool. */
  startPan(e) {
    const startX = e.clientX, startY = e.clientY;
    const startPanX = this.panX, startPanY = this.panY;
    this.host.style.cursor = "grabbing";
    const move = (ev) => {
      this.panX = startPanX + (ev.clientX - startX);
      this.panY = startPanY + (ev.clientY - startY);
      this.applyTransform();
    };
    const up = () => {
      this.host.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}

/* ============ Element renderer ============ */

const Render = {
  /** Vẽ 1 element thành <g>. Tạo mới mỗi lần — đơn giản, an toàn. opts.hideText: ẩn chữ (đang sửa). */
  element(e, opts = {}) {
    const g = el("g", { "data-id": e.id, class: "element-node" });
    const s = e.style || {};
    const opacity = s.opacity != null ? s.opacity : 1;
    g.setAttribute("opacity", String(opacity));
    if (e.rotation && !isLineType(e.type)) {
      const [cx, cy] = Geometry.center(e);
      g.setAttribute("transform", `rotate(${e.rotation} ${cx} ${cy})`);
    }

    const w = e.width || 0, h = e.height || 0;
    switch (e.type) {
      case "rectangle":
      case "rounded-rectangle":
      case "note":
      case "frame": {
        const r = Math.min(s.radius || 0, w / 2, h / 2);
        const rect = el("rect", {
          x: e.x, y: e.y, width: w, height: h, rx: r,
          fill: s.fill || "none", stroke: s.stroke || "none", "stroke-width": s.strokeWidth ?? 1.5,
        });
        if (s.strokeDasharray) rect.setAttribute("stroke-dasharray", s.strokeDasharray);
        g.appendChild(rect);
        break;
      }
      case "ellipse": {
        const node = el("ellipse", {
          cx: e.x + w / 2, cy: e.y + h / 2, rx: w / 2, ry: h / 2,
          fill: s.fill || "none", stroke: s.stroke || "none", "stroke-width": s.strokeWidth ?? 1.5,
        });
        if (s.strokeDasharray) node.setAttribute("stroke-dasharray", s.strokeDasharray);
        g.appendChild(node);
        break;
      }
      case "diamond": {
        const pts = `${e.x + w / 2},${e.y} ${e.x + w},${e.y + h / 2} ${e.x + w / 2},${e.y + h} ${e.x},${e.y + h / 2}`;
        const node = el("polygon", { points: pts, fill: s.fill || "none", stroke: s.stroke || "none", "stroke-width": s.strokeWidth ?? 1.5 });
        if (s.strokeDasharray) node.setAttribute("stroke-dasharray", s.strokeDasharray);
        g.appendChild(node);
        break;
      }
      case "text": {
        // Text box: chỉ vẽ nền/viền khi người dùng đặt màu.
        const hasFill = s.fill && s.fill !== "none";
        const hasStroke = s.stroke && s.stroke !== "none" && (s.strokeWidth ?? 1.5) > 0;
        if (hasFill || hasStroke) {
          const r = Math.min(s.radius || 0, w / 2, h / 2);
          const rect = el("rect", {
            x: e.x, y: e.y, width: w, height: h, rx: r,
            fill: hasFill ? s.fill : "none", stroke: hasStroke ? s.stroke : "none", "stroke-width": s.strokeWidth ?? 1.5,
          });
          if (s.strokeDasharray) rect.setAttribute("stroke-dasharray", s.strokeDasharray);
          g.appendChild(rect);
        }
        break;
      }
      case "line":
      case "arrow": {
        if (e.points && e.points.length >= 2) {
          const d = "M" + e.points.map((p) => `${p[0]} ${p[1]}`).join(" L");
          const path = el("path", { d, fill: "none", stroke: s.stroke || "#475569", "stroke-width": s.strokeWidth ?? 2, "stroke-linecap": "round" });
          if (s.strokeDasharray) path.setAttribute("stroke-dasharray", s.strokeDasharray);
          g.appendChild(path);
          this.arrows(g, e.points, s);
        }
        break;
      }
      case "connector": {
        const pts = e.points || [];
        if (pts.length >= 2) {
          const d = "M" + pts.map((p) => `${p[0]} ${p[1]}`).join(" L");
          g.appendChild(el("path", { class: "connector-hit", d }));
          const path = el("path", { d, fill: "none", stroke: s.stroke || "#4f46e5", "stroke-width": s.strokeWidth ?? 2, "stroke-linecap": "round" });
          if (s.strokeDasharray) path.setAttribute("stroke-dasharray", s.strokeDasharray);
          g.appendChild(path);
          this.arrows(g, pts, s);
        }
        break;
      }
    }

    if (TEXT_TYPES.has(e.type) && e.text && !opts.hideText) this.label(g, e);
    return g;
  },

  /** Vẽ chữ của phần tử (một <text>, mỗi dòng một <tspan> có toạ độ tuyệt đối). */
  label(g, e) {
    const c = Layout.compute(e);
    const { ts, box, pad } = c;
    FontCatalog.ensure(ts.famName);

    let top;
    if (ts.valign === "top") top = box.y + pad.y;
    else if (ts.valign === "bottom") top = box.y + box.h - pad.y - c.blockH;
    else top = box.y + (box.h - c.blockH) / 2;

    const anchor = ts.align === "left" ? "start" : ts.align === "right" ? "end" : "middle";
    const tx = ts.align === "left" ? box.x + pad.x : ts.align === "right" ? box.x + box.w - pad.x : box.x + box.w / 2;

    const t = el("text", {
      "text-anchor": anchor,
      "font-size": c.fs,
      fill: ts.color,
      "font-family": ts.stack,
      "font-weight": String(ts.weight),
      "font-style": ts.italic ? "italic" : "normal",
    });
    if (ts.deco) t.setAttribute("text-decoration", ts.deco);
    if (ts.ls) t.setAttribute("letter-spacing", String(ts.ls));
    t.style.whiteSpace = "pre";
    t.setAttribute("class", "element-label");

    c.lines.forEach((line, i) => {
      const tspan = el("tspan", { x: tx, y: top + i * c.lh + c.lh / 2 + c.fs * 0.35 });
      tspan.textContent = line; // XSS-SAFE: textContent
      t.appendChild(tspan);
    });

    if (ts.rot) {
      const [cx, cy] = Geometry.center(e);
      const wrap = el("g", { transform: `rotate(${ts.rot} ${cx} ${cy})` });
      wrap.appendChild(t);
      g.appendChild(wrap);
    } else {
      g.appendChild(t);
    }
  },

  arrows(g, points, style) {
    const arrow = (pFrom, pTo, which) => {
      const kind = which === "start" ? style.arrowStart : style.arrowEnd;
      if (!kind || kind === "none") return;
      const angle = Math.atan2(pTo[1] - pFrom[1], pTo[0] - pFrom[0]);
      const size = 8 + (style.strokeWidth || 2) * 1.2;
      const back = Math.PI / 6;
      const p1 = [pTo[0] - size * Math.cos(angle - back), pTo[1] - size * Math.sin(angle - back)];
      const p2 = [pTo[0] - size * Math.cos(angle + back), pTo[1] - size * Math.sin(angle + back)];
      if (kind === "triangle") {
        g.appendChild(el("polygon", {
          points: `${pTo[0]},${pTo[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`,
          fill: style.stroke || "#475569",
        }));
      } else {
        g.appendChild(el("path", {
          d: `M${p1[0]} ${p1[1]} L${pTo[0]} ${pTo[1]} L${p2[0]} ${p2[1]}`,
          fill: "none", stroke: style.stroke || "#475569",
          "stroke-width": style.strokeWidth ?? 2, "stroke-linecap": "round", "stroke-linejoin": "round",
        }));
      }
    };
    if (points.length >= 2) {
      arrow(points[1], points[0], "start");
      arrow(points[points.length - 2], points[points.length - 1], "end");
    }
  },
};

/* ============ Connector ============ */

/** Điểm neo connector trên shape theo cạnh (tính cả góc xoay của shape). */
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
  return shape.rotation ? Geometry.toWorld(shape, p[0], p[1]) : p;
}

/** Cạnh (theo hệ chưa xoay của shape) gần điểm `point` nhất. */
function nearestSide(shape, point) {
  const [lx, ly] = Geometry.toLocal(shape, point[0], point[1]);
  const cx = shape.x + (shape.width || 0) / 2;
  const cy = shape.y + (shape.height || 0) / 2;
  const dx = lx - cx, dy = ly - cy;
  return Math.abs(dx) * (shape.height || 1) > Math.abs(dy) * (shape.width || 1)
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "bottom" : "top");
}

/** Cập nhật points của connector gắn shape (di chuyển shape → connector đi theo). */
function updateConnectorPoints(doc, conn) {
  const start = conn.startId ? doc.byId(conn.startId) : null;
  const end = conn.endId ? doc.byId(conn.endId) : null;
  const pts = conn.points || [];
  const p0 = start ? anchorPoint(start, conn.startSide) : pts[0];
  const p1 = end ? anchorPoint(end, conn.endSide) : pts[pts.length - 1];
  if (!p0 || !p1) return;
  // Giữ điểm trung gian nếu có
  if (pts.length <= 2) {
    conn.points = [p0, p1];
  } else {
    const mid = pts.slice(1, -1);
    conn.points = [p0, ...mid, p1];
  }
  // Tự động chọn cạnh gần nhất khi gắn shape
  if (start) autoSide(start, conn, "start");
  if (end) autoSide(end, conn, "end");
}

function autoSide(shape, conn, which) {
  const pts = conn.points;
  const other = which === "start" ? pts[pts.length - 1] : pts[0];
  const side = nearestSide(shape, other);
  if (which === "start") conn.startSide = side; else conn.endSide = side;
  const pt = anchorPoint(shape, side);
  if (which === "start") conn.points[0] = pt; else conn.points[conn.points.length - 1] = pt;
}

window.__DIAGRAM_ENGINE__ = {
  DiagramDoc, History, CanvasView, Render, Layout, Geometry, Transform, FontCatalog,
  anchorPoint, nearestSide, updateConnectorPoints,
  el, uid, snap, clamp, normAngle, rotPoint, round2, isLineType, stepFontSize,
  GRID, DEFAULT_STYLES, FONT_SIZE_PRESETS, MIN_FONT, MAX_FONT, TEXT_TYPES,
};
