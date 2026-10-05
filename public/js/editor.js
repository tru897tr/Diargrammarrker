/* Trình soạn thảo sơ đồ: công cụ, chọn/di chuyển/đổi cỡ/xoay, chữ, chèn ảnh-video-nhúng,
 * ribbon kiểu PowerPoint, bảng thuộc tính, hoàn tác/làm lại, lưu, trình chiếu. */
(function () {
"use strict";

const { Api, Toast, UI, Theme, SideMenu, ICONS, user, BOOT } = window.__DIAGRAM__;
const E = window.__DIAGRAM_ENGINE__;
const {
  DiagramDoc, History, CanvasView, Color, SHAPES, SHAPE_GROUPS, DEFAULT_STYLES, GRID, MEDIA_TYPES,
  el, uid, snap, clamp, round, rad, rotatePoint, elementBox, elementCenter, elementCorners, worldBBox, boundsOf,
  hitTest, anchorPoint, nearestSide, isPointType, fitText, textBoxOf, lineHeightOf, TextMeasure, wrapText, routePoints,
} = E;
const M = window.__DIAGRAM_MEDIA__;
const CP = window.__DIAGRAM_COLORPICKER__;
const PR = window.__DIAGRAM_PRESENT__;

Theme.init();

/* ============ trạng thái ============ */

let diagramId = BOOT.mode === "edit" && BOOT.diagram ? BOOT.diagram.id : null;
const savedData = BOOT.mode === "edit" && BOOT.diagram ? BOOT.diagram.data : null;
const embedHosts = BOOT.embedHosts || [];

const prefs = (() => { try { return JSON.parse(localStorage.getItem("diagram-prefs")) || {}; } catch { return {}; } })();
function savePrefs(patch) {
  Object.assign(prefs, patch);
  try { localStorage.setItem("diagram-prefs", JSON.stringify(prefs)); } catch { /* bỏ qua */ }
}

const $ = (id) => document.getElementById(id);
const host = $("canvasHost");
const svg = $("svgRoot");
const root = $("editorRoot");

const doc = new DiagramDoc(savedData);
const history = new History(doc, (kind) => onHistoryChange(kind));
history.markSaved();
let ready = false;

const view = new CanvasView(host, svg, doc, {
  gridVisible: prefs.gridVisible !== false,
  snapEnabled: prefs.snapEnabled !== false,
  onZoom: (z) => { $("zoomLabel").textContent = Math.round(z * 100) + "%"; },
  onViewChange: () => { if (ready) scheduleOverlay(); },
  onPinchStart: () => cancelAction(),
});

let tool = "select";
let toolLocked = false;
let selection = new Set();           // id của "gốc" được chọn (phần tử đơn hoặc nhóm ngoài cùng)
let clipboard = null;
let nameDirty = false;
let action = null;
let hoverId = null;
let editing = null;                  // { el, ta }
let presenting = false;
let spaceDown = false;
let connectHot = null;               // { id, side } khi kéo đầu nối qua một hình
let panelSig = "";
const byId = (id) => doc.byId(id);

/* ============ tiện ích ============ */

const sn = (v, ev) => (view.snapEnabled && !(ev && ev.altKey) ? snap(v) : v);
function selRoots() { return [...selection].map(byId).filter(Boolean); }
function selLeaves() { return doc.leaves([...selection]).map(byId).filter(Boolean); }
function selAll() { return doc.withDescendants([...selection]).map(byId).filter(Boolean); }
function canvasCenterWorld() {
  const r = host.getBoundingClientRect();
  return view.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}
function typeLabel(t) {
  return ({
    "rectangle": "Hình chữ nhật", "rounded-rectangle": "Chữ nhật bo góc", "ellipse": "Ellipse", "diamond": "Hình thoi",
    "text": "Văn bản", "note": "Ghi chú", "frame": "Khung", "line": "Đường thẳng", "arrow": "Mũi tên", "connector": "Đường nối",
    "group": "Nhóm", "image": "Hình ảnh", "video": "Video", "embed": "Nội dung nhúng",
  })[t] || SHAPES[t]?.label || t;
}
function iconFor(t) {
  return ({ text: ICONS.text, note: ICONS.note, frame: ICONS.frame, line: ICONS.line, arrow: ICONS.arrow, connector: ICONS.connector, group: ICONS.group, image: ICONS.image, video: ICONS.video, embed: ICONS.embed, ellipse: ICONS.circle, diamond: ICONS.diamond, "rounded-rectangle": ICONS.roundRect })[t] || ICONS.rect;
}
function docColors() {
  const set = new Set();
  for (const e of doc.elements) {
    for (const k of ["fill", "stroke", "textColor"]) {
      const v = e.style?.[k];
      if (v && !Color.isNone(v)) { const n = Color.normalize(v); if (n && n !== "none") set.add(n); }
    }
  }
  return [...set];
}

/* ============ lịch sử, "chưa lưu", cập nhật giao diện ============ */

const saveStateEl = $("saveState");
const undoBtn = $("undoBtn"), redoBtn = $("redoBtn");

function isDirty() { return !history.isAtSaved || nameDirty; }
function updateSaveState() {
  const d = isDirty();
  saveStateEl.textContent = d ? "Thay đổi chưa lưu" : (diagramId ? "Đã lưu" : "");
  saveStateEl.classList.toggle("dirty", d);
}
function onHistoryChange(kind) {
  if (!ready) return;
  updateSaveState();
  updateHistoryButtons();
  if (kind === "restore") {
    view.invalidate();
    // bỏ khỏi vùng chọn những phần tử không còn tồn tại
    for (const id of [...selection]) if (!byId(id)) selection.delete(id);
    closeEditor(false);
    redraw(true);
  }
}
function updateHistoryButtons() {
  undoBtn.disabled = !history.canUndo;
  redoBtn.disabled = !history.canRedo;
}
function commit(label, key) { return history.commit(label, key); }
function doUndo() {
  if (presenting) return;
  closeEditor(true);
  if (action) { cancelAction(); return; }
  if (history.undo()) Toast.show("Đã hoàn tác", "info", 1200);
}
function doRedo() {
  if (presenting) return;
  closeEditor(true);
  if (history.redo()) Toast.show("Đã làm lại", "info", 1200);
}
/** Khôi phục tài liệu về trạng thái hiện tại của lịch sử (hủy thao tác kéo dở). */
function revertToHistory() {
  const keep = { ...doc.viewport };
  doc.replaceFrom(JSON.parse(history.states[history.index].data));
  doc.viewport = keep;
  view.invalidate();
  for (const id of [...selection]) if (!byId(id)) selection.delete(id);
}
window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

/* ============ vẽ lại ============ */

let rafOverlay = 0, rafFull = 0;
function scheduleOverlay() {
  if (rafOverlay) return;
  rafOverlay = requestAnimationFrame(() => { rafOverlay = 0; renderOverlay(); positionCtxBar(); });
}
/** Vẽ lại nội dung + lớp phủ (gộp nhiều lần gọi trong một khung hình). */
function redraw(forcePanel = false) {
  if (forcePanel) panelSig = "";
  if (rafFull) return;
  rafFull = requestAnimationFrame(() => { rafFull = 0; redrawNow(); });
}
function redrawNow() {
  if (rafFull) { cancelAnimationFrame(rafFull); rafFull = 0; }
  view.renderContent((node, e) => {
    node.classList.toggle("is-editing", !!editing && editing.el.id === e.id);
    node.style.cursor = "";
  });
  $("emptyHint").classList.toggle("hidden", doc.elements.length > 0 || presenting || tool !== "select");
  renderOverlay();
  positionCtxBar();
  syncPanel();
  refreshRibbon();
}

/* ============ lớp phủ chọn (khung, tay nắm, điểm nối) ============ */

function outlinePath(e) {
  const c = elementCorners(e);
  return `M${c[0][0]} ${c[0][1]}L${c[1][0]} ${c[1][1]}L${c[2][0]} ${c[2][1]}L${c[3][0]} ${c[3][1]}Z`;
}
function cursorForHandle(name, rot) {
  const base = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 }[name];
  const a = (((base + (rot || 0)) % 180) + 180) % 180;
  const idx = Math.round(a / 45) % 4;
  return ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"][idx];
}
const HANDLES = [["nw", 0, 0], ["n", .5, 0], ["ne", 1, 0], ["e", 1, .5], ["se", 1, 1], ["s", .5, 1], ["sw", 0, 1], ["w", 0, .5]];

function addHandle(parent, x, y, size, dataset, cursor, shape = "rect") {
  const hit = el(shape === "rect" ? "rect" : "circle", shape === "rect"
    ? { x: x - size, y: y - size, width: size * 2, height: size * 2, fill: "transparent" }
    : { cx: x, cy: y, r: size * 1.1, fill: "transparent" });
  const vis = el(shape === "rect" ? "rect" : "circle", shape === "rect"
    ? { x: x - size / 2, y: y - size / 2, width: size, height: size, rx: size * 0.18, class: "h-handle" }
    : { cx: x, cy: y, r: size / 2, class: "h-handle" });
  vis.style.pointerEvents = "none";
  for (const n of [hit]) { for (const [k, v] of Object.entries(dataset)) n.dataset[k] = v; n.style.cursor = cursor; }
  parent.append(hit, vis);
}

function renderOverlay() {
  const ov = view.overlay;
  ov.replaceChildren();
  if (presenting) return;
  const z = view.zoom;
  const hs = 9 / z;

  // viền khi rê chuột
  if (hoverId && !action && !selection.has(hoverId)) {
    const h = byId(hoverId);
    if (h && !isPointType(h.type)) ov.appendChild(el("path", { d: outlinePath(h), class: "hover-box" }));
  }
  // đánh dấu hình đích khi kéo đầu nối
  if (connectHot) {
    const t = byId(connectHot.id);
    if (t) {
      ov.appendChild(el("path", { d: outlinePath(t), class: "hover-box", "stroke-opacity": 1 }));
      for (const side of ["top", "right", "bottom", "left"]) {
        const [ax, ay] = anchorPoint(t, side);
        ov.appendChild(el("circle", { cx: ax, cy: ay, r: 5 / z, class: "h-anchor" + (side === connectHot.side ? " hot" : "") }));
      }
    }
  }
  const roots = selRoots();
  if (!roots.length || editing) return;

  if (roots.length === 1 && roots[0].type !== "group") {
    const e = roots[0];
    if (isPointType(e.type)) {
      const pts = routePoints(e);
      const d = "M" + pts.map((p) => `${p[0]} ${p[1]}`).join("L");
      ov.appendChild(el("path", { d, fill: "none", stroke: "var(--sel)", "stroke-opacity": 0.28, "stroke-width": (e.style?.strokeWidth || 2) + 8, "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none" }));
      const raw = e.points || [];
      raw.forEach((p, i) => {
        if (i !== 0 && i !== raw.length - 1) return;
        addHandle(ov, p[0], p[1], hs * 1.1, { handle: "vertex", idx: String(i) }, "move", "circle");
      });
      return;
    }
    const b = elementBox(e);
    const rot = e.rotation || 0;
    const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
    ov.appendChild(el("path", { d: outlinePath(e), class: "sel-box" }));
    const lockCorners = e.lockRatio !== false && (e.type === "image");
    const small = b.w * z < 28 || b.h * z < 28;
    for (const [name, fx, fy] of HANDLES) {
      if (e.type === "text") break;
      if (name.length === 1 && (small || lockCorners)) continue;
      const [px, py] = rotatePoint(b.x + fx * b.w, b.y + fy * b.h, cx, cy, rot);
      addHandle(ov, px, py, hs, { handle: "resize", name }, cursorForHandle(name, rot));
    }
    // tay nắm xoay
    const [tx, ty] = rotatePoint(cx, b.y, cx, cy, rot);
    const [rx, ry] = rotatePoint(cx, b.y - 28 / z, cx, cy, rot);
    ov.appendChild(el("line", { x1: tx, y1: ty, x2: rx, y2: ry, class: "h-line" }));
    addHandle(ov, rx, ry, hs * 1.05, { handle: "rotate" }, "grab", "circle");
    // điểm nối (chỉ khi dùng công cụ chọn và hình đủ lớn)
    if (tool === "select" && e.type !== "text" && !MEDIA_TYPES.has(e.type)) {
      for (const side of ["top", "right", "bottom", "left"]) {
        const [ax, ay] = anchorPoint(e, side);
        const dir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
        const r = rad(rot), c = Math.cos(r), s = Math.sin(r);
        const ox = (dir[0] * c - dir[1] * s) * 15 / z, oy = (dir[0] * s + dir[1] * c) * 15 / z;
        const dot = el("circle", { cx: ax + ox, cy: ay + oy, r: 5.5 / z, class: "h-anchor" });
        dot.dataset.handle = "anchor"; dot.dataset.side = side; dot.style.cursor = "crosshair";
        ov.appendChild(dot);
      }
    }
    return;
  }

  // nhiều phần tử / nhóm: khung bao + tay nắm tỉ lệ
  for (const r of roots) ov.appendChild(el("path", { d: outlinePath(r), class: "sel-box multi" }));
  const bb = boundsOf(doc.leaves([...selection]).map(byId).filter(Boolean));
  if (!bb) return;
  ov.appendChild(el("rect", { x: bb.minX, y: bb.minY, width: bb.w, height: bb.h, class: "sel-box" }));
  const small = bb.w * z < 28 || bb.h * z < 28;
  for (const [name, fx, fy] of HANDLES) {
    if (name.length === 1 && small) continue;
    addHandle(ov, bb.minX + fx * bb.w, bb.minY + fy * bb.h, hs, { handle: "scale", name }, cursorForHandle(name, 0));
  }
}

/* ============ thanh thao tác nhanh nổi (video / nhúng / ảnh) ============ */

const ctxBar = $("ctxBar");
ctxBar.addEventListener("pointerdown", (e) => e.stopPropagation());
function positionCtxBar() {
  const roots = selRoots();
  const e = roots.length === 1 ? roots[0] : null;
  if (!e || !MEDIA_TYPES.has(e.type) || action || editing || presenting) { ctxBar.classList.add("hidden"); ctxBar.dataset.id = ""; return; }
  if (ctxBar.dataset.id !== e.id + (view.media?.interactiveId === e.id ? ":i" : "")) buildCtxBar(e);
  const bb = worldBBox(e);
  const tl = view.worldToScreen(bb.x, bb.y), br = view.worldToScreen(bb.x + bb.w, bb.y + bb.h);
  const hr = host.getBoundingClientRect();
  ctxBar.classList.remove("hidden");
  const w = ctxBar.offsetWidth, h = ctxBar.offsetHeight;
  let x = (tl.x + br.x) / 2 - hr.left - w / 2;
  let y = tl.y - hr.top - h - 44;            // trên tay nắm xoay
  if (y < 8) y = br.y - hr.top + 14;         // không đủ chỗ → đặt bên dưới
  x = clamp(x, 8, Math.max(8, hr.width - w - 8));
  y = clamp(y, 8, Math.max(8, hr.height - h - 8));
  ctxBar.style.left = x + "px"; ctxBar.style.top = y + "px";
}
function buildCtxBar(e) {
  ctxBar.replaceChildren();
  const interactive = view.media?.interactiveId === e.id;
  ctxBar.dataset.id = e.id + (interactive ? ":i" : "");
  const mk = (icon, label, fn, cls = "") => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "cb " + cls; b.innerHTML = icon;
    const s = document.createElement("span"); s.textContent = label; b.appendChild(s);
    b.addEventListener("click", fn);
    ctxBar.appendChild(b);
  };
  if (e.type === "embed" || e.type === "video") {
    mk(ICONS.interact, interactive ? "Thoát tương tác" : "Bấm vào trình phát", () => { view.media.setInteractive(interactive ? null : e.id); buildCtxBar(e); positionCtxBar(); }, interactive ? "on" : "");
    mk(ICONS.link, "Đổi liên kết", () => openMediaDialog({ mode: e.type === "video" ? "video" : "embed", target: e }));
  } else {
    mk(ICONS.image, "Đổi ảnh", () => openImageDialog({ target: e }));
  }
  mk(ICONS.trash, "Xóa", () => deleteSelection(), "danger");
}
if (view.media) view.media.onInteractChange = () => { ctxBar.dataset.id = ""; scheduleOverlay(); };

