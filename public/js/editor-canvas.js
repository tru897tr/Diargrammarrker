/* Diagram engine: infinite SVG canvas, elements, tools, history.
 * Doc lieu: text element chi duoc set qua textContent — khong innerHTML user input.
 * Moi thao tac ve duoc push vao history (undo/redo).
 */
"use strict";

/* ============ helpers ============ */

const SVGNS = "http://www.w3.org/2000/svg";
const GRID = 8;

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
      rotation: e.rotation || 0,
      text: e.text || "",
      style: { ...(DEFAULT_STYLES[e.type] || {}), ...(e.style || {}) },
      startId: e.startId,
      endId: e.endId,
      startSide: e.startSide,
      endSide: e.endSide,
      children: e.children ? [...e.children] : undefined,
    };
  }

  serialize() {
    return {
      version: 1,
      viewport: { ...this.viewport },
      elements: this.elements.map((e) => {
        const out = { id: e.id, type: e.type, x: e.x, y: e.y };
        if (e.width) out.width = e.width;
        if (e.height) out.height = e.height;
        if (e.points) out.points = e.points.map((p) => [...p]);
        if (e.rotation) out.rotation = e.rotation;
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
      if (e.type === "line" || (e.type === "arrow" && !e.startId && e.points)) {
        for (const [px, py] of e.points || []) {
          minX = Math.min(minX, px); minY = Math.min(minY, py);
          maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
        }
        continue;
      }
      minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
      maxX = Math.max(maxX, e.x + (e.width || 0)); maxY = Math.max(maxY, e.y + (e.height || 0));
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  /** Dien tich bounding cho element (dung cho marquee hit-test). */
  hitRect(e) {
    if ((e.type === "line" || e.type === "arrow") && e.points && !e.startId) {
      const xs = e.points.map((p) => p[0]);
      const ys = e.points.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    return { x: e.x, y: e.y, w: e.width || 0, h: e.height || 0 };
  }

  add(element) { this.elements.push(element); return element; }
  remove(ids) {
    const set = new Set(ids);
    this.elements = this.elements.filter((e) => !set.has(e.id));
    // Connector lien quan cung bi xoa
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

/* ============ History (undo/redo) ============ */

class History {
  constructor(doc, onChange) {
    this.doc = doc;
    this.onChange = onChange;
    this.past = [];
    this.future = [];
  }
  snapshot(label) {
    this.past.push({ label, data: JSON.stringify(this.doc.serialize()) });
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.onChange();
  }
  undo() {
    if (this.past.length === 0) return false;
    const cur = JSON.stringify(this.doc.serialize());
    const prev = this.past.pop();
    this.future.push({ label: prev.label, data: cur });
    this.doc = this.apply(prev.data);
    this.onChange();
    return true;
  }
  redo() {
    if (this.future.length === 0) return false;
    const cur = JSON.stringify(this.doc.serialize());
    const next = this.future.pop();
    this.past.push({ label: next.label, data: cur });
    this.doc = this.apply(next.data);
    this.onChange();
    return true;
  }
  apply(data) {
    const parsed = JSON.parse(data);
    this.doc.elements = this.doc.migrateAll(parsed.elements);
    this.doc.viewport = parsed.viewport;
    return this.doc;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

// Them helper migrateAll vao DiagramDoc prototype
DiagramDoc.prototype.migrateAll = function (elements) {
  return elements.map((e) => this.migrate(e));
};

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

    this.scene = el("g", { id: "scene" });
    this.gridPattern = el("pattern", { id: "dgrid", width: GRID, height: GRID, patternUnits: "userSpaceOnUse" });
    this.buildGrid();

    this.svg.appendChild(this.gridPattern);
    this.content = el("g");
    this.scene.appendChild(this.content);
    this.overlay = el("g"); // selection handles
    this.scene.appendChild(this.overlay);
    this.svg.appendChild(this.scene);
    this.marquee = null;

    this.bindPointer();
    this.applyTransform();
  }

  buildGrid() {
    const defs = el("defs");
    this.gridPattern.innerHTML = `<path d="M${GRID} 0H0V${GRID}" fill="none" stroke="currentColor" stroke-opacity="0.10" stroke-width="1"/>`;
    defs.appendChild(this.gridPattern);
    this.svg.appendChild(defs);
    this.gridRect = el("rect", { width: "100%", height: "100%", fill: "url(#dgrid)" });
    this.gridRect.style.color = "var(--border-strong)";
    this.gridRect.style.display = this.gridVisible ? "" : "none";
    this.svg.insertBefore(this.gridRect, this.scene);
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

  /** Pan bang chuot giua hoac space+drag hoac hand tool. */
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
  /** Ve 1 element vao svg group. TAO MOI moi lan — don gian, an toan. */
  element(e) {
    const g = el("g", { "data-id": e.id, class: "element-node" });
    const s = e.style || {};
    const opacity = s.opacity != null ? s.opacity : 1;
    g.setAttribute("opacity", String(opacity));
    g.setAttribute("transform", e.rotation ? `rotate(${e.rotation} ${e.x + (e.width || 0) / 2} ${e.y + (e.height || 0) / 2})` : "");

    switch (e.type) {
      case "rectangle":
      case "rounded-rectangle":
      case "note":
      case "frame": {
        const r = Math.min(s.radius || 0, (e.width || 0) / 2, (e.height || 0) / 2);
        g.appendChild(el("rect", {
          x: e.x, y: e.y, width: e.width || 0, height: e.height || 0, rx: r,
          fill: s.fill || "none", stroke: s.stroke || "none", "stroke-width": s.strokeWidth ?? 1.5,
        }));
        if (s.strokeDasharray) g.lastChild.setAttribute("stroke-dasharray", s.strokeDasharray);
        break;
      }
      case "ellipse": {
        g.appendChild(el("ellipse", {
          cx: e.x + (e.width || 0) / 2, cy: e.y + (e.height || 0) / 2,
          rx: (e.width || 0) / 2, ry: (e.height || 0) / 2,
          fill: s.fill || "none", stroke: s.stroke || "none", "stroke-width": s.strokeWidth ?? 1.5,
        }));
        break;
      }
      case "diamond": {
        const w = e.width || 0, h = e.height || 0;
        const pts = `${e.x + w / 2},${e.y} ${e.x + w},${e.y + h / 2} ${e.x + w / 2},${e.y + h} ${e.x},${e.y + h / 2}`;
        g.appendChild(el("polygon", { points: pts, fill: s.fill || "none", stroke: s.stroke || "none", "stroke-width": s.strokeWidth ?? 1.5 }));
        break;
      }
      case "line":
      case "arrow": {
        if (e.points && e.points.length >= 2) {
          const d = "M" + e.points.map((p) => `${p[0]} ${p[1]}`).join(" L");
          g.appendChild(el("path", { d, fill: "none", stroke: s.stroke || "#475569", "stroke-width": s.strokeWidth ?? 2, "stroke-linecap": "round" }));
          if (s.strokeDasharray) g.lastChild.setAttribute("stroke-dasharray", s.strokeDasharray);
          this.arrows(g, e.points, s);
        }
        break;
      }
      case "connector": {
        const pts = e.points || [];
        if (pts.length >= 2) {
          const d = "M" + pts.map((p) => `${p[0]} ${p[1]}`).join(" L");
          g.appendChild(el("path", { class: "connector-hit", d }));
          g.appendChild(el("path", { d, fill: "none", stroke: s.stroke || "#4f46e5", "stroke-width": s.strokeWidth ?? 2, "stroke-linecap": "round" }));
          this.arrows(g, pts, s);
        }
        break;
      }
      case "text": {
        const t = el("text", {
          x: e.x, y: e.y + (s.fontSize || 16) * 0.8,
          "font-size": s.fontSize || 16,
          fill: s.textColor || "#1f2430",
          "font-family": "Segoe UI, system-ui, sans-serif",
          "font-weight": s.fontWeight === "bold" ? "700" : "400",
          "font-style": s.fontStyle === "italic" ? "italic" : "normal",
          "text-decoration": s.textDecoration === "underline" ? "underline" : "none",
        });
        t.textContent = e.text || ""; // XSS-SAFE: textContent
        g.appendChild(t);
        break;
      }
    }

    // Text label cho shape (ngoai tru text thuần)
    if (e.text && !["text", "line", "arrow", "connector"].includes(e.type)) {
      const fs = s.fontSize || 15;
      const family = s.fontFamily === "serif" ? "Georgia, serif" : s.fontFamily === "mono" ? "Consolas, monospace" : "Segoe UI, system-ui, sans-serif";
      const wrapW = (e.width || 100) - 16;
      const lines = wrapText(e.text, fs, wrapW);
      const anchor = s.textAlign === "left" ? "start" : s.textAlign === "right" ? "end" : "middle";
      const tx = e.x + (e.width || 0) / 2;
      let ty = e.y + (e.height || 0) / 2 - ((lines.length - 1) * fs * 1.25) / 2 + fs * 0.35;

      const t = el("text", {
        x: tx, y: ty,
        "text-anchor": anchor,
        "font-size": fs,
        fill: s.textColor || "#1f2430",
        "font-family": family,
        "font-weight": s.fontWeight === "bold" ? "700" : "400",
        "font-style": s.fontStyle === "italic" ? "italic" : "normal",
      });
      for (const line of lines) {
        const ts = el("tspan", { x: tx, dy: ty === +ts_prev(t) ? 0 : fs * 1.25 });
        ts.textContent = line;
        t.appendChild(ts);
      }
      g.appendChild(t);
    }
    return g;
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

function ts_prev(_t) { return 0; }

/** Xuong dong theo chieu rong (uoc luong 0.55em/ky tu). */
function wrapText(text, fontSize, maxWidth) {
  if (!text) return [];
  if (maxWidth <= 0) return text.split("\n");
  const maxChars = Math.max(4, Math.floor(maxWidth / (fontSize * 0.55)));
  const out = [];
  for (const para of text.split("\n")) {
    if (para.length <= maxChars) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > maxChars && line) {
        out.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Tinh toan diem neo connector tren shape theo side. */
function anchorPoint(shape, side) {
  const w = shape.width || 0, h = shape.height || 0;
  switch (side) {
    case "top": return [shape.x + w / 2, shape.y];
    case "bottom": return [shape.x + w / 2, shape.y + h];
    case "left": return [shape.x, shape.y + h / 2];
    case "right": return [shape.x + w, shape.y + h / 2];
    default: return [shape.x + w / 2, shape.y + h / 2];
  }
}

/** Cap nhat points cua connector gan shape (di chuyen shape → connector follow). */
function updateConnectorPoints(doc, conn) {
  const start = conn.startId ? doc.byId(conn.startId) : null;
  const end = conn.endId ? doc.byId(conn.endId) : null;
  const pts = conn.points || [];
  const p0 = start ? anchorPoint(start, conn.startSide) : pts[0];
  const p1 = end ? anchorPoint(end, conn.endSide) : pts[pts.length - 1];
  if (!p0 || !p1) return;
  // Giu diem trung gian neu co; mac dinh elbow
  if (pts.length <= 2) {
    conn.points = [p0, p1];
  } else {
    const mid = pts.slice(1, -1);
    conn.points = [p0, ...mid, p1];
  }
  // Tu dong side khi gan shape — chon canh gan nhat
  if (start) autoSide(start, conn, "start");
  if (end) autoSide(end, conn, "end");
}

function autoSide(shape, conn, which) {
  const pts = conn.points;
  const other = which === "start" ? pts[pts.length - 1] : pts[0];
  const cx = shape.x + (shape.width || 0) / 2;
  const cy = shape.y + (shape.height || 0) / 2;
  const dx = other[0] - cx;
  const dy = other[1] - cy;
  const side = Math.abs(dx) * (shape.height || 1) > Math.abs(dy) * (shape.width || 1)
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "bottom" : "top");
  if (which === "start") conn.startSide = side; else conn.endSide = side;
  // Tinh lai diem neo voi side moi
  const pt = anchorPoint(shape, side);
  if (which === "start") conn.points[0] = pt; else conn.points[conn.points.length - 1] = pt;
}

window.__DIAGRAM_ENGINE__ = { DiagramDoc, History, CanvasView, Render, wrapText, anchorPoint, updateConnectorPoints, el, uid, snap, GRID, DEFAULT_STYLES };