/* ============ công cụ ============ */

const LINE_TOOLS = {
  "line": { type: "line", label: "Đường thẳng" },
  "arrow": { type: "arrow", label: "Mũi tên" },
  "conn-elbow": { type: "connector", route: "elbow", label: "Nối gấp khúc" },
  "conn-curve": { type: "connector", route: "curve", label: "Nối cong" },
  "conn-straight": { type: "connector", route: "straight", label: "Nối thẳng" },
};
const SIZES = {
  "default": [160, 96], "ellipse": [140, 96], "diamond": [140, 104], "star": [124, 118], "plus": [100, 100], "heart": [124, 112],
  "cylinder": [120, 130], "cloud": [176, 108], "callout": [176, 116], "arrow-right": [176, 88], "chevron": [160, 88],
  "triangle": [136, 116], "right-triangle": [136, 116], "pentagon": [132, 126], "hexagon": [152, 104], "octagon": [132, 132],
  "note": [184, 144], "frame": [420, 280],
};
const isBoxTool = (t) => !!SHAPES[t] || t === "note" || t === "frame";

function setTool(t, locked = false) {
  if (presenting) return;
  closeEditor(true);
  tool = t; toolLocked = locked && t !== "select" && t !== "hand";
  host.style.cursor = t === "hand" ? "grab" : t === "select" ? "default" : "crosshair";
  if (t !== "select") { /* giữ vùng chọn để dễ thấy */ }
  hoverId = null;
  redraw();
}
function afterCreate() {
  if (!toolLocked) setTool("select");
}

/* ============ con trỏ chuột ============ */

function eventWorld(e) { return view.screenToWorld(e.clientX, e.clientY); }

function dragTracker(e, { move, up, cancel }) {
  const pid = e.pointerId;
  const mv = (ev) => { if (ev.pointerId !== pid || view.pinching) return; move(ev); };
  const end = (ev) => { if (ev.pointerId !== pid) return; cleanup(); action = null; up(ev); };
  const abort = () => { cleanup(); action = null; cancel?.(); revertToHistory(); redraw(true); };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); abort(); } };
  function cleanup() {
    window.removeEventListener("pointermove", mv);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", abortOnCancel);
    window.removeEventListener("keydown", key, true);
    connectHot = null;
  }
  const abortOnCancel = (ev) => { if (ev.pointerId === pid) abort(); };
  window.addEventListener("pointermove", mv);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", abortOnCancel);
  window.addEventListener("keydown", key, true);
  action = { abort };
}
function cancelAction() { if (action) action.abort(); }

host.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".ctx-bar, .canvas-hud, .text-editor-overlay, .media-exit")) return;
  if (presenting) {
    if ((e.button === 0 || e.button === 1) && !e.target.closest(".media-box.is-interactive")) view.startPan(e);
    return;
  }
  if (editing) { closeEditor(true); }
  if (e.button === 1 || (e.button === 0 && (spaceDown || tool === "hand"))) { e.preventDefault(); view.startPan(e); return; }
  if (e.button !== 0) return;
  if (CP.isOpen()) CP.close();

  const world = eventWorld(e);
  const hd = e.target.closest?.("[data-handle]");
  if (hd) {
    const kind = hd.dataset.handle;
    if (kind === "resize") return startResize(e, hd.dataset.name);
    if (kind === "scale") return startScale(e, hd.dataset.name);
    if (kind === "rotate") return startRotate(e);
    if (kind === "vertex") return startVertex(e, byId([...selection][0]), +hd.dataset.idx, false);
    if (kind === "anchor") return startConnectFromAnchor(e, byId([...selection][0]), hd.dataset.side);
  }

  const tol = 6 / view.zoom;
  if (tool === "select") {
    const hit = hitTest(doc, world.x, world.y, tol);
    const rootEl = hit ? doc.rootOf(hit) : null;
    if (rootEl) {
      if (e.shiftKey) {
        if (selection.has(rootEl.id)) selection.delete(rootEl.id); else selection.add(rootEl.id);
        redraw(true);
        if (!selection.has(rootEl.id)) return;
      } else if (!selection.has(rootEl.id)) {
        selection = new Set([rootEl.id]);
        redraw(true);
      }
      if (e.altKey) duplicateSelection(true);
      startMove(e, world);
    } else {
      if (!e.shiftKey && selection.size) { selection.clear(); redraw(true); }
      startMarquee(e, world);
    }
    return;
  }
  if (LINE_TOOLS[tool]) return startDrawLine(e, world);
  if (tool === "text") return createTextAt(world);
  if (isBoxTool(tool)) return startDrawBox(e, world);
});

/* ---- di chuyển ---- */
function startMove(e, worldStart) {
  const movingIds = new Set(doc.leaves([...selection]));
  // Khung (frame): kéo theo các phần tử nằm hoàn toàn bên trong
  for (const r of selRoots()) {
    if (r.type !== "frame") continue;
    const fb = elementBox(r);
    for (const o of doc.elements) {
      if (o.id === r.id || o.type === "group" || movingIds.has(o.id)) continue;
      const b = worldBBox(o);
      if (b.x >= fb.x && b.y >= fb.y && b.x + b.w <= fb.x + fb.w && b.y + b.h <= fb.y + fb.h) movingIds.add(o.id);
    }
  }
  const items = [...movingIds].map(byId).filter(Boolean).map((o) => ({ o, x: o.x, y: o.y, pts: o.points?.map((p) => [...p]) }));
  if (!items.length) return;
  const bb0 = boundsOf(items.map((i) => i.o));
  let moved = false;
  const sx0 = e.clientX, sy0 = e.clientY;
  dragTracker(e, {
    move(ev) {
      if (!moved && Math.hypot(ev.clientX - sx0, ev.clientY - sy0) < 3) return;
      moved = true;
      host.style.cursor = "move";
      const w = eventWorld(ev);
      let dx = w.x - worldStart.x, dy = w.y - worldStart.y;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (bb0) { dx = sn(bb0.minX + dx, ev) - bb0.minX; dy = sn(bb0.minY + dy, ev) - bb0.minY; }
      for (const it of items) {
        const o = it.o;
        o.x = it.x + dx; o.y = it.y + dy;
        if (it.pts && o.points) {
          o.points = it.pts.map((p, i) => {
            const last = i === it.pts.length - 1;
            // đầu đã gắn vào hình không thuộc nhóm đang kéo thì giữ nguyên (tự bám theo hình)
            if (i === 0 && o.startId && !movingIds.has(o.startId)) return p;
            if (last && o.endId && !movingIds.has(o.endId)) return p;
            return [p[0] + dx, p[1] + dy];
          });
        }
      }
      redrawNow();
    },
    up() {
      host.style.cursor = tool === "hand" ? "grab" : "default";
      if (moved) { commit("move"); redraw(); }
    },
  });
}

/* ---- khung chọn ---- */
function startMarquee(e, worldStart) {
  const base = e.shiftKey ? new Set(selection) : new Set();
  let rect = null, moved = false;
  const sx0 = e.clientX, sy0 = e.clientY;
  dragTracker(e, {
    move(ev) {
      if (!moved && Math.hypot(ev.clientX - sx0, ev.clientY - sy0) < 3) return;
      moved = true;
      const w = eventWorld(ev);
      const x = Math.min(w.x, worldStart.x), y = Math.min(w.y, worldStart.y);
      const width = Math.abs(w.x - worldStart.x), height = Math.abs(w.y - worldStart.y);
      renderOverlay();
      rect = { x, y, width, height };
      view.overlay.appendChild(el("rect", { ...rect, class: "selection-marquee" }));
      // chọn trực tiếp khi kéo (giao nhau với khung)
      const next = new Set(base);
      for (const o of doc.elements) {
        if (o.type === "group") continue;
        const b = worldBBox(o);
        if (b.x < x + width && b.x + b.w > x && b.y < y + height && b.y + b.h > y) next.add(doc.rootOf(o).id);
      }
      selection = next;
    },
    up() { redraw(true); },
    cancel() { selection = base; },
  });
}

/* ---- đổi kích thước một phần tử (có xoay) ---- */
function startResize(e, name) {
  const t = byId([...selection][0]);
  if (!t) return;
  const b0 = elementBox(t);
  const rot = t.rotation || 0;
  const c0 = [b0.x + b0.w / 2, b0.y + b0.h / 2];
  const hasE = name.includes("e"), hasW = name.includes("w"), hasS = name.includes("s"), hasN = name.includes("n");
  const ax = hasE ? 0 : hasW ? 1 : 0.5, ay = hasS ? 0 : hasN ? 1 : 0.5;   // điểm neo (đối diện tay nắm)
  const anchorWorld = rotatePoint(b0.x + ax * b0.w, b0.y + ay * b0.h, c0[0], c0[1], rot);
  const ratio = b0.w / (b0.h || 1);
  const lock = t.type === "image" ? t.lockRatio !== false : false;
  const orig = { x: t.x, y: t.y, w: t.width, h: t.height };
  const MIN = 12;
  let changed = false;
  dragTracker(e, {
    move(ev) {
      changed = true;
      const w = eventWorld(ev);
      const v = rotatePoint(w.x, w.y, anchorWorld[0], anchorWorld[1], -rot);   // vector trong trục của phần tử
      let nw = hasE ? v[0] - anchorWorld[0] : hasW ? anchorWorld[0] - v[0] : b0.w;
      let nh = hasS ? v[1] - anchorWorld[1] : hasN ? anchorWorld[1] - v[1] : b0.h;
      if (hasE || hasW) nw = Math.max(MIN, nw);
      if (hasN || hasS) nh = Math.max(MIN, nh);
      const corner = name.length === 2;
      if (corner && (lock || ev.shiftKey)) {
        const k = Math.max(nw / b0.w, nh / b0.h);
        nw = Math.max(MIN, b0.w * k); nh = Math.max(MIN, b0.h * k);
      } else {
        if (hasE || hasW) nw = Math.max(MIN, sn(nw, ev));
        if (hasN || hasS) nh = Math.max(MIN, sn(nh, ev));
      }
      // tâm mới = neo + (nửa kích thước theo hướng kéo), quay về hệ toạ độ thế giới
      const offX = hasE ? nw / 2 : hasW ? -nw / 2 : 0;
      const offY = hasS ? nh / 2 : hasN ? -nh / 2 : 0;
      const [cx, cy] = rotatePoint(anchorWorld[0] + offX, anchorWorld[1] + offY, anchorWorld[0], anchorWorld[1], rot);
      t.width = nw; t.height = nh; t.x = cx - nw / 2; t.y = cy - nh / 2;
      redrawNow();
    },
    up() { if (changed) { commit("resize"); redraw(); } },
    cancel() { /* revertToHistory() khôi phục lại */ },
  });
}

/* ---- đổi tỉ lệ nhiều phần tử / nhóm ---- */
function startScale(e, name) {
  const leaves = selLeaves();
  const bb = boundsOf(leaves);
  if (!bb) return;
  const hasE = name.includes("e"), hasW = name.includes("w"), hasS = name.includes("s"), hasN = name.includes("n");
  const anchor = [hasE ? bb.minX : hasW ? bb.maxX : bb.minX + bb.w / 2, hasS ? bb.minY : hasN ? bb.maxY : bb.minY + bb.h / 2];
  const snapshot = leaves.map((o) => ({ o, x: o.x, y: o.y, w: o.width, h: o.height, fs: o.style?.fontSize, pts: o.points?.map((p) => [...p]) }));
  let changed = false;
  dragTracker(e, {
    move(ev) {
      changed = true;
      const w = eventWorld(ev);
      let sx = hasE ? (w.x - anchor[0]) / bb.w : hasW ? (anchor[0] - w.x) / bb.w : 1;
      let sy = hasS ? (w.y - anchor[1]) / bb.h : hasN ? (anchor[1] - w.y) / bb.h : 1;
      if (name.length === 2 || ev.shiftKey) { const k = Math.max(sx, sy); sx = sy = k; }
      sx = Math.max(0.05, sx); sy = Math.max(0.05, sy);
      for (const s of snapshot) {
        const o = s.o;
        const ox = anchor[0] + (s.x - anchor[0]) * sx, oy = anchor[1] + (s.y - anchor[1]) * sy;
        o.x = ox; o.y = oy;
        if (s.pts) o.points = s.pts.map((p) => [anchor[0] + (p[0] - anchor[0]) * sx, anchor[1] + (p[1] - anchor[1]) * sy]);
        if (s.w != null && !isPointType(o.type)) {
          const quarter = Math.round(((o.rotation || 0) % 180) / 90) % 2 === 1 && (o.rotation || 0) % 90 === 0;
          const kw = quarter ? sy : sx, kh = quarter ? sx : sy;
          o.width = Math.max(4, s.w * kw); o.height = Math.max(4, s.h * kh);
          if (s.fs) o.style = { ...o.style, fontSize: clamp(round(s.fs * Math.sqrt(sx * sy), 1), 6, 200) };
          if (o.type === "text") fitText(o);
        }
      }
      redrawNow();
    },
    up() { if (changed) { commit("scale"); redraw(); } },
    cancel() { /* revertToHistory() khôi phục lại */ },
  });
}

/* ---- xoay ---- */
function startRotate(e) {
  const t = byId([...selection][0]);
  if (!t) return;
  const [cx, cy] = elementCenter(t);
  const startRot = t.rotation || 0;
  const w0 = eventWorld(e);
  const a0 = Math.atan2(w0.y - cy, w0.x - cx);
  let changed = false;
  host.style.cursor = "grabbing";
  dragTracker(e, {
    move(ev) {
      changed = true;
      const w = eventWorld(ev);
      let deg = startRot + ((Math.atan2(w.y - cy, w.x - cx) - a0) * 180) / Math.PI;
      deg = ((deg % 360) + 540) % 360 - 180;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else { const m = Math.round(deg / 45) * 45; if (Math.abs(deg - m) < 3) deg = m; }
      t.rotation = round(deg, 1);
      redrawNow();
    },
    up() { host.style.cursor = "default"; if (changed) { commit("rotate"); redraw(); } },
    cancel() { host.style.cursor = "default"; },
  });
}

/* ---- đường thẳng / mũi tên / đường nối ---- */
function attachTarget(world, exceptId) {
  return hitTest(doc, world.x, world.y, 10 / view.zoom, { only: (o) => !isPointType(o.type) && o.type !== "group" && o.id !== exceptId });
}
/** Cạnh để gắn: nếu con trỏ nằm sâu bên trong hình thì để tự động (undefined), gần mép thì cố định cạnh gần nhất. */
function sideForPointer(target, w) {
  const b = elementBox(target);
  const [lx, ly] = rotatePoint(w.x, w.y, b.x + b.w / 2, b.y + b.h / 2, -(target.rotation || 0));
  const edge = Math.min(Math.abs(lx - b.x), Math.abs(lx - b.x - b.w), Math.abs(ly - b.y), Math.abs(ly - b.y - b.h));
  const inside = lx > b.x && lx < b.x + b.w && ly > b.y && ly < b.y + b.h;
  return inside && edge > 18 / view.zoom ? undefined : nearestSide(target, w);
}
function startDrawLine(e, world) {
  const def = LINE_TOOLS[tool];
  const style = { ...DEFAULT_STYLES[def.type] };
  if (def.route) style.route = def.route;
  const start = def.type === "line" ? null : attachTarget(world, null);
  const p0 = [sn(world.x, e), sn(world.y, e)];
  const line = { id: uid(), type: def.type, x: p0[0], y: p0[1], points: [p0, [...p0]], style, text: "", rotation: 0 };
  if (start) { line.startId = start.id; line.startSide = sideForPointer(start, world); line.points[0] = anchorPoint(start, line.startSide || nearestSide(start, world)); }
  doc.add(line);
  selection = new Set([line.id]);
  startVertex(e, line, 1, true);
}
function startConnectFromAnchor(e, shape, side) {
  if (!shape) return;
  const p0 = anchorPoint(shape, side);
  const line = {
    id: uid(), type: "connector", x: p0[0], y: p0[1], points: [p0, [...p0]], text: "", rotation: 0,
    style: { ...DEFAULT_STYLES.connector }, startId: shape.id, startSide: side,
  };
  doc.add(line);
  selection = new Set([line.id]);
  startVertex(e, line, 1, true);
}
function startVertex(e, line, idx, isNew) {
  if (!line) return;
  const canAttach = line.type !== "line";
  const isStart = idx === 0;
  let changed = isNew;
  dragTracker(e, {
    move(ev) {
      changed = true;
      const w = eventWorld(ev);
      const target = canAttach ? attachTarget(w, null) : null;
      const sideKey = isStart ? "startSide" : "endSide", idKey = isStart ? "startId" : "endId";
      if (target) {
        line[idKey] = target.id; line[sideKey] = sideForPointer(target, w);
        line.points[idx] = anchorPoint(target, line[sideKey] || nearestSide(target, w));
        connectHot = { id: target.id, side: line[sideKey] };
      } else {
        line[idKey] = undefined; line[sideKey] = undefined;
        let px = sn(w.x, ev), py = sn(w.y, ev);
        if (ev.shiftKey) {
          const o = line.points[isStart ? line.points.length - 1 : 0];
          const dx = px - o[0], dy = py - o[1];
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          px = o[0] + Math.cos(ang) * len; py = o[1] + Math.sin(ang) * len;
        }
        line.points[idx] = [px, py];
        connectHot = null;
      }
      redrawNow();
    },
    up() {
      connectHot = null;
      const a = line.points[0], b = line.points[line.points.length - 1];
      if (isNew && Math.hypot(b[0] - a[0], b[1] - a[1]) < 6 && !line.endId) {
        doc.remove([line.id]); selection.clear();
        redraw(true);
        return;
      }
      if (changed) commit(isNew ? "draw" : "line");
      if (isNew) afterCreate();
      redraw(true);
    },
    cancel() { /* revertToHistory() khôi phục lại */ },
  });
  redrawNow();
}

/* ---- vẽ hình ---- */
function startDrawBox(e, world) {
  const type = tool;
  const s0 = { x: sn(world.x, e), y: sn(world.y, e) };
  const shape = { id: uid(), type, x: s0.x, y: s0.y, width: 0, height: 0, text: "", rotation: 0, style: { ...(DEFAULT_STYLES[type] || {}) } };
  doc.add(shape);
  selection = new Set([shape.id]);
  let dragged = false;
  dragTracker(e, {
    move(ev) {
      const w = eventWorld(ev);
      const px = sn(w.x, ev), py = sn(w.y, ev);
      if (!dragged && Math.hypot(px - s0.x, py - s0.y) < 4) return;
      dragged = true;
      let dx = px - s0.x, dy = py - s0.y;
      if (ev.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
      if (ev.altKey) { shape.x = s0.x - Math.abs(dx); shape.y = s0.y - Math.abs(dy); shape.width = Math.abs(dx) * 2; shape.height = Math.abs(dy) * 2; }
      else { shape.x = Math.min(s0.x, s0.x + dx); shape.y = Math.min(s0.y, s0.y + dy); shape.width = Math.abs(dx); shape.height = Math.abs(dy); }
      redrawNow();
    },
    up() {
      if (!dragged || shape.width < 6 || shape.height < 6) {
        const [dw, dh] = SIZES[type] || SIZES.default;
        shape.width = dw; shape.height = dh;
        shape.x = sn(world.x - dw / 2, e); shape.y = sn(world.y - dh / 2, e);
      }
      commit("draw");
      afterCreate();
      redraw(true);
    },
  });
  redrawNow();
}

/* ============ soạn chữ trực tiếp ============ */

function createTextAt(world) {
  const t = { id: uid(), type: "text", x: sn(world.x, null), y: sn(world.y, null), width: 0, height: 0, text: "", rotation: 0, style: { ...DEFAULT_STYLES.text } };
  doc.add(t);
  selection = new Set([t.id]);
  redrawNow();
  editText(t, true);
}

function editText(t, isNew = false) {
  if (!t || presenting || isPointType(t.type) || MEDIA_TYPES.has(t.type) || t.type === "group") return;
  closeEditor(true);
  const s = t.style || {};
  const fs = s.fontSize || (t.type === "text" ? 18 : 15);
  const lh = lineHeightOf(fs);
  const z = view.zoom;
  const isFree = t.type === "text";
  const tb = isFree ? { x: t.x + 4, y: t.y + 3, w: Math.max(t.width - 8, 160), h: t.height } : textBoxOf(t);
  const ta = document.createElement("textarea");
  ta.className = "text-editor-overlay";
  ta.setAttribute("aria-label", "Nhập nội dung");
  ta.spellcheck = false;
  ta.value = t.text || "";
  const tl = view.worldToScreen(tb.x, tb.y), hr = host.getBoundingClientRect();
  const [cx, cy] = elementCenter(t);
  const cs = view.worldToScreen(cx, cy);
  Object.assign(ta.style, {
    left: tl.x - hr.left + "px", top: tl.y - hr.top + "px",
    width: tb.w * z + "px", height: Math.max(tb.h, lh) * z + "px",
    font: `${s.fontStyle === "italic" ? "italic " : ""}${s.fontWeight === "bold" ? "700 " : "400 "}${fs * z}px/${lh * z}px ${E.FONT_FAMILIES[s.fontFamily] || E.FONT_FAMILIES.sans}`,
    textAlign: s.textAlign || (isFree ? "left" : "center"),
    color: Color.isNone(s.textColor) ? "inherit" : Color.toHex(Color.parse(s.textColor)),
    transformOrigin: `${cs.x - tl.x}px ${cs.y - tl.y}px`,
    transform: t.rotation ? `rotate(${t.rotation}deg)` : "",
  });
  host.appendChild(ta);
  editing = { el: t, ta, isNew };
  redrawNow();
  const fitBox = () => {
    const lines = ta.value.split("\n");
    if (isFree) {
      let w = 0; for (const l of lines) w = Math.max(w, TextMeasure.width(l, s, fs));
      ta.style.width = Math.max(tb.w, w + 14) * z + "px";
      ta.style.height = Math.max(lh, lines.length * lh) * z + "px";
    } else {
      const wrapped = wrapText(ta.value, s, fs, tb.w).length || 1;
      const th = wrapped * lh;
      const pad = t.type === "note" || t.type === "frame" ? 0 : Math.max(0, (tb.h - th) / 2);
      ta.style.paddingTop = pad * z + "px";
      ta.style.height = Math.max(tb.h, th) * z + "px";
    }
  };
  ta.addEventListener("input", fitBox);
  fitBox();
  ta.focus(); ta.select();
  ta.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape" || (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); closeEditor(true); }
  });
  ta.addEventListener("blur", () => closeEditor(true));
  ta.addEventListener("pointerdown", (ev) => ev.stopPropagation());
}
function closeEditor(save) {
  if (!editing) return;
  const { el: t, ta, isNew } = editing;
  editing = null;
  ta.removeEventListener("blur", closeEditor);
  const value = ta.value;
  ta.remove();
  if (!save) { if (isNew) doc.remove([t.id]); redraw(true); return; }
  if (t.type === "text" && value.trim() === "") { doc.remove([t.id]); selection.delete(t.id); }
  else { t.text = value; if (t.type === "text") fitText(t); }
  commit("text");
  if (isNew && t.type === "text") afterCreate();
  redraw(true);
}

view.onDouble((world) => {
  if (presenting) return;
  const hit = hitTest(doc, world.x, world.y, 6 / view.zoom);
  if (!hit) {
    if (tool === "select") { // nhấp đúp vào chỗ trống: thêm chữ
      const t = { id: uid(), type: "text", x: sn(world.x, null), y: sn(world.y, null), width: 0, height: 0, text: "", rotation: 0, style: { ...DEFAULT_STYLES.text } };
      doc.add(t); selection = new Set([t.id]); redrawNow(); editText(t, true);
    }
    return;
  }
  if (hit.type === "embed" || hit.type === "video") { selection = new Set([hit.id]); view.media.setInteractive(hit.id); redraw(true); return; }
  if (hit.type === "image") { openImageDialog({ target: hit }); return; }
  if (isPointType(hit.type)) return;
  selection = new Set([hit.id]);
  redrawNow();
  editText(hit);
});

/* ============ rê chuột: viền gợi ý + con trỏ ============ */

let hoverRaf = 0, lastMove = null;
host.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") return;
  lastMove = e;
  if (hoverRaf || action || presenting) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (action || !lastMove) return;
    const ev = lastMove;
    if (ev.target.closest?.("[data-handle], .ctx-bar, .canvas-hud, .text-editor-overlay")) { if (hoverId) { hoverId = null; renderOverlay(); } return; }
    const w = eventWorld(ev);
    const hit = hitTest(doc, w.x, w.y, 6 / view.zoom);
    const id = hit ? doc.rootOf(hit).id : null;
    const showable = tool === "select" || LINE_TOOLS[tool];
    const nextHover = showable ? id : null;
    if (nextHover !== hoverId) {
      hoverId = nextHover;
      renderOverlay();
    }
    if (tool === "select" && !spaceDown) host.style.cursor = hit ? (selection.has(id) ? "move" : "pointer") : "default";
  });
});
host.addEventListener("pointerleave", () => { if (hoverId) { hoverId = null; renderOverlay(); } });

/* ============ sao chép / cắt / dán / nhân bản / xóa / nhóm ============ */

function snapshotForClipboard() {
  const ids = new Set(doc.withDescendants([...selection]));
  return doc.serialize().elements.filter((o) => ids.has(o.id));
}
let pasteN = 0;
function copySelection(silent) {
  if (!selection.size) return false;
  clipboard = snapshotForClipboard(); pasteN = 0;
  if (!silent) Toast.show(`Đã sao chép ${clipboard.length} phần tử`, "ok", 1400);
  return true;
}
function cutSelection() { if (copySelection(true)) { deleteSelection(true); Toast.show("Đã cắt", "ok", 1200); } }
function pasteItems(items, offset = GRID * 2) {
  if (!items || !items.length) return;
  const map = {};
  for (const it of items) map[it.id] = uid();
  const created = [];
  for (const it of items) {
    const c = doc.migrate({ ...JSON.parse(JSON.stringify(it)), id: map[it.id] });
    c.x += offset; c.y += offset;
    if (c.points) c.points = c.points.map((p) => [p[0] + offset, p[1] + offset]);
    c.startId = c.startId && map[c.startId] ? map[c.startId] : undefined;
    c.endId = c.endId && map[c.endId] ? map[c.endId] : undefined;
    if (!c.startId) c.startSide = undefined;
    if (!c.endId) c.endSide = undefined;
    if (c.children) c.children = c.children.map((k) => map[k]).filter(Boolean);
    doc.add(c); created.push(c);
  }
  const childSet = new Set(created.flatMap((c) => c.children || []));
  selection = new Set(created.filter((c) => !childSet.has(c.id)).map((c) => c.id));
  commit("paste");
  redraw(true);
}
function pasteInternal() {
  if (!clipboard) return false;
  pasteItems(clipboard, GRID * 2 * ++pasteN);
  return true;
}
function duplicateSelection(silent) {
  if (!selection.size) return;
  pasteItems(snapshotForClipboard(), silent ? 0 : GRID * 2);
}
function deleteSelection(force) {
  if (!selection.size) return;
  const run = () => {
    if (view.media?.interactiveId && selection.has(view.media.interactiveId)) view.media.setInteractive(null);
    doc.remove([...selection]); selection.clear(); commit("delete"); redraw(true);
  };
  if (!force && prefs.confirmBeforeDelete !== false && selection.size > 3) {
    UI.confirm({ title: `Xóa ${selection.size} phần tử?`, message: "Các phần tử đang chọn sẽ bị xóa khỏi sơ đồ (có thể hoàn tác bằng Ctrl+Z).", okLabel: "Xóa" }).then((ok) => { if (ok) run(); });
  } else run();
}
function groupSelection() {
  const roots = selRoots();
  if (roots.length < 2) return;
  const g = doc.migrate({ id: uid(), type: "group", x: 0, y: 0, children: roots.map((r) => r.id), style: {} });
  // nhóm đặt ngay trên phần tử trên cùng trong nhóm
  doc.add(g);
  selection = new Set([g.id]);
  commit("group"); redraw(true);
}
function ungroupSelection() {
  const groups = selRoots().filter((r) => r.type === "group");
  if (!groups.length) return;
  const next = new Set(selection);
  for (const g of groups) { next.delete(g.id); (g.children || []).forEach((c) => next.add(c)); }
  doc.elements = doc.elements.filter((o) => !groups.includes(o));
  selection = next;
  commit("ungroup"); redraw(true);
}
function reorder(mode) {
  if (!selection.size) return;
  doc.reorder([...selection], mode);
  commit("z"); redraw();
}

/* ============ căn chỉnh / phân bổ / xoay ============ */

function moveRoot(r, dx, dy) {
  for (const o of doc.leaves([r.id]).map(byId).filter(Boolean)) {
    o.x += dx; o.y += dy;
    if (o.points) o.points = o.points.map((p) => [p[0] + dx, p[1] + dy]);
  }
}
function alignSelection(kind) {
  const roots = selRoots();
  if (roots.length < 2) return;
  const boxes = roots.map((r) => ({ r, b: worldBBox(r) }));
  const u = { l: Math.min(...boxes.map((x) => x.b.x)), t: Math.min(...boxes.map((x) => x.b.y)), r: Math.max(...boxes.map((x) => x.b.x + x.b.w)), bt: Math.max(...boxes.map((x) => x.b.y + x.b.h)) };
  for (const { r, b } of boxes) {
    let dx = 0, dy = 0;
    if (kind === "left") dx = u.l - b.x;
    if (kind === "right") dx = u.r - (b.x + b.w);
    if (kind === "centerH") dx = (u.l + u.r) / 2 - (b.x + b.w / 2);
    if (kind === "top") dy = u.t - b.y;
    if (kind === "bottom") dy = u.bt - (b.y + b.h);
    if (kind === "middle") dy = (u.t + u.bt) / 2 - (b.y + b.h / 2);
    moveRoot(r, dx, dy);
  }
  commit("align"); redraw();
}
function distributeSelection(axis) {
  const roots = selRoots();
  if (roots.length < 3) return;
  const items = roots.map((r) => ({ r, b: worldBBox(r) })).sort((a, c) => (axis === "h" ? a.b.x - c.b.x : a.b.y - c.b.y));
  const first = items[0].b, last = items[items.length - 1].b;
  const span = axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
  const total = items.reduce((n, i) => n + (axis === "h" ? i.b.w : i.b.h), 0);
  const gap = (span - total) / (items.length - 1);
  let pos = axis === "h" ? first.x : first.y;
  for (const it of items) {
    const cur = axis === "h" ? it.b.x : it.b.y;
    const d = pos - cur;
    if (axis === "h") moveRoot(it.r, d, 0); else moveRoot(it.r, 0, d);
    pos += (axis === "h" ? it.b.w : it.b.h) + gap;
  }
  commit("distribute"); redraw();
}
function rotateBy(deg) {
  const leaves = selLeaves().filter((o) => !isPointType(o.type));
  if (!leaves.length) return;
  for (const o of leaves) { o.rotation = round((((((o.rotation || 0) + deg) % 360) + 540) % 360) - 180, 1); }
  commit("rotate"); redraw();
}
function resetRotation() {
  const leaves = selLeaves().filter((o) => !isPointType(o.type) && o.rotation);
  if (!leaves.length) return;
  for (const o of leaves) o.rotation = 0;
  commit("rotate"); redraw();
}

/* ============ áp kiểu ============ */

function leavesWhere(pred) { return selLeaves().filter(pred); }
const isFillable = (o) => !isPointType(o.type) && !MEDIA_TYPES.has(o.type) && o.type !== "text" && o.type !== "group";
const isTexty = (o) => !isPointType(o.type) && !MEDIA_TYPES.has(o.type) && o.type !== "group";
function applyStyle(patch, key, pred) {
  const targets = leavesWhere(pred || (() => true));
  if (!targets.length) return;
  for (const o of targets) {
    const next = { ...(o.style || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    o.style = next;
    if (o.type === "text" && ("fontSize" in patch || "fontWeight" in patch || "fontStyle" in patch || "fontFamily" in patch)) fitText(o);
  }
  commit("style", "style:" + (key || Object.keys(patch).join(",")));
  redraw();
}
function setProp(prop, value, key) {
  for (const o of selLeaves()) o[prop] = value;
  commit("prop", "prop:" + (key || prop));
  redraw();
}

/* ============ chèn ảnh / video / nhúng ============ */

function mediaChars() { return doc.elements.reduce((n, o) => n + (o.src && o.src.startsWith("data:") ? o.src.length : 0), 0); }
function placeNear(w, h, at) {
  const c = at || canvasCenterWorld();
  const n = doc.elements.filter((o) => MEDIA_TYPES.has(o.type)).length % 6;
  return { x: sn(c.x - w / 2 + n * 12, null), y: sn(c.y - h / 2 + n * 12, null) };
}
function fitSize(w, h, maxSide = 520) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(24, Math.round(w * k)), Math.max(24, Math.round(h * k))];
}
function addMedia(props, at) {
  const pos = placeNear(props.width, props.height, at);
  const o = doc.migrate({ id: uid(), x: pos.x, y: pos.y, rotation: 0, style: {}, ...props });
  doc.add(o);
  selection = new Set([o.id]);
  commit("insert");
  setTool("select");
  redraw(true);
  return o;
}
async function insertImageFile(file, at) {
  try {
    const r = await M.processImageFile(file);
    if (mediaChars() + r.src.length > 9 * 1024 * 1024) { Toast.error("Ảnh tải lên trong sơ đồ đã quá nặng. Hãy dùng liên kết ảnh thay vì tải lên."); return null; }
    const [w, h] = fitSize(r.width, r.height);
    const o = addMedia({ type: "image", src: r.src, width: w, height: h, alt: (file.name || "").replace(/\.[^.]+$/, "").slice(0, 120), lockRatio: true }, at);
    if (r.animated) Toast.show("Đã chèn ảnh động.", "ok", 1600);
    return o;
  } catch (err) { Toast.error(err.message || "Không chèn được ảnh."); return null; }
}
async function insertImageUrl(url, at) {
  if (!/^https:\/\//i.test(url)) { Toast.error("Liên kết ảnh phải bắt đầu bằng https://"); return null; }
  let size;
  try { size = await M.loadImageSize(url); } catch { Toast.error("Không tải được ảnh từ liên kết này (có thể trang chủ chặn hoặc không phải ảnh)."); return null; }
  const [w, h] = fitSize(size.w, size.h);
  return addMedia({ type: "image", src: url, width: w, height: h, lockRatio: true }, at);
}
async function insertParsed(res, at) {
  if (res.kind === "embed") {
    const [w, h] = [res.size.w, res.size.h];
    return addMedia({ type: "embed", embedUrl: res.embedUrl, provider: res.provider, title: res.title || "", width: w, height: h }, at);
  }
  if (res.kind === "video") {
    const s = await M.loadVideoSize(res.src);
    const [w, h] = fitSize(s.w, s.h, 640);
    return addMedia({ type: "video", src: res.src, width: w, height: h, controls: true }, at);
  }
  return insertImageUrl(res.src, at);
}

/* ---- hộp thoại ---- */
function el2(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

function openImageDialog({ target } = {}) {
  const body = el2("div");
  const tabs = el2("div", "dlg-tabs"); tabs.setAttribute("role", "tablist");
  const tUp = el2("button", "dlg-tab", "Tải ảnh lên"); const tLink = el2("button", "dlg-tab", "Dán liên kết ảnh");
  [tUp, tLink].forEach((t) => { t.type = "button"; t.setAttribute("role", "tab"); });
  tabs.append(tUp, tLink);

  const paneUp = el2("div");
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*,.gif,.webp,.avif,.svg"; input.className = "hidden-input"; input.multiple = !target;
  const drop = el2("div", "dropzone"); drop.tabIndex = 0; drop.setAttribute("role", "button");
  drop.innerHTML = ICONS.upload;
  drop.append(el2("strong", "", "Kéo ảnh vào đây hoặc bấm để chọn"), el2("small", "", "PNG, JPG, GIF (ảnh động), WebP, AVIF, SVG — ảnh tĩnh tự nén cho nhẹ"));
  paneUp.append(drop, input);

  const paneLink = el2("div");
  const fld = el2("div", "dlg-field"); const lab = el2("label", "", "Liên kết ảnh hoặc GIF (https)");
  const url = document.createElement("input"); url.className = "input"; url.type = "url"; url.placeholder = "https://…/anh.gif"; url.id = "imgUrl"; lab.htmlFor = "imgUrl";
  fld.append(lab, url);
  const prev = el2("div", "dlg-preview"); const status = el2("div", "dlg-status", "Dán liên kết đến một tệp ảnh. GIF/ảnh động vẫn chuyển động.");
  prev.appendChild(status);
  const go = el2("button", "btn btn-primary", target ? "Đổi ảnh" : "Chèn ảnh"); go.type = "button"; go.disabled = true;
  paneLink.append(fld, prev, el2("div", "modal-actions"));
  paneLink.lastChild.style.marginTop = "14px"; paneLink.lastChild.appendChild(go);
  body.append(tabs, paneUp, paneLink);

  const show = (which) => {
    paneUp.hidden = which !== "up"; paneLink.hidden = which !== "link";
    tUp.setAttribute("aria-selected", String(which === "up")); tLink.setAttribute("aria-selected", String(which === "link"));
    if (which === "link") setTimeout(() => url.focus(), 30);
  };
  tUp.addEventListener("click", () => show("up")); tLink.addEventListener("click", () => show("link"));
  show("up");

  const finish = () => UI.closeModal(null);
  async function handleFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name));
    if (!list.length) { Toast.error("Hãy chọn tệp ảnh."); return; }
    finish();
    if (target) {
      try {
        const r = await M.processImageFile(list[0]);
        target.src = r.src;
        const [w, h] = fitSize(r.width, r.height);
        const k = (target.width || w) / w; target.height = Math.round(h * k);
        commit("image"); view.invalidate(); redraw(true);
      } catch (err) { Toast.error(err.message); }
      return;
    }
    let i = 0;
    for (const f of list) { await insertImageFile(f); i++; }
  }
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => handleFiles(input.files));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

  let probe = 0;
  url.addEventListener("input", async () => {
    const v = url.value.trim(); const my = ++probe;
    go.disabled = true; prev.replaceChildren(status);
    if (!v) { status.className = "dlg-status"; status.textContent = "Dán liên kết đến một tệp ảnh. GIF/ảnh động vẫn chuyển động."; return; }
    if (!/^https:\/\//i.test(v)) { status.className = "dlg-status err"; status.textContent = "Liên kết phải bắt đầu bằng https://"; return; }
    status.className = "dlg-status"; status.textContent = "Đang kiểm tra ảnh…";
    try {
      const s = await M.loadImageSize(v);
      if (my !== probe) return;
      const im = new Image(); im.src = v; im.alt = "";
      status.className = "dlg-status ok"; status.textContent = `Ảnh hợp lệ — ${s.w}×${s.h}px`;
      prev.replaceChildren(im, status); go.disabled = false;
    } catch { if (my === probe) { status.className = "dlg-status err"; status.textContent = "Không tải được ảnh. Hãy kiểm tra liên kết (cần trỏ thẳng tới tệp ảnh)."; } }
  });
  const run = async () => {
    const v = url.value.trim(); if (!v || go.disabled) return;
    finish();
    if (target) { target.src = v; const s = await M.loadImageSize(v).catch(() => null); if (s) { const [w, h] = fitSize(s.w, s.h); target.height = Math.round((target.width || w) * (h / w)); } commit("image"); view.invalidate(); redraw(true); }
    else await insertImageUrl(v);
  };
  go.addEventListener("click", run);
  url.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); run(); } });
  UI.modal({ title: target ? "Đổi ảnh" : "Chèn ảnh / GIF", body, wide: false, actions: [{ label: "Hủy", class: "btn-secondary", value: "cancel" }] });
}

function openMediaDialog({ mode, target } = {}) {
  const isVideo = mode === "video";
  const body = el2("div");
  const f = el2("div", "dlg-field");
  const lab = el2("label", "", isVideo ? "Liên kết video hoặc mã nhúng" : "Mã nhúng (<iframe …>) hoặc liên kết");
  const ta = document.createElement("textarea"); ta.className = "input"; ta.id = "mediaIn"; lab.htmlFor = "mediaIn"; ta.spellcheck = false; ta.rows = 4;
  ta.placeholder = isVideo ? "https://www.youtube.com/watch?v=…   hoặc   https://…/video.mp4" : '<iframe src="https://www.youtube.com/embed/…"></iframe>   hoặc dán thẳng liên kết YouTube, Canva, Vimeo…';
  if (target) ta.value = target.type === "video" ? target.src : target.embedUrl;
  f.append(lab, ta);
  const prev = el2("div", "dlg-preview"); const status = el2("div", "dlg-status", "Dán mã nhúng hoặc liên kết để Diagram tự nhận diện trình phát.");
  prev.appendChild(status);
  const chips = el2("div", "dlg-chips");
  ["YouTube", "Canva", "Vimeo", "Google Slides", "Figma", "Spotify", "Loom", "TikTok", isVideo ? "MP4 / WebM" : "Mã <iframe> bất kỳ"].forEach((n) => chips.appendChild(el2("span", "", n)));
  const acts = el2("div", "modal-actions"); acts.style.marginTop = "14px";
  const go = el2("button", "btn btn-primary", target ? "Cập nhật" : "Chèn vào sơ đồ"); go.type = "button"; go.disabled = true;
  acts.appendChild(go);
  body.append(f, prev, chips, acts);
  let parsed = null;
  const check = () => {
    const v = ta.value.trim(); parsed = null; go.disabled = true;
    if (!v) { status.className = "dlg-status"; status.textContent = "Dán mã nhúng hoặc liên kết để Diagram tự nhận diện trình phát."; return; }
    const r = M.parseMediaInput(v, embedHosts, { hostname: location.hostname });
    if (!r.ok) { status.className = "dlg-status err"; status.textContent = r.error; return; }
    if (target && ((target.type === "embed" && r.kind !== "embed") || (target.type === "video" && r.kind === "image"))) { status.className = "dlg-status err"; status.textContent = "Loại nội dung không khớp với phần tử đang chọn."; return; }
    parsed = r; go.disabled = false; status.className = "dlg-status ok";
    status.textContent = r.kind === "embed" ? `Đã nhận diện: ${r.provider} — khung ${r.size.w}×${r.size.h}` : r.kind === "video" ? "Đã nhận diện: tệp video" : "Đây là ảnh — sẽ chèn như một hình ảnh";
  };
  ta.addEventListener("input", check);
  ta.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
  const run = async () => {
    if (!parsed) return;
    UI.closeModal(null);
    if (target) {
      if (parsed.kind === "embed") { target.embedUrl = parsed.embedUrl; target.provider = parsed.provider; if (parsed.title) target.title = parsed.title; }
      else if (parsed.kind === "video") target.src = parsed.src;
      commit("media"); redraw(true);
    } else await insertParsed(parsed);
  };
  go.addEventListener("click", run);
  UI.modal({ title: target ? "Đổi liên kết" : isVideo ? "Chèn video" : "Chèn nội dung nhúng", body, actions: [{ label: "Hủy", class: "btn-secondary", value: "cancel" }] });
  setTimeout(() => { ta.focus(); if (target) check(); }, 30);
}

/* ---- dán / thả ---- */
document.addEventListener("paste", async (e) => {
  if (presenting || e.target.closest?.("input, textarea, select")) return;
  const cd = e.clipboardData; if (!cd) return;
  const files = [...(cd.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); for (const f of files) await insertImageFile(f); return; }
  const text = cd.getData("text/plain");
  if (text && (/<iframe[\s>]/i.test(text) || /^\s*https?:\/\/\S+\s*$/i.test(text))) {
    const r = M.parseMediaInput(text, embedHosts, { hostname: location.hostname });
    if (r.ok && (r.kind !== "image" || /\.(gif|png|jpe?g|webp|avif|svg)(\?|$)/i.test(text))) {
      e.preventDefault(); await insertParsed(r); Toast.show("Đã chèn từ nội dung vừa dán (Ctrl+Z để hoàn tác).", "ok", 2400); return;
    }
    if (!r.ok && /<iframe/i.test(text)) { e.preventDefault(); Toast.error(r.error); return; }
  }
  if (clipboard) { e.preventDefault(); pasteInternal(); }
});
host.addEventListener("dragover", (e) => { if (presenting) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
host.addEventListener("drop", async (e) => {
  if (presenting) return;
  e.preventDefault();
  const at = eventWorld(e);
  const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name));
  if (files.length) { for (const f of files) await insertImageFile(f, at); return; }
  const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
  if (text) { const r = M.parseMediaInput(text.split("\n")[0], embedHosts, { hostname: location.hostname }); if (r.ok) await insertParsed(r, at); else Toast.error(r.error); }
});

/* ============ hộp phím tắt ============ */

function showShortcuts() {
  const rows = [
    ["V / H", "Chọn / kéo canvas (hoặc giữ Space)"], ["R, O, D", "Chữ nhật, ellipse, hình thoi"], ["L, A, C", "Đường thẳng, mũi tên, đường nối"],
    ["T, N, F", "Văn bản, ghi chú, khung"], ["I, E", "Chèn ảnh, chèn nhúng"], ["Ctrl+Z / Ctrl+Shift+Z", "Hoàn tác / làm lại"],
    ["Ctrl+C, X, V, D", "Sao chép, cắt, dán, nhân bản"], ["Ctrl+G / Ctrl+Shift+G", "Nhóm / bỏ nhóm"], ["Ctrl+] / Ctrl+[", "Lên / xuống một lớp"],
    ["Mũi tên", "Dịch chuyển (Shift = 1px)"], ["Shift khi kéo", "Giữ tỉ lệ / góc 45°"], ["Alt khi kéo", "Tắt bắt dính / nhân bản khi di chuyển"],
    ["+ / − / Shift+1", "Phóng to / thu nhỏ / vừa khung"], ["P", "Trình chiếu toàn màn hình"], ["Nhấp đúp", "Sửa chữ · bấm vào video/nhúng · đổi ảnh"],
  ];
  const t = el2("div"); t.style.cssText = "display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;font-size:13.5px;";
  for (const [k, d] of rows) { const kk = el2("kbd", "", k); kk.style.cssText = "font:600 12px var(--mono);background:var(--bg-soft);border:1px solid var(--border);border-radius:6px;padding:2px 8px;white-space:nowrap;"; t.append(kk, el2("span", "", d)); }
  UI.modal({ title: "Phím tắt", body: t, wide: true, actions: [{ label: "Đóng", class: "btn-primary", value: "close" }] });
}

/* ============ bảng thuộc tính ============ */

const panel = $("stylePanel");
let syncers = [];

function sec(title) { const s = el2("div", "sp-sec"); if (title) s.appendChild(el2("div", "sp-title", title)); return s; }
function row(label, ...ctl) {
  const r = el2("div", "sp-row"); r.appendChild(el2("label", "", label));
  const c = el2("div", "sp-ctl"); c.append(...ctl); r.appendChild(c); return r;
}
function numField({ get, set, min = -1e6, max = 1e6, step = 1, unit = "", dec = 0, label }) {
  const wrap = el2("div", "sp-unit");
  if (unit) wrap.appendChild(el2("span", "", unit));
  const inp = document.createElement("input");
  inp.type = "number"; inp.className = "sp-input"; inp.step = String(step); inp.min = String(min); inp.max = String(max);
  if (label) inp.setAttribute("aria-label", label);
  if (!unit) inp.style.paddingLeft = "9px";
  inp.addEventListener("input", () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) set(clamp(v, min, max)); });
  inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); });
  inp.addEventListener("blur", () => sync());
  const sync = () => { if (document.activeElement !== inp) { const v = get(); inp.value = v == null ? "" : String(round(v, dec)); } };
  syncers.push(sync); sync();
  wrap.appendChild(inp);
  return wrap;
}
function segField(options, get, set, { multi = false } = {}) {
  const g = el2("div", "seg"); g.setAttribute("role", "group");
  const btns = options.map((o) => {
    const b = document.createElement("button"); b.type = "button";
    if (o.icon) b.innerHTML = o.icon; else b.textContent = o.label;
    b.title = o.title || o.label || ""; b.setAttribute("aria-label", o.title || o.label || "");
    b.addEventListener("click", () => set(o.v, get()));
    g.appendChild(b); return [b, o];
  });
  const sync = () => { const cur = get(); for (const [b, o] of btns) b.setAttribute("aria-pressed", String(multi ? !!o.on?.(cur) : cur === o.v)); };
  syncers.push(sync); sync();
  return g;
}
function checkField(label, get, set) {
  const l = el2("label", "sp-check"); const c = document.createElement("input"); c.type = "checkbox";
  c.addEventListener("change", () => set(c.checked));
  l.append(c, document.createTextNode(label));
  const sync = () => { c.checked = !!get(); };
  syncers.push(sync); sync(); return l;
}
function colorField(label, get, set, { allowNone = true } = {}) {
  const f = CP.field({ value: get(), allowNone, label, getDocColors: docColors, onChange: (v) => set(v) });
  syncers.push(() => f.setValue(get()));
  return f;
}
function btnField(icon, label, fn, cls = "") {
  const b = document.createElement("button"); b.type = "button"; b.className = "sp-btn " + cls; b.innerHTML = icon;
  b.appendChild(document.createTextNode(label)); b.addEventListener("click", fn); return b;
}
/** "auto" (màu chữ theo giao diện) → màu thực đang hiển thị, để ô màu hiện đúng. */
const resolveInk = (v) => (v === "auto" ? (getComputedStyle(document.documentElement).getPropertyValue("--canvas-ink").trim() || "#1f2430") : v);
const first = (pred) => selLeaves().find(pred);
const sv = (pred, key, dflt) => { const o = first(pred); return o && o.style && o.style[key] !== undefined ? o.style[key] : dflt; };

function buildPanel() {
  panel.replaceChildren(); syncers = [];
  const roots = selRoots();
  if (!roots.length) {
    const d = el2("div", "panel-empty");
    d.append(el2("b", "", "Chưa chọn phần tử nào"), document.createTextNode("Bấm vào một hình để chỉnh màu, chữ, kích thước. Kéo trên vùng trống để chọn nhiều phần tử."));
    panel.appendChild(d);
    const s = sec("Mẹo");
    for (const t of ["Nhấp đúp vào hình để gõ chữ.", "Kéo từ chấm xanh quanh hình để nối sang hình khác.", "Dán liên kết YouTube/Canva (Ctrl+V) để chèn trình phát.", "Giữ Space rồi kéo để di chuyển khung vẽ."]) s.appendChild(el2("p", "sp-note", "• " + t));
    panel.appendChild(s);
    const cnt = el2("p", "sp-note", "");
    const upd = () => { cnt.textContent = `Sơ đồ có ${doc.elements.filter((o) => o.type !== "group").length} phần tử.`; };
    syncers.push(upd); upd();
    panel.appendChild(cnt);
    return;
  }
  const leaves = selLeaves();
  const single = roots.length === 1 ? roots[0] : null;
  const head = el2("div", "sp-head");
  const ico = el2("div", "sp-ico"); ico.innerHTML = single ? iconFor(single.type) : ICONS.layers;
  const ht = el2("div"); const h3 = el2("h3", "", single ? typeLabel(single.type) : `${roots.length} phần tử`);
  const sm = el2("small", "", single ? (single.type === "group" ? `${(single.children || []).length} phần tử trong nhóm` : (single.provider || "")) : "Chỉnh chung cho tất cả"); h3.appendChild(sm); ht.appendChild(h3);
  head.append(ico, ht); panel.appendChild(head);

  const has = {
    fill: leaves.some(isFillable), line: leaves.some((o) => isPointType(o.type)), text: leaves.some(isTexty),
    media: leaves.some((o) => MEDIA_TYPES.has(o.type)), round: leaves.some((o) => ["rectangle", "rounded-rectangle", "note", "frame", "video", "embed"].includes(o.type)),
  };

  /* --- Phương tiện --- */
  if (single && MEDIA_TYPES.has(single.type)) {
    const s = sec("Nội dung");
    if (single.type === "embed") {
      const url = document.createElement("input"); url.className = "sp-input"; url.readOnly = true; url.value = single.embedUrl || ""; url.setAttribute("aria-label", "Liên kết nhúng"); url.title = single.embedUrl || "";
      const col = el2("div", "sp-col"); col.appendChild(url);
      const bs = el2("div", "sp-btns");
      bs.append(btnField(ICONS.interact, "Bấm vào trình phát", () => { view.media.setInteractive(view.media.interactiveId === single.id ? null : single.id); }),
        btnField(ICONS.link, "Đổi liên kết", () => openMediaDialog({ mode: "embed", target: single })));
      s.append(col, bs, el2("p", "sp-note", "Kéo để di chuyển, dùng tay nắm để đổi cỡ và xoay. Nhấp đúp để bấm vào trình phát; Esc để thoát."));
    } else if (single.type === "video") {
      const bs = el2("div", "sp-btns"); bs.appendChild(btnField(ICONS.link, "Đổi liên kết", () => openMediaDialog({ mode: "video", target: single })));
      s.append(bs, el2("div", "sp-col"));
      for (const [k, lab] of [["controls", "Hiện nút điều khiển"], ["loop", "Lặp lại"], ["muted", "Tắt tiếng"], ["autoplay", "Tự phát khi xem (tắt tiếng)"]]) {
        s.appendChild(checkField(lab, () => (k === "controls" ? single.controls !== false : !!single[k]), (v) => { single[k] = v; commit("media", "media:" + k); redraw(); }));
      }
    } else {
      const col = el2("div", "sp-col"); col.appendChild(el2("label", "", "Mô tả ảnh (cho người dùng đọc màn hình)"));
      const alt = document.createElement("input"); alt.className = "sp-input"; alt.maxLength = 300; alt.value = single.alt || "";
      alt.addEventListener("input", () => { single.alt = alt.value; commit("alt", "alt"); });
      alt.addEventListener("keydown", (e) => e.stopPropagation());
      col.appendChild(alt);
      const bs = el2("div", "sp-btns"); bs.appendChild(btnField(ICONS.image, "Đổi ảnh", () => openImageDialog({ target: single })));
      s.append(col, checkField("Giữ tỉ lệ khi đổi cỡ", () => single.lockRatio !== false, (v) => { single.lockRatio = v; commit("lock", "lock"); redraw(true); }), bs);
    }
    panel.appendChild(s);
  }

  /* --- Hình dạng --- */
  if (has.fill) {
    const s = sec("Hình dạng");
    s.appendChild(row("Màu nền", colorField("Màu nền", () => sv(isFillable, "fill", "none"), (v) => applyStyle({ fill: v }, "fill", isFillable))));
    s.appendChild(row("Viền", colorField("Màu viền", () => sv(isFillable, "stroke", "none"), (v) => applyStyle({ stroke: v }, "stroke", isFillable))));
    s.appendChild(row("Độ dày", numField({ get: () => sv(isFillable, "strokeWidth", 2), set: (v) => applyStyle({ strokeWidth: v }, "sw", isFillable), min: 0, max: 24, step: 0.5, dec: 1, label: "Độ dày viền" })));
    s.appendChild(row("Kiểu viền", segField([{ v: "solid", label: "Liền" }, { v: "dashed", label: "Gạch" }, { v: "dotted", label: "Chấm" }], () => sv(isFillable, "lineType", "solid"), (v) => applyStyle({ lineType: v }, "lt", isFillable))));
    if (has.round) s.appendChild(row("Bo góc", numField({ get: () => sv((o) => ["rectangle", "rounded-rectangle", "note", "frame", "video", "embed"].includes(o.type), "radius", 0), set: (v) => applyStyle({ radius: v }, "radius", (o) => ["rectangle", "rounded-rectangle", "note", "frame"].includes(o.type)), min: 0, max: 200, label: "Bo góc" })));
    panel.appendChild(s);
  }
  if (has.media && !has.fill) {
    const s = sec("Khung");
    if (leaves.some((o) => o.type === "video" || o.type === "embed")) s.appendChild(row("Bo góc", numField({ get: () => sv((o) => o.type === "video" || o.type === "embed", "radius", 0), set: (v) => applyStyle({ radius: v }, "radius", (o) => o.type === "video" || o.type === "embed"), min: 0, max: 80, label: "Bo góc" })));
    panel.appendChild(s);
  }

  /* --- Đường --- */
  if (has.line) {
    const isL = (o) => isPointType(o.type);
    const s = sec("Đường");
    s.appendChild(row("Màu", colorField("Màu đường", () => sv(isL, "stroke", "#475569"), (v) => applyStyle({ stroke: v }, "lstroke", isL), { allowNone: false })));
    s.appendChild(row("Độ dày", numField({ get: () => sv(isL, "strokeWidth", 2), set: (v) => applyStyle({ strokeWidth: v }, "lsw", isL), min: 0.5, max: 24, step: 0.5, dec: 1, label: "Độ dày đường" })));
    s.appendChild(row("Kiểu nét", segField([{ v: "solid", label: "Liền" }, { v: "dashed", label: "Gạch" }, { v: "dotted", label: "Chấm" }], () => sv(isL, "lineType", "solid"), (v) => applyStyle({ lineType: v }, "llt", isL))));
    s.appendChild(row("Đường đi", segField([{ v: "straight", icon: ICONS.straight, title: "Thẳng" }, { v: "elbow", icon: ICONS.elbow, title: "Gấp khúc" }, { v: "curve", icon: ICONS.curve, title: "Cong" }],
      () => sv(isL, "route", "straight"), (v) => applyStyle({ route: v }, "route", isL))));
    const heads = [{ v: "none", label: "Không" }, { v: "arrow", label: "Mở" }, { v: "triangle", label: "Đặc" }];
    s.appendChild(row("Đầu", segField(heads, () => sv(isL, "arrowStart", "none"), (v) => applyStyle({ arrowStart: v }, "as", isL))));
    s.appendChild(row("Cuối", segField(heads, () => sv(isL, "arrowEnd", "none"), (v) => applyStyle({ arrowEnd: v }, "ae", isL))));
    panel.appendChild(s);
  }

  /* --- Chữ --- */
  if (has.text) {
    const s = sec("Chữ");
    if (single && isTexty(single)) {
      const ta = document.createElement("textarea"); ta.className = "sp-textarea"; ta.value = single.text || ""; ta.setAttribute("aria-label", "Nội dung chữ"); ta.placeholder = "Nội dung…";
      ta.addEventListener("input", () => { single.text = ta.value; if (single.type === "text") fitText(single); commit("text", "text"); redraw(); });
      ta.addEventListener("keydown", (e) => e.stopPropagation());
      syncers.push(() => { if (document.activeElement !== ta) ta.value = single.text || ""; });
      const col = el2("div", "sp-col"); col.appendChild(ta); s.appendChild(col);
    }
    s.appendChild(row("Phông", segField([{ v: "sans", label: "Sans" }, { v: "serif", label: "Serif" }, { v: "mono", label: "Mono" }], () => sv(isTexty, "fontFamily", "sans"), (v) => applyStyle({ fontFamily: v }, "ff", isTexty))));
    s.appendChild(row("Cỡ chữ", numField({ get: () => sv(isTexty, "fontSize", 15), set: (v) => applyStyle({ fontSize: v }, "fs", isTexty), min: 6, max: 200, label: "Cỡ chữ", unit: "px" })));
    s.appendChild(row("Kiểu", segField([
      { icon: ICONS.bold, title: "Đậm", on: (c) => c.b }, { icon: ICONS.italic, title: "Nghiêng", on: (c) => c.i }, { icon: ICONS.underline, title: "Gạch chân", on: (c) => c.u },
    ], () => ({ b: sv(isTexty, "fontWeight", "") === "bold", i: sv(isTexty, "fontStyle", "") === "italic", u: sv(isTexty, "textDecoration", "") === "underline" }),
    (_v, c) => { /* được xử lý bên dưới */ }, { multi: true })));
    // gắn xử lý riêng cho 3 nút B/I/U (segField gọi set với v === undefined)
    const seg = s.lastChild.querySelector(".seg");
    const [bB, bI, bU] = seg.querySelectorAll("button");
    bB.onclick = () => applyStyle({ fontWeight: sv(isTexty, "fontWeight", "") === "bold" ? "normal" : "bold" }, "fw", isTexty);
    bI.onclick = () => applyStyle({ fontStyle: sv(isTexty, "fontStyle", "") === "italic" ? "normal" : "italic" }, "fi", isTexty);
    bU.onclick = () => applyStyle({ textDecoration: sv(isTexty, "textDecoration", "") === "underline" ? "none" : "underline" }, "fu", isTexty);
    s.appendChild(row("Căn lề", segField([{ v: "left", icon: ICONS.textLeft, title: "Trái" }, { v: "center", icon: ICONS.textCenter, title: "Giữa" }, { v: "right", icon: ICONS.textRight, title: "Phải" }],
      () => sv(isTexty, "textAlign", "center"), (v) => applyStyle({ textAlign: v }, "ta", isTexty))));
    s.appendChild(row("Màu chữ", colorField("Màu chữ", () => resolveInk(sv(isTexty, "textColor", "#1f2430")), (v) => applyStyle({ textColor: v }, "tc", isTexty), { allowNone: false })));
    panel.appendChild(s);
  }

  /* --- Vị trí & kích thước --- */
  if (single && single.type !== "group" && !isPointType(single.type)) {
    const s = sec("Vị trí & kích thước");
    const ratioLocked = () => single.type === "image" && single.lockRatio !== false;
    const g = el2("div"); g.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
    const mkN = (lab, get, set, o = {}) => numField({ get, set, label: lab, unit: lab, dec: 0, ...o });
    g.append(
      mkN("X", () => single.x, (v) => { single.x = v; commit("geo", "geo:x"); redraw(); }),
      mkN("Y", () => single.y, (v) => { single.y = v; commit("geo", "geo:y"); redraw(); }),
      mkN("W", () => single.width, (v) => { const r = single.width / (single.height || 1); single.width = v; if (ratioLocked()) single.height = Math.max(4, v / r); if (single.type === "text") single.type = "text"; commit("geo", "geo:w"); redraw(); }, { min: 4 }),
      mkN("H", () => single.height, (v) => { const r = single.width / (single.height || 1); single.height = v; if (ratioLocked()) single.width = Math.max(4, v * r); commit("geo", "geo:h"); redraw(); }, { min: 4 }),
    );
    if (single.type === "text") { g.children[2].style.display = "none"; g.children[3].style.display = "none"; }
    s.appendChild(g);
    const rr = row("Xoay", numField({ get: () => single.rotation || 0, set: (v) => { single.rotation = v; commit("geo", "geo:r"); redraw(); }, min: -360, max: 360, unit: "°", dec: 1, label: "Góc xoay" }));
    rr.style.marginTop = "8px"; rr.querySelector(".sp-ctl").appendChild(btnField(ICONS.reset, "0°", () => resetRotation()));
    s.appendChild(rr);
    panel.appendChild(s);
  }

  /* --- Hiển thị --- */
  const sA = sec("Hiển thị");
  sA.appendChild(row("Độ mờ", (() => {
    const w = el2("div", "sp-ctl"); w.style.cssText = "display:flex;gap:8px;align-items:center;flex:1;";
    const r = document.createElement("input"); r.type = "range"; r.min = "5"; r.max = "100"; r.className = "sp-range"; r.setAttribute("aria-label", "Độ mờ");
    const v = el2("span", "sp-val", "");
    r.addEventListener("input", () => { applyStyle({ opacity: +r.value >= 100 ? undefined : +r.value / 100 }, "op"); v.textContent = r.value + "%"; });
    const sync = () => { const o = sv(() => true, "opacity", 1); r.value = String(Math.round(o * 100)); v.textContent = r.value + "%"; };
    syncers.push(sync); sync(); w.append(r, v); return w;
  })()));
  if (leaves.some((o) => !isPointType(o.type) && o.type !== "text")) sA.appendChild(checkField("Đổ bóng", () => sv((o) => !isPointType(o.type), "shadow", false), (v) => applyStyle({ shadow: v ? true : undefined }, "shadow", (o) => !isPointType(o.type))));
  panel.appendChild(sA);

  /* --- Sắp xếp --- */
  const sB = sec("Sắp xếp");
  const bs = el2("div", "sp-btns");
  bs.append(btnField(ICONS.front, "Lên đầu", () => reorder("front")), btnField(ICONS.forward, "Lên 1", () => reorder("forward")), btnField(ICONS.backward, "Xuống 1", () => reorder("backward")), btnField(ICONS.back, "Xuống cuối", () => reorder("back")));
  sB.appendChild(bs);
  const bs2 = el2("div", "sp-btns"); bs2.style.marginTop = "6px";
  bs2.append(btnField(ICONS.duplicate, "Nhân bản", () => duplicateSelection()), btnField(ICONS.trash, "Xóa", () => deleteSelection(), ""));
  if (roots.length > 1) bs2.prepend(btnField(ICONS.group, "Nhóm", () => groupSelection()));
  if (roots.some((r) => r.type === "group")) bs2.prepend(btnField(ICONS.ungroup, "Bỏ nhóm", () => ungroupSelection()));
  sB.appendChild(bs2);
  panel.appendChild(sB);
}
function syncPanel() {
  const sig = [...selection].join(",") + "|" + selLeaves().map((o) => o.type + (o.lockRatio === false ? "u" : "") ).join(",") + "|" + (view.media?.interactiveId || "");
  if (sig !== panelSig) {
    if (CP.isOpen() && panelSig) return;                  // đang chọn màu: không dựng lại panel
    panelSig = sig; buildPanel(); return;
  }
  for (const f of syncers) f();
}

/* ============ ribbon kiểu PowerPoint ============ */

const ribbonTabs = $("ribbonTabs"), ribbonBody = $("ribbonBody");
let refreshers = [];
let activeTab = (() => { try { return localStorage.getItem("diagram-ribbon-tab") || "home"; } catch { return "home"; } })();

function rbBtn({ icon, label, tip, onClick, kind = "big", pressed, disabled }) {
  const b = document.createElement("button"); b.type = "button";
  b.className = "rb-btn" + (kind === "sm" ? " sm" : kind === "wide" ? " wide" : "");
  b.innerHTML = icon;
  if (kind !== "sm" && label) b.appendChild(el2("span", "", label));
  b.setAttribute("aria-label", tip || label || ""); b.title = tip || label || "";
  b.addEventListener("click", (e) => onClick(e, b));
  if (pressed) refreshers.push(() => b.setAttribute("aria-pressed", String(!!pressed())));
  if (disabled) refreshers.push(() => { b.disabled = !!disabled(); });
  return b;
}
function rbGroup(label, items, wrap = false) {
  const g = el2("div", "rb-group"); const it = el2("div", "rb-items" + (wrap ? " wrap" : "")); it.append(...items);
  g.append(it, el2("div", "rb-label", label)); return g;
}
function toolBtn(id, icon, label, kind = "big", tip) {
  const b = rbBtn({ icon, label, kind, tip: tip || label, onClick: (e) => setTool(tool === id && id !== "select" ? "select" : id, e.shiftKey), pressed: () => tool === id });
  b.addEventListener("dblclick", () => setTool(id, true));
  return b;
}
const hasSel = () => selection.size > 0;
const multiSel = () => selection.size > 1;
const hasLeaves = () => selection.size > 0;

function shapeThumb(type) {
  const w = 24, h = 18, x = 3, y = 6;
  let inner;
  if (type === "rectangle") inner = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5"/>`;
  else if (type === "rounded-rectangle") inner = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`;
  else if (type === "ellipse") inner = `<ellipse cx="15" cy="15" rx="12" ry="9"/>`;
  else inner = `<path d="${SHAPES[type]?.path ? SHAPES[type].path(x, y - 1, w, h + 2) : ""}"/>`;
  return `<svg viewBox="0 0 30 30" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
let openMenu = null;
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener("pointerdown", onMenuOutside, true); } }
function onMenuOutside(e) { if (openMenu && !openMenu.contains(e.target) && !e.target.closest?.("[data-gallery]")) closeMenu(); }
function openShapeGallery(anchor) {
  if (openMenu) { closeMenu(); return; }
  const m = el2("div", "pop-menu"); m.setAttribute("role", "menu");
  for (const grp of SHAPE_GROUPS) {
    m.appendChild(el2("div", "pop-title", grp.label));
    const grid = el2("div", "shape-grid");
    for (const [type, def] of Object.entries(SHAPES)) {
      if (def.group !== grp.id) continue;
      const b = document.createElement("button"); b.type = "button"; b.className = "shape-item"; b.title = def.label; b.setAttribute("aria-label", def.label); b.innerHTML = shapeThumb(type);
      b.addEventListener("click", (e) => { closeMenu(); setTool(type, e.shiftKey); });
      grid.appendChild(b);
    }
    m.appendChild(grid);
  }
  document.body.appendChild(m); openMenu = m;
  const r = anchor.getBoundingClientRect();
  m.style.left = clamp(r.left, 8, window.innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 8) + "px";
  document.addEventListener("pointerdown", onMenuOutside, true);
}

const QUICK_SHAPES = ["rectangle", "rounded-rectangle", "ellipse", "diamond", "triangle", "hexagon", "star", "cylinder"];
const TABS = [
  { id: "home", label: "Trang chủ", build: () => [
    rbGroup("Bảng nhớ tạm", [
      rbBtn({ icon: ICONS.paste, label: "Dán", tip: "Dán (Ctrl+V)", onClick: () => { if (!pasteInternal()) Toast.show("Chưa có gì để dán. Hãy sao chép một phần tử trước.", "info", 2200); } }),
      el2("div", "rb-items wrap", ""),
    ]),
    rbGroup("Công cụ", [toolBtn("select", ICONS.select, "Chọn", "big", "Chọn (V)"), toolBtn("hand", ICONS.hand, "Kéo khung", "big", "Kéo khung vẽ (H hoặc giữ Space)")]),
    rbGroup("Vẽ nhanh", [
      toolBtn("rectangle", ICONS.rect, "", "sm", "Chữ nhật (R)"), toolBtn("ellipse", ICONS.circle, "", "sm", "Ellipse (O)"), toolBtn("diamond", ICONS.diamond, "", "sm", "Hình thoi (D)"),
      toolBtn("arrow", ICONS.arrow, "", "sm", "Mũi tên (A)"), toolBtn("text", ICONS.text, "", "sm", "Văn bản (T)"),
    ], true),
    rbGroup("Chỉnh sửa", [
      rbBtn({ icon: ICONS.duplicate, label: "Nhân bản", tip: "Nhân bản (Ctrl+D)", onClick: () => duplicateSelection(), disabled: () => !hasSel() }),
      rbBtn({ icon: ICONS.trash, label: "Xóa", tip: "Xóa (Delete)", onClick: () => deleteSelection(), disabled: () => !hasSel() }),
    ]),
  ].map((g, i) => {
    if (i === 0) {
      const box = g.querySelector(".rb-items.wrap");
      box.append(
        rbBtn({ icon: ICONS.copy, label: "Sao chép", tip: "Sao chép (Ctrl+C)", kind: "wide", onClick: () => copySelection(), disabled: () => !hasSel() }),
        rbBtn({ icon: ICONS.edit, label: "Cắt", tip: "Cắt (Ctrl+X)", kind: "wide", onClick: () => cutSelection(), disabled: () => !hasSel() }),
      );
    }
    return g;
  }) },
  { id: "insert", label: "Chèn", build: () => [
    rbGroup("Hình khối", [
      (() => { const w = el2("div", "rb-items wrap"); w.style.maxWidth = "176px"; for (const t of QUICK_SHAPES) w.appendChild(toolBtn(t, shapeThumb(t), "", "sm", SHAPES[t].label)); return w; })(),
      (() => { const b = rbBtn({ icon: ICONS.shapes, label: "Tất cả hình", tip: "Mở thư viện hình khối", onClick: (e, btn) => openShapeGallery(btn) }); b.dataset.gallery = "1"; const c = el2("span", "caret"); c.innerHTML = ICONS.chevronDown; b.appendChild(c); return b; })(),
    ]),
    rbGroup("Đường & nối", [
      toolBtn("line", ICONS.line, "Đường", "big", "Đường thẳng (L)"), toolBtn("arrow", ICONS.arrow, "Mũi tên", "big", "Mũi tên (A)"),
      toolBtn("conn-elbow", ICONS.elbow, "Gấp khúc", "big", "Đường nối gấp khúc (C) — tự bám vào hình"),
      toolBtn("conn-curve", ICONS.curve, "Cong", "big", "Đường nối cong"), toolBtn("conn-straight", ICONS.straight, "Nối thẳng", "big", "Đường nối thẳng"),
    ]),
    rbGroup("Văn bản", [toolBtn("text", ICONS.text, "Chữ", "big", "Hộp văn bản (T)"), toolBtn("note", ICONS.note, "Ghi chú", "big", "Ghi chú dán (N)"), toolBtn("frame", ICONS.frame, "Khung", "big", "Khung nhóm (F)")]),
    rbGroup("Phương tiện", [
      rbBtn({ icon: ICONS.image, label: "Ảnh / GIF", tip: "Chèn ảnh hoặc GIF (I)", onClick: () => openImageDialog() }),
      rbBtn({ icon: ICONS.video, label: "Video", tip: "Chèn video (liên kết YouTube, MP4…)", onClick: () => openMediaDialog({ mode: "video" }) }),
      rbBtn({ icon: ICONS.embed, label: "Nhúng", tip: "Nhúng bằng mã <iframe> hoặc liên kết (E)", onClick: () => openMediaDialog({ mode: "embed" }) }),
    ]),
  ] },
  { id: "arrange", label: "Sắp xếp", build: () => [
    rbGroup("Thứ tự lớp", [
      rbBtn({ icon: ICONS.front, label: "Lên đầu", onClick: () => reorder("front"), disabled: () => !hasSel() }), rbBtn({ icon: ICONS.forward, label: "Lên một lớp", tip: "Lên một lớp (Ctrl+])", onClick: () => reorder("forward"), disabled: () => !hasSel() }),
      rbBtn({ icon: ICONS.backward, label: "Xuống một lớp", tip: "Xuống một lớp (Ctrl+[)", onClick: () => reorder("backward"), disabled: () => !hasSel() }), rbBtn({ icon: ICONS.back, label: "Xuống cuối", onClick: () => reorder("back"), disabled: () => !hasSel() }),
    ]),
    rbGroup("Nhóm", [
      rbBtn({ icon: ICONS.group, label: "Nhóm", tip: "Nhóm (Ctrl+G)", onClick: () => groupSelection(), disabled: () => !multiSel() }),
      rbBtn({ icon: ICONS.ungroup, label: "Bỏ nhóm", tip: "Bỏ nhóm (Ctrl+Shift+G)", onClick: () => ungroupSelection(), disabled: () => !selRoots().some((r) => r.type === "group") }),
    ]),
    rbGroup("Căn chỉnh (chọn 2+)", [
      ...[["left", ICONS.alignLeft, "Căn trái"], ["centerH", ICONS.alignCenterH, "Căn giữa ngang"], ["right", ICONS.alignRight, "Căn phải"], ["top", ICONS.alignTop, "Căn trên"], ["middle", ICONS.alignMiddle, "Căn giữa dọc"], ["bottom", ICONS.alignBottom, "Căn dưới"]]
        .map(([k, ic, tip]) => rbBtn({ icon: ic, tip, kind: "sm", onClick: () => alignSelection(k), disabled: () => !multiSel() })),
      rbBtn({ icon: ICONS.distH, tip: "Chia đều ngang (chọn 3+)", kind: "sm", onClick: () => distributeSelection("h"), disabled: () => selection.size < 3 }),
      rbBtn({ icon: ICONS.distV, tip: "Chia đều dọc (chọn 3+)", kind: "sm", onClick: () => distributeSelection("v"), disabled: () => selection.size < 3 }),
    ], true),
    rbGroup("Xoay", [
      rbBtn({ icon: ICONS.rotateLeft, label: "Xoay trái 90°", onClick: () => rotateBy(-90), disabled: () => !hasLeaves() }),
      rbBtn({ icon: ICONS.rotateRight, label: "Xoay phải 90°", onClick: () => rotateBy(90), disabled: () => !hasLeaves() }),
      rbBtn({ icon: ICONS.reset, label: "Về 0°", onClick: () => resetRotation(), disabled: () => !hasLeaves() }),
    ]),
  ] },
  { id: "view", label: "Xem", build: () => [
    rbGroup("Hiển thị", [
      rbBtn({ icon: ICONS.grid, label: "Lưới", tip: "Hiện/ẩn lưới chấm", onClick: () => { savePrefs({ gridVisible: view.toggleGrid() }); }, pressed: () => view.gridVisible }),
      rbBtn({ icon: ICONS.magnet, label: "Bắt dính", tip: "Bắt dính vào lưới khi kéo", onClick: () => { savePrefs({ snapEnabled: view.toggleSnap() }); refreshRibbon(); }, pressed: () => view.snapEnabled }),
    ]),
    rbGroup("Thu phóng", [
      rbBtn({ icon: ICONS.zoomIn, label: "Phóng to", onClick: () => view.zoomIn() }), rbBtn({ icon: ICONS.zoomOut, label: "Thu nhỏ", onClick: () => view.zoomOut() }),
      rbBtn({ icon: ICONS.fit, label: "Vừa khung", tip: "Xem toàn bộ sơ đồ (Shift+1)", onClick: () => view.fit() }), rbBtn({ icon: ICONS.reset, label: "100%", onClick: () => view.resetZoom() }),
    ]),
    rbGroup("Trình chiếu", [rbBtn({ icon: ICONS.present, label: "Trình chiếu", tip: "Xem toàn màn hình (P)", onClick: () => present.toggle() })]),
    rbGroup("Trợ giúp", [rbBtn({ icon: ICONS.help, label: "Phím tắt", onClick: () => showShortcuts() })]),
  ] },
];

function buildRibbon() {
  closeMenu();
  ribbonTabs.replaceChildren();
  for (const t of TABS) {
    const b = document.createElement("button"); b.type = "button"; b.className = "rb-tab"; b.textContent = t.label; b.id = "tab-" + t.id;
    b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(t.id === activeTab));
    b.addEventListener("click", () => { activeTab = t.id; try { localStorage.setItem("diagram-ribbon-tab", t.id); } catch { /* bỏ qua */ } buildRibbon(); });
    ribbonTabs.appendChild(b);
  }
  refreshers = [];
  ribbonBody.replaceChildren(...(TABS.find((t) => t.id === activeTab) || TABS[0]).build());
  refreshRibbon();
}
function refreshRibbon() { for (const f of refreshers) f(); }

/* ============ thanh trên, HUD, menu ngữ cảnh ============ */

$("menuBtn").innerHTML = ICONS.menu;
undoBtn.innerHTML = ICONS.undo; redoBtn.innerHTML = ICONS.redo;
$("presentBtn").innerHTML = ICONS.present + '<span class="lbl">Trình chiếu</span>';
$("presentBtn").title = "Xem toàn màn hình (P)";
$("saveBtn").innerHTML = ICONS.save + '<span class="lbl">Lưu</span>';
$("panelToggle").innerHTML = ICONS.panel;
$("zoomOut").innerHTML = ICONS.zoomOut; $("zoomIn").innerHTML = ICONS.zoomIn; $("fitBtn").innerHTML = ICONS.fit; $("resetZoom").innerHTML = ICONS.reset;
for (const b of [$("presentBtn"), $("saveBtn")]) { b.style.display = "inline-flex"; b.style.alignItems = "center"; b.style.gap = "6px"; }

$("zoomIn").addEventListener("click", () => view.zoomIn());
$("zoomOut").addEventListener("click", () => view.zoomOut());
$("fitBtn").addEventListener("click", () => view.fit());
$("resetZoom").addEventListener("click", () => view.resetZoom());
undoBtn.addEventListener("click", doUndo);
redoBtn.addEventListener("click", doRedo);
$("panelToggle").addEventListener("click", () => $("stylePanel").classList.toggle("open"));
$("presentBtn").addEventListener("click", () => present.toggle());
$("saveBtn").addEventListener("click", () => save());

const nameInput = $("diagramName");
nameInput.value = BOOT.mode === "edit" && BOOT.diagram ? BOOT.diagram.name : "";
nameInput.addEventListener("input", () => { nameDirty = true; updateSaveState(); });
nameInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") nameInput.blur(); });

SideMenu.build({
  user,
  currentPath: BOOT.mode === "edit" ? "/diagrams" : "/create",
  items: [
    { href: "/", label: "Trang chủ", icon: "home" },
    { href: "/create", label: "Tạo sơ đồ", icon: "plus" },
    { href: "/diagrams", label: "Danh sách sơ đồ", icon: "layers" },
    { href: "/settings", label: "Cài đặt", icon: "settings" },
    { href: "/admin", label: "Quản lý trang web", icon: "shield", adminOnly: true },
  ],
});
$("menuBtn").addEventListener("click", () => SideMenu.open());

/* ---- menu chuột phải ---- */
let ctxMenu = null;
function closeCtxMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
host.addEventListener("contextmenu", (e) => {
  if (presenting) return;
  e.preventDefault(); closeCtxMenu(); closeEditor(true);
  const w = eventWorld(e);
  const hit = hitTest(doc, w.x, w.y, 6 / view.zoom);
  if (hit) { const r = doc.rootOf(hit); if (!selection.has(r.id)) { selection = new Set([r.id]); redraw(true); } }
  const m = el2("div", "ctx-menu"); m.setAttribute("role", "menu");
  const item = (label, fn, { kbd, danger, disabled } = {}) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (danger) b.className = "danger"; if (disabled) b.disabled = true;
    if (kbd) b.appendChild(el2("span", "kbd", kbd));
    b.addEventListener("click", () => { closeCtxMenu(); fn(); }); m.appendChild(b);
  };
  const sep = () => m.appendChild(el2("div", "ctx-sep"));
  const some = selection.size > 0;
  if (some) {
    const one = selRoots().length === 1 ? selRoots()[0] : null;
    if (one && (one.type === "embed" || one.type === "video")) item("Bấm vào trình phát", () => view.media.setInteractive(one.id));
    if (one && isTexty(one)) item("Sửa chữ", () => editText(one), { kbd: "Nhấp đúp" });
    item("Sao chép", () => copySelection(), { kbd: "Ctrl+C" }); item("Cắt", () => cutSelection(), { kbd: "Ctrl+X" });
  }
  item("Dán", () => pasteInternal(), { kbd: "Ctrl+V", disabled: !clipboard });
  if (some) {
    item("Nhân bản", () => duplicateSelection(), { kbd: "Ctrl+D" }); sep();
    if (selection.size > 1) item("Nhóm", () => groupSelection(), { kbd: "Ctrl+G" });
    if (selRoots().some((r) => r.type === "group")) item("Bỏ nhóm", () => ungroupSelection(), { kbd: "Ctrl+Shift+G" });
    item("Lên đầu", () => reorder("front")); item("Xuống cuối", () => reorder("back")); sep();
    item("Xóa", () => deleteSelection(), { kbd: "Del", danger: true });
  } else { sep(); item("Chèn ảnh / GIF…", () => openImageDialog()); item("Chèn nhúng…", () => openMediaDialog({ mode: "embed" })); item("Vừa khung hình", () => view.fit()); }
  document.body.appendChild(m); ctxMenu = m;
  m.style.left = Math.min(e.clientX, window.innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 8) + "px";
  setTimeout(() => document.addEventListener("pointerdown", function once(ev) { if (!m.contains(ev.target)) { closeCtxMenu(); } document.removeEventListener("pointerdown", once, true); }, true), 0);
});

/* ============ bàn phím ============ */

window.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (UI.activeModal) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (presenting) { if (k === "p") { e.preventDefault(); present.stop(); } return; }
  if (e.key === " " && !spaceDown) { spaceDown = true; host.style.cursor = "grab"; e.preventDefault(); return; }
  if (e.key === " ") { e.preventDefault(); return; }
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && k === "y") { e.preventDefault(); doRedo(); return; }
  if (mod && k === "s") { e.preventDefault(); save(); return; }
  if (mod && k === "c") { if (selection.size) { e.preventDefault(); copySelection(); } return; }
  if (mod && k === "x") { if (selection.size) { e.preventDefault(); cutSelection(); } return; }
  if (mod && k === "d") { e.preventDefault(); duplicateSelection(); return; }
  if (mod && k === "a") { e.preventDefault(); selection = new Set(doc.elements.filter((o) => !doc.parentOf(o.id)).map((o) => o.id)); redraw(true); return; }
  if (mod && k === "g") { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
  if (mod && e.key === "]") { e.preventDefault(); reorder(e.shiftKey ? "front" : "forward"); return; }
  if (mod && e.key === "[") { e.preventDefault(); reorder(e.shiftKey ? "back" : "backward"); return; }
  if (mod && (e.key === "0")) { e.preventDefault(); view.resetZoom(); return; }
  if (mod) return;
  if (e.key === "Escape") { if (action) cancelAction(); else if (view.media?.interactiveId) view.media.setInteractive(null); else if (tool !== "select") setTool("select"); else if (selection.size) { selection.clear(); redraw(true); } return; }
  if (e.key === "Delete" || e.key === "Backspace") { if (selection.size) { e.preventDefault(); deleteSelection(); } return; }
  if (e.key.startsWith("Arrow") && selection.size) {
    e.preventDefault();
    const d = e.shiftKey ? 1 : GRID;
    const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
    for (const r of selRoots()) moveRoot(r, dx, dy);
    commit("nudge", "nudge"); redraw(); return;
  }
  if (e.key === "+" || e.key === "=") { view.zoomIn(); return; }
  if (e.key === "-" || e.key === "_") { view.zoomOut(); return; }
  if (e.key === "!" || (e.shiftKey && e.key === "1")) { view.fit(); return; }
  const map = { v: "select", h: "hand", r: "rectangle", o: "ellipse", d: "diamond", l: "line", a: "arrow", c: "conn-elbow", t: "text", n: "note", f: "frame" };
  if (map[k]) { setTool(map[k]); return; }
  if (k === "i") { openImageDialog(); return; }
  if (k === "e") { openMediaDialog({ mode: "embed" }); return; }
  if (k === "p") { present.toggle(); return; }
  if (e.key === "?") showShortcuts();
});
window.addEventListener("keyup", (e) => { if (e.key === " ") { spaceDown = false; host.style.cursor = tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair"; } });
window.addEventListener("blur", () => { spaceDown = false; });

/* ============ lưu, chia sẻ ============ */

let saving = false;
const DRAFT_KEY = () => "diagram-draft:" + (diagramId || "new");
let draftTimer = 0;
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!isDirty()) return;
    try { localStorage.setItem(DRAFT_KEY(), JSON.stringify({ t: Date.now(), name: nameInput.value, data: doc.serialize() })); } catch { /* quá dung lượng: bỏ qua */ }
  }, 1500);
}
const prevOnChange = history.onChange;
history.onChange = (kind) => { prevOnChange(kind); scheduleDraft(); };

async function save({ silent = false } = {}) {
  if (saving) return false;
  closeEditor(true);
  const name = nameInput.value.trim() || "Sơ đồ chưa đặt tên";
  if (mediaChars() > 9 * 1024 * 1024) { Toast.error("Ảnh tải lên quá nặng (tối đa ~9MB). Hãy xóa bớt hoặc dùng liên kết ảnh."); return false; }
  saving = true; $("saveBtn").disabled = true;
  const data = doc.serialize();
  const res = diagramId ? await Api.patch(`/api/v1/diagrams/${diagramId}`, { name, data }) : await Api.post("/api/v1/diagrams", { name, data });
  saving = false; $("saveBtn").disabled = false;
  if (!res.success) { Toast.error(res.error?.message || "Không lưu được sơ đồ."); return false; }
  const d = res.data.diagram;
  if (!diagramId && d?.id) { try { localStorage.removeItem(DRAFT_KEY()); } catch { /* bỏ qua */ } diagramId = d.id; window.history.replaceState(null, "", `/edit/${diagramId}`); }
  try { localStorage.removeItem(DRAFT_KEY()); } catch { /* bỏ qua */ }
  nameInput.value = name; nameDirty = false;
  history.markSaved(); updateSaveState();
  if (!silent) Toast.ok("Đã lưu sơ đồ");
  return true;
}

async function shareDialog() {
  if (!diagramId) {
    const ok = await UI.confirm({ title: "Lưu trước khi chia sẻ", message: "Sơ đồ cần được lưu trước khi tạo liên kết chia sẻ. Lưu ngay bây giờ?", okLabel: "Lưu và tiếp tục", danger: false });
    if (!ok || !(await save({ silent: true }))) return;
  } else if (isDirty() && !(await save({ silent: true }))) return;
  const res = await Api.post(`/api/v1/diagrams/${diagramId}/share`);
  if (!res.success) { Toast.error(res.error?.message || "Không tạo được liên kết."); return; }
  const url = `${location.origin}/share/${res.data.share.token}`;
  const body = el2("div"); const r = el2("div", "share-url-row"); const inp = document.createElement("input"); inp.className = "input"; inp.readOnly = true; inp.value = url; inp.setAttribute("aria-label", "Liên kết chia sẻ");
  const cp = el2("button", "btn btn-primary", "Sao chép"); cp.type = "button"; cp.addEventListener("click", async () => { if (await UI.copyText(url)) Toast.ok("Đã sao chép liên kết"); });
  r.append(inp, cp); body.append(el2("p", "sp-note", "Bất kỳ ai có liên kết đều xem được (chỉ xem), có nút Trình chiếu toàn màn hình."), r);
  UI.modal({ title: "Chia sẻ sơ đồ", body, actions: [{ label: "Đóng", class: "btn-secondary", value: "close" }] });
  setTimeout(() => inp.select(), 50);
}

/* ============ trình chiếu ============ */

const present = PR.create({
  container: root, view,
  onEnter: () => { presenting = true; closeEditor(true); selection.clear(); closeMenu(); closeCtxMenu(); redrawNow(); },
  onExit: () => { presenting = false; redrawNow(); },
});
PR.enableMediaTap(view, hitTest, () => doc, () => presenting);

/* ============ khởi tạo ============ */

function init() {
  // Nút Chia sẻ trong thanh trên
  const sh = document.createElement("button"); sh.type = "button"; sh.className = "btn btn-secondary btn-sm"; sh.innerHTML = ICONS.share + '<span class="lbl">Chia sẻ</span>';
  sh.style.cssText = "display:inline-flex;align-items:center;gap:6px;"; sh.addEventListener("click", shareDialog);
  document.querySelector(".topbar-right").prepend(sh);

  buildRibbon();
  const vp = savedData && savedData.viewport;
  if (savedData && savedData.elements && savedData.elements.length) {
    // luôn đưa toàn bộ sơ đồ vào khung nhìn khi mở để tránh mở ra vùng trống
    view.fit(undefined, 90);
    if (vp && Number.isFinite(vp.zoom) && vp.zoom > 0 && (vp.x || vp.y)) { view.panX = vp.x; view.panY = vp.y; view.zoom = vp.zoom; view.applyTransform(); }
  } else {
    const r = host.getBoundingClientRect(); view.panX = r.width / 2; view.panY = r.height / 2; view.applyTransform();
  }
  ready = true;
  redrawNow();
  updateSaveState(); updateHistoryButtons();
  window.addEventListener("resize", () => scheduleOverlay());

  const start = new URLSearchParams(location.search).get("start");
  if (start === "image") openImageDialog(); else if (start === "embed") openMediaDialog({ mode: "embed" }); else if (start === "video") openMediaDialog({ mode: "video" });
  if (start) window.history.replaceState(null, "", location.pathname);
  restoreDraft();
}

async function restoreDraft() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(DRAFT_KEY())); } catch { raw = null; }
  if (!raw || !raw.data || !Array.isArray(raw.data.elements)) return;
  const serverTime = BOOT.diagram?.updatedAt ? Date.parse(BOOT.diagram.updatedAt) : 0;
  const draftJson = JSON.stringify(new DiagramDoc(raw.data).serialize());
  const baseJson = history.states[history.index].data;
  if (draftJson === baseJson || (serverTime && raw.t < serverTime) || (!raw.data.elements.length)) { try { localStorage.removeItem(DRAFT_KEY()); } catch { /* bỏ qua */ } return; }
  const ok = await UI.confirm({ title: "Khôi phục bản nháp?", message: `Tìm thấy bản nháp chưa lưu từ ${new Date(raw.t).toLocaleString("vi-VN")}. Bạn có muốn khôi phục không?`, okLabel: "Khôi phục", cancelLabel: "Bỏ bản nháp", danger: false });
  if (!ok) { try { localStorage.removeItem(DRAFT_KEY()); } catch { /* bỏ qua */ } return; }
  const savedJson = baseJson;
  doc.replaceFrom(raw.data); view.invalidate();
  if (raw.name) { nameInput.value = raw.name; nameDirty = true; }
  history.states = [{ label: "open", key: null, t: 0, data: JSON.stringify(doc.serialize()) }]; history.index = 0; history.savedData = savedJson;
  view.fit(undefined, 90);
  selection.clear(); redraw(true); updateSaveState(); updateHistoryButtons();
}

init();

// Gỡ lỗi / kiểm thử tự động
window.__DIAGRAM_EDITOR__ = { doc, history, view, get selection() { return selection; }, setTool, commit, save, redrawNow, insertParsed, insertImageFile, present, applyStyle };
})();
