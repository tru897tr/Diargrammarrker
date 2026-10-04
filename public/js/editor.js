/* Editor page: tools, selection, editing, save, dirty guard */
"use strict";

(async function () {
  const { Api, Toast, UI, Theme, SideMenu, ICONS, user, BOOT } = window.__DIAGRAM__;
  const {
    DiagramDoc, History, CanvasView, Render, Layout, Geometry, Transform, FontCatalog,
    anchorPoint, nearestSide, updateConnectorPoints,
    el, uid, snap, clamp, normAngle, rotPoint, round2, isLineType, stepFontSize,
    GRID, DEFAULT_STYLES, FONT_SIZE_PRESETS, MIN_FONT, MAX_FONT, TEXT_TYPES,
  } = window.__DIAGRAM_ENGINE__;
  const DEG = Math.PI / 180;

  const isEdit = BOOT.mode === "edit" && BOOT.diagram;
  const diagramId = isEdit ? BOOT.diagram.id : null;
  const savedData = isEdit ? BOOT.diagram.data : null;

  const prefs = (() => {
    try { return JSON.parse(localStorage.getItem("diagram-prefs")) || {}; } catch { return {}; }
  })();
  const confirmDelete = prefs.confirmBeforeDelete !== false;

  const doc = new DiagramDoc(savedData);
  const history = new History(doc, () => markDirty());
  const host = document.getElementById("canvasHost");
  const svg = document.getElementById("svgRoot");
  const view = new CanvasView(host, svg, doc, {
    gridVisible: prefs.gridVisible !== false,
    snapEnabled: prefs.snapEnabled !== false,
    onZoom: (z) => {
      document.getElementById("zoomLabel").textContent = Math.round(z * 100) + "%";
    },
  });

  let tool = "select";
  let selection = new Set();
  let clipboard = null;
  let dirty = false;
  let suppressDirty = false;
  let editingId = null;      // phần tử đang sửa chữ (ẩn chữ SVG để không bị chồng)
  let rotateHud = null;      // nhãn góc xoay khi đang kéo núm xoay

  const selected = () => [...selection].map((id) => doc.byId(id)).filter(Boolean);

  /* ============ dirty tracking + unload guard ============ */

  const saveStateEl = document.getElementById("saveState");
  function markDirty() {
    if (suppressDirty) return;
    dirty = true;
    saveStateEl.textContent = "Thay đổi chưa lưu";
    saveStateEl.classList.add("dirty");
  }
  function markClean() {
    dirty = false;
    saveStateEl.textContent = "";
    saveStateEl.classList.remove("dirty");
  }

  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /** Dialog cảnh báo trước khi rời editor. */
  let leaving = false;
  async function confirmLeave(destination) {
    if (!dirty || leaving) return true;
    const choice = await UI.modal({
      title: "Bạn có thay đổi chưa được lưu.",
      body: "Bạn có muốn lưu trước khi rời khỏi không?",
      actions: [
        { label: "Hủy", class: "btn-secondary", value: "cancel" },
        { label: "Rời khỏi", class: "btn-secondary", value: "leave" },
        { label: "Lưu", class: "btn-primary", value: "save" },
      ],
    });
    if (choice === "save") {
      const ok = await save();
      if (!ok) return false;
      return true;
    }
    if (choice === "leave") {
      dirty = false; // cho phép đi
      return true;
    }
    return false;
  }

  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank") return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (a.closest(".side-menu") && (href === "/" || href.startsWith("/diagrams") || href.startsWith("/settings") || href.startsWith("/admin") || href.startsWith("/create"))) {
      if (!(await confirmLeave(href))) { e.preventDefault(); SideMenu.close(); }
    }
  });

  /* ============ tools ============ */

  const TOOLS = [
    { id: "select", icon: "select", tip: "Chọn (V)" },
    { id: "hand", icon: "hand", tip: "Di chuyển canvas (H)" },
    { sep: true },
    { id: "rectangle", icon: "rect", tip: "Hình chữ nhật (R)" },
    { id: "rounded-rectangle", icon: "roundRect", tip: "Bo góc (Shift+R)" },
    { id: "ellipse", icon: "circle", tip: "Ellipse (O)" },
    { id: "diamond", icon: "diamond", tip: "Diamond (D)" },
    { sep: true },
    { id: "line", icon: "line", tip: "Đường thẳng (L)" },
    { id: "arrow", icon: "arrow", tip: "Mũi tên (A)" },
    { id: "connector", icon: "connector", tip: "Connector nối shape (C)" },
    { sep: true },
    { id: "text", icon: "text", tip: "Text (T)" },
    { id: "note", icon: "note", tip: "Sticky note (N)" },
    { id: "frame", icon: "frame", tip: "Frame (F)" },
    { sep: true },
    { id: "undo", icon: "undo", tip: "Undo (Ctrl+Z)" },
    { id: "redo", icon: "redo", tip: "Redo (Ctrl+Shift+Z)" },
  ];

  const toolRail = document.getElementById("toolRail");
  for (const t of TOOLS) {
    if (t.sep) {
      const s = document.createElement("div");
      s.className = "tool-sep";
      toolRail.appendChild(s);
      continue;
    }
    const b = document.createElement("button");
    b.className = "tool-btn";
    b.dataset.tool = t.id;
    b.dataset.tip = t.tip;
    b.setAttribute("aria-label", t.tip);
    b.setAttribute("aria-pressed", tool === t.id ? "true" : "false");
    b.innerHTML = ICONS[t.icon];
    b.addEventListener("click", () => {
      if (t.id === "undo") { undo(); return; }
      if (t.id === "redo") { redo(); return; }
      setTool(t.id);
    });
    toolRail.appendChild(b);
  }

  function setTool(t) {
    tool = t;
    toolRail.querySelectorAll(".tool-btn[data-tool]").forEach((b) => {
      const active = b.dataset.tool === t;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    host.style.cursor = t === "hand" ? "grab" : t === "select" ? "default" : "crosshair";
  }
  setTool("select");

  function afterHistoryJump() {
    selection = new Set([...selection].filter((id) => doc.byId(id)));
    renderAll();
  }
  function undo() { history.undo(); afterHistoryJump(); }
  function redo() { history.redo(); afterHistoryJump(); }

  /* ============ side menu + theme ============ */

  Theme.init();
  SideMenu.build({
    user,
    currentPath: isEdit ? "/diagrams" : "/create",
    items: [
      { href: "/", label: "Trang chủ", icon: "home" },
      { href: "/create", label: "Tạo sơ đồ", icon: "plus" },
      { href: "/diagrams", label: "Danh sách sơ đồ", icon: "layers" },
      { href: "/settings", label: "Cài đặt", icon: "settings" },
      { href: "/admin", label: "Quản lý trang web", icon: "shield", adminOnly: true },
    ],
  });
  const menuBtn = document.getElementById("menuBtn");
  menuBtn.innerHTML = ICONS.menu;
  menuBtn.addEventListener("click", () => SideMenu.open());

  const panelToggle = document.getElementById("panelToggle");
  panelToggle.innerHTML = ICONS.settings;
  panelToggle.addEventListener("click", () => {
    document.getElementById("stylePanel").classList.toggle("open");
  });

  /* ============ name input ============ */

  const nameInput = document.getElementById("diagramName");
  nameInput.value = isEdit ? BOOT.diagram.name : "Sơ đồ chưa đặt tên";
  nameInput.addEventListener("input", markDirty);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); save(); }
    e.stopPropagation(); // tránh trigger shortcut editor
  });

  /* ============ save ============ */

  async function save() {
    const name = nameInput.value.trim() || "Sơ đồ chưa đặt tên";
    if (name.length > 120) {
      Toast.error("Tên tối đa 120 ký tự.");
      return false;
    }
    if (doc.elements.length > 2000) {
      Toast.error("Quá nhiều phần tử (tối đa 2000).");
      return false;
    }
    const data = doc.serialize();
    const body = { name, data };
    const btn = document.getElementById("saveBtn");
    btn.disabled = true;
    try {
      const res = isEdit
        ? await Api.patch(`/api/v1/diagrams/${diagramId}`, body)
        : await Api.post("/api/v1/diagrams", body);
      if (res.success) {
        markClean();
        Toast.ok("Đã lưu sơ đồ.");
        if (!isEdit) {
          leaving = true;
          window.history.replaceState(null, "", `/edit/${res.data.diagram.id}`);
          // Cập nhật trạng thái local để lưu tiếp lại là PATCH
          window.location.reload();
        }
        return true;
      }
      const fields = res.error?.details ? Object.entries(res.error.details).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ") : "";
      Toast.error((res.error?.message || "Không lưu được.") + (fields ? ` (${fields})` : ""));
      return false;
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById("saveBtn").addEventListener("click", save);

  /* ============ render ============ */

  function renderScene() {
    view.content.replaceChildren();
    // Cập nhật connector gắn shape trước
    for (const e of doc.elements) {
      if (e.type === "connector" || ((e.type === "arrow" || e.type === "line") && (e.startId || e.endId))) {
        updateConnectorPoints(doc, e);
      }
    }
    for (const e of doc.elements) {
      const node = Render.element(e, { hideText: e.id === editingId });
      if (selection.has(e.id)) node.classList.add("selected");
      view.content.appendChild(node);
    }
    renderOverlay();
  }

  function renderAll() {
    renderScene();
    renderStylePanel();
  }

  let rafPending = false;
  let rafFull = false;
  /** Vẽ lại ở khung hình kế tiếp. full = true: cập nhật cả panel thuộc tính. */
  function requestRender(full = false) {
    rafFull = rafFull || full;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const f = rafFull;
      rafFull = false;
      if (f) renderAll(); else renderScene();
    });
  }

  /* ---- hình học của tay cầm ---- */

  const HANDLE_NAMES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const HANDLE_BASE = { n: 0, ne: 45, e: 90, se: 135, s: 0, sw: 45, w: 90, nw: 135 };

  function handleCursor(name, rot) {
    const a = ((((HANDLE_BASE[name] + rot) % 180) + 180) % 180) / 45;
    return ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"][Math.round(a) % 4];
  }

  function autoHeight(e) {
    const ts = Layout.textStyle(e);
    return ts.autoFit === "resize" && TEXT_TYPES.has(e.type);
  }

  function isRotatable(e) {
    if (e.type === "group" || e.type === "image") return false;
    if (!isLineType(e.type)) return true;
    return e.type !== "connector" && !e.startId && !e.endId && Array.isArray(e.points) && e.points.length >= 2;
  }

  function renderOverlay() {
    view.overlay.replaceChildren();
    const z = view.zoom;
    const sel = selected();
    if (sel.length === 0) return;
    const accent = "var(--accent)";

    const addRotateHandle = (parent, cx, topY) => {
      const off = 26 / z;
      parent.appendChild(el("line", { x1: cx, y1: topY, x2: cx, y2: topY - off, stroke: accent, "stroke-width": 1.5 / z, "pointer-events": "none" }));
      const c = el("circle", { cx, cy: topY - off, r: 6.5 / z, fill: "var(--bg-elev)", stroke: accent, "stroke-width": 1.5 / z, class: "rotate-handle", "data-handle": "rot" });
      c.style.cursor = "grab";
      parent.appendChild(c);
    };

    for (const e of sel) {
      if (isLineType(e.type)) {
        if (e.points && e.points.length >= 2) {
          view.overlay.appendChild(el("path", {
            d: "M" + e.points.map((p) => `${p[0]} ${p[1]}`).join(" L"),
            fill: "none", stroke: accent, "stroke-opacity": "0.35", "stroke-width": 8 / z,
            "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none",
          }));
        }
        continue;
      }
      const w = e.width || 0, h = e.height || 0;
      const [cx, cy] = Geometry.center(e);
      const g = el("g");
      if (e.rotation) g.setAttribute("transform", `rotate(${e.rotation} ${cx} ${cy})`);
      g.appendChild(el("rect", {
        x: e.x, y: e.y, width: w, height: h, fill: "none", stroke: accent,
        "stroke-width": 1.5 / z, class: "selection-box", "pointer-events": "none",
      }));
      if (sel.length === 1) {
        const hs = 9 / z;
        const pos = {
          nw: [e.x, e.y], n: [e.x + w / 2, e.y], ne: [e.x + w, e.y], e: [e.x + w, e.y + h / 2],
          se: [e.x + w, e.y + h], s: [e.x + w / 2, e.y + h], sw: [e.x, e.y + h], w: [e.x, e.y + h / 2],
        };
        const hideNS = autoHeight(e) || w * z < 30;
        const hideEW = h * z < 30;
        for (const name of HANDLE_NAMES) {
          if ((name === "n" || name === "s") && hideNS) continue;
          if ((name === "e" || name === "w") && hideEW && !(e.type === "text")) continue;
          const [hx, hy] = pos[name];
          const r = el("rect", {
            x: hx - hs / 2, y: hy - hs / 2, width: hs, height: hs, rx: 1.5 / z,
            class: `resize-handle ${name}`, "data-handle": name, "stroke-width": 1.5 / z,
          });
          r.style.cursor = handleCursor(name, e.rotation || 0);
          g.appendChild(r);
        }
        if (isRotatable(e)) addRotateHandle(g, e.x + w / 2, e.y);
      }
      view.overlay.appendChild(g);
    }

    // Nhiều phần tử (hoặc một đường tự do): khung chung + núm xoay nhóm
    const rot = sel.filter(isRotatable);
    const needGroupBox = sel.length > 1 || (sel.length === 1 && isLineType(sel[0].type));
    if (needGroupBox && rot.length > 0 && rot.length === sel.filter((e) => !isLineType(e.type) || isRotatable(e)).length) {
      const b = doc.bounds(rot);
      if (b) {
        view.overlay.appendChild(el("rect", {
          x: b.minX, y: b.minY, width: b.w, height: b.h, fill: "none", stroke: accent,
          "stroke-width": 1.5 / z, "stroke-dasharray": `${5 / z} ${4 / z}`, "pointer-events": "none",
        }));
        addRotateHandle(view.overlay, b.minX + b.w / 2, b.minY);
      }
    }

    if (rotateHud) {
      const fs = 12 / z;
      const text = el("text", { x: rotateHud.x, y: rotateHud.y, "font-size": fs, fill: "#fff", "font-family": "system-ui, sans-serif", "font-weight": "600", "pointer-events": "none" });
      text.textContent = rotateHud.text;
      const wBox = (rotateHud.text.length * 0.62 + 1.2) * fs;
      view.overlay.appendChild(el("rect", { x: rotateHud.x - 0.5 * fs, y: rotateHud.y - fs * 1.1, width: wBox, height: fs * 1.6, rx: 4 / z, fill: "#111827", "fill-opacity": "0.88", "pointer-events": "none" }));
      view.overlay.appendChild(text);
    }
  }

  /* ============ pointer interactions ============ */

  host.addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest(".text-editor-overlay")) return;
    if (e.button === 1) { view.startPan(e); return; }
    if (e.button !== 0) return;
    if (tool === "hand") { view.startPan(e); return; }

    // Núm xoay / núm đổi cỡ
    const handle = e.target.closest ? e.target.closest("[data-handle]") : null;
    if (handle) {
      e.preventDefault();
      const kind = handle.getAttribute("data-handle");
      if (kind === "rot") startRotate(e); else startResize(kind);
      return;
    }

    const world = view.screenToWorld(e.clientX, e.clientY);
    const hit = hitElement(world);
    if (tool === "select") {
      if (hit) {
        if (e.shiftKey) {
          if (selection.has(hit.id)) selection.delete(hit.id); else selection.add(hit.id);
        } else if (!selection.has(hit.id)) {
          selection = new Set([hit.id]);
        }
        startMove(e, world);
      } else {
        selection.clear();
        startMarquee(e, world);
      }
      requestRender(true);
      return;
    }

    // Công cụ vẽ
    if (hit && (tool === "connector" || tool === "arrow")) {
      startConnectFromShape(e, world, hit);
      return;
    }
    if (tool === "text") {
      e.preventDefault();
      createTextAt(world);
      return;
    }
    startDraw(e, world);
  });

  function hitElement(world) {
    // Ưu tiên phần tử nằm trên: duyệt ngược
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const e = doc.elements[i];
      if (isLineType(e.type)) {
        if (e.points && hitPolyline(e.points, world, 10 / view.zoom)) return e;
        continue;
      }
      const [lx, ly] = Geometry.toLocal(e, world.x, world.y);
      const slop = e.type === "text" ? 4 : 0;
      const w = e.width || 0, h = e.height || 0;
      if (lx >= e.x - slop && lx <= e.x + w + slop && ly >= e.y - slop && ly <= e.y + h + slop) return e;
    }
    return null;
  }

  function hitPolyline(points, world, tolerance) {
    for (let i = 0; i < points.length - 1; i++) {
      if (distToSegment(world.x, world.y, points[i], points[i + 1]) < tolerance) return true;
    }
    return false;
  }

  function distToSegment(px, py, [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  /* ---- draw shape ---- */

  function startDraw(e, worldStart) {
    const id = uid();
    const defaults = { ...DEFAULT_STYLES[tool] };
    const shape = {
      id, type: tool, x: worldStart.x, y: worldStart.y, width: 0, height: 0,
      text: "", style: defaults,
    };
    if (tool === "line" || tool === "arrow") {
      shape.points = [[worldStart.x, worldStart.y], [worldStart.x, worldStart.y]];
      delete shape.width; delete shape.height;
    }
    doc.add(shape);
    selection = new Set([id]);
    action = { kind: "draw", id, origin: { ...worldStart } };

    const move = (ev) => {
      const w = view.screenToWorld(ev.clientX, ev.clientY);
      const sx = view.snapEnabled ? snap(w.x) : w.x;
      const sy = view.snapEnabled ? snap(w.y) : w.y;
      const sh = doc.byId(id);
      if (!sh) return;
      if (sh.points) {
        sh.points[1] = [sx, sy];
        if (ev.shiftKey) {
          // giới hạn 0/45/90 độ
          const [x0, y0] = sh.points[0];
          const dx = sx - x0, dy = sy - y0;
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          sh.points[1] = [x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len];
        }
      } else {
        sh.x = Math.min(sx, action.origin.x);
        sh.y = Math.min(sy, action.origin.y);
        sh.width = Math.abs(sx - action.origin.x);
        sh.height = Math.abs(sy - action.origin.y);
        if (ev.shiftKey) {
          const m = Math.max(sh.width, sh.height);
          sh.width = m; sh.height = m;
        }
      }
      requestRender();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const sh = doc.byId(id);
      if (sh) {
        if (!sh.points && (sh.width < 4 || sh.height < 4)) {
          // click đơn → shape mặc định
          sh.width = sh.width < 4 ? 160 : sh.width;
          sh.height = sh.height < 4 ? 90 : sh.height;
          sh.x = view.snapEnabled ? snap(sh.x) : sh.x;
          sh.y = view.snapEnabled ? snap(sh.y) : sh.y;
        }
        if (sh.points && (Math.abs(sh.points[1][0] - sh.points[0][0]) + Math.abs(sh.points[1][1] - sh.points[0][1]) < 6)) {
          doc.remove([id]);
          selection.clear();
        }
      }
      history.snapshot("draw");
      action = null;
      requestRender(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  let action = null; // {kind: 'draw'|'connect', ...}

  /* ---- move ---- */

  function startMove(e, worldStart) {
    if (selection.size === 0) return;
    const originals = [...selection].map((id) => {
      const el0 = doc.byId(id);
      return el0 ? { id, x: el0.x, y: el0.y, points: el0.points?.map((p) => [...p]) } : null;
    }).filter(Boolean);
    if (originals.length === 0) return;
    let moved = false;

    const move = (ev) => {
      const w = view.screenToWorld(ev.clientX, ev.clientY);
      let dx = w.x - worldStart.x;
      let dy = w.y - worldStart.y;
      if (!moved && Math.hypot(dx, dy) * view.zoom < 3) return; // chống rung tay khi chỉ click
      if (ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
      }
      if (view.snapEnabled) {
        const first = originals[0];
        dx = snap(first.x + dx) - first.x;
        dy = snap(first.y + dy) - first.y;
      }
      for (const o of originals) {
        const el0 = doc.byId(o.id);
        if (!el0) continue;
        el0.x = o.x + dx;
        el0.y = o.y + dy;
        if (o.points && el0.points) {
          for (let i = 0; i < el0.points.length; i++) {
            el0.points[i] = [o.points[i][0] + dx, o.points[i][1] + dy];
          }
        }
      }
      moved = true;
      requestRender();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) { history.snapshot("move"); requestRender(true); }
      action = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---- resize (có tính góc xoay, giữ cố định điểm đối diện) ---- */

  function startResize(handleName) {
    const sel = selected();
    if (sel.length !== 1 || isLineType(sel[0].type)) return;
    const e0 = sel[0];
    const hx = handleName.includes("e") ? 1 : handleName.includes("w") ? -1 : 0;
    const hy = handleName.includes("s") ? 1 : handleName.includes("n") ? -1 : 0;
    const isText = e0.type === "text";
    const corner = hx !== 0 && hy !== 0;
    const scaleText = isText && corner;                 // góc của Text = phóng to/thu nhỏ chữ
    const orig = {
      x: e0.x, y: e0.y, w: e0.width || 0, h: e0.height || 0, rot: e0.rotation || 0,
      fs: Layout.textStyle(e0).size, style: { ...(e0.style || {}) },
    };
    const cx0 = orig.x + orig.w / 2, cy0 = orig.y + orig.h / 2;
    // Text kéo cạnh trái/phải: giữ nguyên mép trên (chiều cao tự theo chữ)
    const ay = isText && hy === 0 ? 1 : hy;
    const anchorLocal = [cx0 - hx * orig.w / 2, cy0 - ay * orig.h / 2];
    const anchor = rotPoint(anchorLocal[0], anchorLocal[1], cx0, cy0, orig.rot);
    const minW = isText ? 16 : 8, minH = isText ? 16 : 8;
    let changed = false;

    const move = (ev) => {
      let m = view.screenToWorld(ev.clientX, ev.clientY);
      if (!orig.rot && view.snapEnabled && !scaleText) m = { x: snap(m.x), y: snap(m.y) };
      const [px, py] = rotPoint(m.x, m.y, anchor[0], anchor[1], -orig.rot);
      const ux = px - anchor[0], uy = py - anchor[1];
      let nw = hx ? Math.max(minW, hx * ux) : orig.w;
      let nh = hy ? Math.max(minH, hy * uy) : orig.h;

      const el0 = doc.byId(e0.id);
      if (!el0) return;
      el0.style = { ...orig.style };

      if (scaleText && orig.w > 0 && orig.h > 0) {
        let k = (nw * orig.w + nh * orig.h) / (orig.w * orig.w + orig.h * orig.h);
        const fs = clamp(orig.fs * k, MIN_FONT, MAX_FONT);
        k = fs / orig.fs;
        el0.style.fontSize = Math.round(fs * 10) / 10;
        el0.width = orig.w * k;
        el0.height = orig.h * k;
        Layout.fit(el0);
      } else {
        if (corner && ev.shiftKey && orig.w > 0 && orig.h > 0) {
          const k = Math.max(nw / orig.w, nh / orig.h);
          nw = Math.max(minW, orig.w * k); nh = Math.max(minH, orig.h * k);
        }
        if (isText && hx !== 0 && hy === 0) { el0.style.wrap = true; }
        el0.width = nw;
        el0.height = nh;
        Layout.fit(el0);
      }
      const fw = el0.width, fh = el0.height;
      const [ox, oy] = rotPoint(hx * fw / 2, ay * fh / 2, 0, 0, orig.rot);
      const ncx = anchor[0] + ox, ncy = anchor[1] + oy;
      el0.x = ncx - fw / 2;
      el0.y = ncy - fh / 2;
      changed = true;
      requestRender();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (changed) history.snapshot("resize");
      requestRender(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---- rotate ---- */

  function startRotate(ev) {
    const els = selected().filter(isRotatable);
    if (els.length === 0) return;
    const single = els.length === 1 && !isLineType(els[0].type);
    let pivot;
    if (single) pivot = Geometry.center(els[0]);
    else { const b = doc.bounds(els); pivot = [b.minX + b.w / 2, b.minY + b.h / 2]; }
    const originals = els.map((e) => ({
      id: e.id, x: e.x, y: e.y, rot: e.rotation || 0, points: e.points?.map((p) => [...p]),
    }));
    const p0 = view.screenToWorld(ev.clientX, ev.clientY);
    const a0 = Math.atan2(p0.y - pivot[1], p0.x - pivot[0]) / DEG;
    let changed = false;
    host.style.cursor = "grabbing";

    const move = (mv) => {
      const w = view.screenToWorld(mv.clientX, mv.clientY);
      const a1 = Math.atan2(w.y - pivot[1], w.x - pivot[0]) / DEG;
      let delta = a1 - a0;
      if (mv.shiftKey) {
        if (single) delta = Math.round((originals[0].rot + delta) / 15) * 15 - originals[0].rot;
        else delta = Math.round(delta / 15) * 15;
      }
      for (const o of originals) {
        const e = doc.byId(o.id);
        if (!e) continue;
        e.x = o.x; e.y = o.y;
        e.rotation = o.rot;
        if (o.points) e.points = o.points.map((p) => [...p]);
        Transform.rotateBy(e, delta, pivot);
      }
      const shown = single ? normAngle(originals[0].rot + delta) : normAngle(delta);
      rotateHud = { x: w.x + 14 / view.zoom, y: w.y - 10 / view.zoom, text: `${Math.round(shown)}°` };
      changed = true;
      requestRender();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      host.style.cursor = tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
      rotateHud = null;
      if (changed) history.snapshot("rotate");
      requestRender(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Xoay các phần tử đang chọn thêm `delta` độ (quanh tâm của chúng). */
  function rotateSelectionBy(delta) {
    const els = selected().filter(isRotatable);
    if (els.length === 0) return;
    let pivot;
    if (els.length === 1 && !isLineType(els[0].type)) pivot = Geometry.center(els[0]);
    else { const b = doc.bounds(els); pivot = [b.minX + b.w / 2, b.minY + b.h / 2]; }
    for (const e of els) Transform.rotateBy(e, delta, pivot);
    history.snapshot("rotate");
    renderAll();
  }

  /* ---- marquee ---- */

  function startMarquee(e, worldStart) {
    let rectEl = null;
    const move = (ev) => {
      const w = view.screenToWorld(ev.clientX, ev.clientY);
      const x = Math.min(w.x, worldStart.x), y = Math.min(w.y, worldStart.y);
      const width = Math.abs(w.x - worldStart.x), height = Math.abs(w.y - worldStart.y);
      if (!rectEl) {
        rectEl = el("rect", { class: "selection-marquee" });
        view.overlay.appendChild(rectEl);
      }
      rectEl.setAttribute("x", x); rectEl.setAttribute("y", y);
      rectEl.setAttribute("width", width); rectEl.setAttribute("height", height);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (rectEl) {
        const rx = +rectEl.getAttribute("x"), ry = +rectEl.getAttribute("y");
        const rw = +rectEl.getAttribute("width"), rh = +rectEl.getAttribute("height");
        rectEl.remove();
        if (rw > 4 || rh > 4) {
          for (const e0 of doc.elements) {
            const r = doc.hitRect(e0);
            if (rx <= r.x && ry <= r.y && rx + rw >= r.x + r.w && ry + rh >= r.y + r.h) {
              selection.add(e0.id);
            }
          }
          requestRender(true);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---- connectors ---- */

  function startConnectFromShape(e, world, hitShape) {
    if (["line", "arrow", "connector", "text"].includes(hitShape.type)) return;
    const id = uid();
    const startSide = nearestSide(hitShape, [world.x, world.y]);
    const shape = {
      id, type: tool, x: world.x, y: world.y,
      points: [anchorPoint(hitShape, startSide), [world.x, world.y]],
      style: { ...DEFAULT_STYLES[tool] },
      startId: hitShape.id,
      startSide,
      endId: undefined,
    };
    doc.add(shape);
    selection = new Set([id]);
    action = { kind: "connect", id };

    const move = (ev) => {
      const w = view.screenToWorld(ev.clientX, ev.clientY);
      const sh = doc.byId(id);
      if (!sh) return;
      const target = hitElement(w);
      if (target && target.id !== hitShape.id && !["line", "arrow", "connector", "text"].includes(target.type)) {
        sh.endId = target.id;
        sh.endSide = nearestSide(target, [w.x, w.y]);
        updateConnectorPoints(doc, sh);
      } else {
        sh.endId = undefined;
        sh.points[sh.points.length - 1] = [w.x, w.y];
      }
      requestRender();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const sh = doc.byId(id);
      if (!sh || !sh.endId) {
        // Không gắn được → xóa
        if (sh) doc.remove([id]);
        selection.clear();
      } else {
        history.snapshot("connect");
      }
      action = null;
      requestRender(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---- text editing (sửa chữ ngay trên canvas, đúng phông/cỡ/màu/góc xoay) ---- */

  let activeEditor = null; // { place(), finish(commit) }

  function createTextAt(world) {
    const id = uid();
    const x = view.snapEnabled ? snap(world.x) : world.x;
    const y = view.snapEnabled ? snap(world.y) : world.y;
    const e = { id, type: "text", x, y, width: 0, height: 0, rotation: 0, text: "", style: { ...DEFAULT_STYLES.text } };
    doc.add(e);
    Layout.fit(e);
    selection = new Set([id]);
    setTool("select");
    renderAll();
    // Mở ô nhập ở tác vụ kế tiếp: nếu mở ngay trong pointerdown, trình duyệt sẽ chuyển focus
    // sau sự kiện chuột và ô nhập bị blur (= commit chữ rỗng, phần tử bị xóa).
    setTimeout(() => { if (doc.byId(id) && !activeEditor) editTextElement(e); }, 0);
  }

  function editTextElement(e) {
    if (!TEXT_TYPES.has(e.type)) return;
    if (activeEditor) activeEditor.finish(true);
    const orig = { text: e.text || "", width: e.width, height: e.height };
    const ta = document.createElement("textarea");
    ta.className = "text-editor-overlay";
    ta.spellcheck = false;
    ta.setAttribute("aria-label", "Nhập nội dung chữ");
    ta.value = e.text || "";
    host.appendChild(ta);
    editingId = e.id;
    let finished = false;

    const place = () => {
      Layout.fit(e);
      const c = Layout.compute(e);
      const { ts, box, pad } = c;
      const k = view.zoom;
      const [cx, cy] = Geometry.center(e);
      const sc = view.worldToScreen(cx, cy);
      const wpx = box.w * k, hpx = box.h * k;
      const st = ta.style;
      st.left = `${sc.x - wpx / 2}px`;
      st.top = `${sc.y - hpx / 2}px`;
      st.width = `${wpx}px`;
      st.height = `${hpx}px`;
      st.transformOrigin = "50% 50%";
      st.transform = `rotate(${(e.rotation || 0) + ts.rot}deg)`;
      st.fontFamily = ts.stack;
      st.fontSize = `${c.fs * k}px`;
      st.fontWeight = String(ts.weight);
      st.fontStyle = ts.italic ? "italic" : "normal";
      st.color = ts.color;
      st.textAlign = ts.align;
      st.lineHeight = String(ts.lh);
      st.letterSpacing = `${ts.ls * k}px`;
      st.textTransform = ts.transform === "upper" ? "uppercase" : ts.transform === "lower" ? "lowercase" : ts.transform === "capitalize" ? "capitalize" : "none";
      st.textDecoration = ts.deco || "none";
      st.whiteSpace = ts.wrap ? "pre-wrap" : "pre";
      st.overflowWrap = ts.wrap ? "anywhere" : "normal";
      let top = pad.y;
      if (ts.valign === "middle") top = Math.max(pad.y, (box.h - c.blockH) / 2);
      else if (ts.valign === "bottom") top = Math.max(pad.y, box.h - pad.y - c.blockH);
      st.padding = `${top * k}px ${pad.x * k}px 0 ${pad.x * k}px`;
    };

    const onInput = () => {
      e.text = ta.value;
      place();
      requestRender();
    };

    const finish = (commit) => {
      if (finished) return;
      finished = true;
      ta.removeEventListener("blur", onBlur);
      activeEditor = null;
      const value = ta.value;
      ta.remove();
      editingId = null;
      if (commit) {
        e.text = value;
        if (!e.text && e.type === "text") { doc.remove([e.id]); selection.delete(e.id); }
        else Layout.fit(e);
        history.snapshot("text");
      } else {
        e.text = orig.text; e.width = orig.width; e.height = orig.height;
        if (!orig.text && e.type === "text") { doc.remove([e.id]); selection.delete(e.id); }
      }
      requestRender(true);
    };
    const onBlur = () => finish(true);

    ta.addEventListener("input", onInput);
    ta.addEventListener("blur", onBlur);
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { ev.preventDefault(); finish(false); return; }
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ta.blur(); return; }
      const fn = formatShortcut(ev);
      if (fn) { ev.preventDefault(); fn(); }
    });
    ta.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });

    activeEditor = { place, finish };
    place();
    requestRender();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // Nhấp đúp vào phần tử để sửa chữ
  host.addEventListener("dblclick", (ev) => {
    if (ev.target.closest && ev.target.closest(".text-editor-overlay")) return;
    const world = view.screenToWorld(ev.clientX, ev.clientY);
    const hit = hitElement(world);
    if (!hit || !TEXT_TYPES.has(hit.type)) return;
    selection = new Set([hit.id]);
    renderAll();
    editTextElement(hit);
  });

  /* ============ định dạng chữ: toggle / cỡ chữ (dùng cho panel và phím tắt) ============ */

  const isTextEl = (e) => TEXT_TYPES.has(e.type);
  const textItems = () => selected().filter(isTextEl);

  /** Áp dụng patch style do fn(item) trả về cho các phần tử đang chọn (đã lọc). */
  function applyEach(fn, { label = "style", coalesce, filter } = {}) {
    const items = filter ? selected().filter(filter) : selected();
    if (items.length === 0) return;
    for (const item of items) {
      const patch = fn(item);
      if (patch) item.style = { ...(item.style || {}), ...patch };
      Layout.fit(item);
    }
    history.snapshot(label, coalesce);
    renderAll();
    if (activeEditor) activeEditor.place();
  }
  const applyStyle = (patch, coalesce, filter) => applyEach(() => patch, { coalesce, filter });
  const applyText = (patchOrFn, coalesce) =>
    applyEach(typeof patchOrFn === "function" ? patchOrFn : () => patchOrFn, { coalesce, filter: isTextEl });

  function decoParts(s) {
    const d = String(s?.textDecoration || "none");
    return { u: d.includes("underline"), s: d.includes("line-through") };
  }
  function toggleDeco(which) {
    const items = textItems();
    if (items.length === 0) return;
    const turnOn = !decoParts(items[0].style)[which];
    applyText((item) => {
      const p = decoParts(item.style);
      p[which] = turnOn;
      const parts = [];
      if (p.u) parts.push("underline");
      if (p.s) parts.push("line-through");
      return { textDecoration: parts.join(" ") || "none" };
    });
  }
  function toggleBold() {
    const items = textItems();
    if (items.length) applyText({ fontWeight: items[0].style?.fontWeight === "bold" ? "normal" : "bold" });
  }
  function toggleItalic() {
    const items = textItems();
    if (items.length) applyText({ fontStyle: items[0].style?.fontStyle === "italic" ? "normal" : "italic" });
  }
  /** mode "step": nhảy theo dãy cỡ chuẩn (8, 9, 10, 11, 12, 14, 16…); mode "pt": ±1. */
  function changeFontSize(mode, dir) {
    applyText((item) => {
      const cur = Layout.textStyle(item).size;
      const next = mode === "step" ? stepFontSize(cur, dir) : cur + dir;
      return { fontSize: Math.round(clamp(next, MIN_FONT, MAX_FONT) * 10) / 10 };
    });
  }

  /** Phím tắt định dạng giống PowerPoint. Trả về hàm thực thi hoặc null. */
  function formatShortcut(ev) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod || ev.altKey) return null;
    if (textItems().length === 0) return null;
    if (ev.shiftKey) {
      if (ev.key === ">" || ev.code === "Period") return () => changeFontSize("step", +1);
      if (ev.key === "<" || ev.code === "Comma") return () => changeFontSize("step", -1);
      return null;
    }
    const k = ev.key.toLowerCase();
    if (k === "b") return toggleBold;
    if (k === "i") return toggleItalic;
    if (k === "u") return () => toggleDeco("u");
    if (ev.key === "]") return () => changeFontSize("pt", +1);
    if (ev.key === "[") return () => changeFontSize("pt", -1);
    return null;
  }

  /* ============ keyboard shortcuts ============ */

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && key === "s") {
      e.preventDefault();
      save();
      return;
    }
    const fmt = formatShortcut(e);
    if (fmt) { e.preventDefault(); fmt(); return; }
    if (mod && key === "c") {
      e.preventDefault();
      copySelection();
      return;
    }
    if (mod && key === "v") {
      e.preventDefault();
      pasteClipboard();
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      duplicateSelection();
      return;
    }
    if (mod && key === "a") {
      e.preventDefault();
      selection = new Set(doc.elements.map((e0) => e0.id));
      renderAll();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === "Escape") {
      selection.clear();
      setTool("select");
      renderAll();
      return;
    }
    if ((e.key === "Enter" || e.key === "F2") && selection.size === 1) {
      const only = selected()[0];
      if (only && TEXT_TYPES.has(only.type)) { e.preventDefault(); editTextElement(only); return; }
    }
    if (e.key.startsWith("Arrow") && selection.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : GRID;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      if (e.key === "ArrowRight") dx = step;
      if (e.key === "ArrowUp") dy = -step;
      if (e.key === "ArrowDown") dy = step;
      for (const el0 of selected()) Transform.translate(el0, dx, dy);
      history.snapshot("nudge", "nudge");
      renderAll();
      return;
    }

    // Tool shortcuts
    const map = { v: "select", h: "hand", r: "rectangle", o: "ellipse", d: "diamond", l: "line", a: "arrow", c: "connector", t: "text", n: "note", f: "frame" };
    if (!mod && map[key]) setTool(map[key]);
    if (!mod && key === "g" && selection.size > 0) {
      // group
      e.preventDefault();
      groupSelection();
      return;
    }
  });

  /* ============ clipboard / duplicate / delete ============ */

  function serializeSelection() {
    return selected().map((e) => JSON.parse(JSON.stringify(e)));
  }

  function copySelection() {
    if (selection.size === 0) return;
    clipboard = serializeSelection();
    Toast.ok(`Đã sao chép ${clipboard.length} phần tử.`);
  }

  function pasteClipboard() {
    if (!clipboard || clipboard.length === 0) return;
    const map = {};
    for (const item of clipboard) {
      const copy = doc.migrate(JSON.parse(JSON.stringify(item)));
      copy.id = uid();
      map[item.id] = copy.id;
      Transform.translate(copy, GRID * 2, GRID * 2);
      doc.add(copy);
    }
    // remap connector refs
    for (const item of clipboard) {
      const copy = doc.byId(map[item.id]);
      if (copy?.startId && map[copy.startId]) copy.startId = map[copy.startId];
      if (copy?.endId && map[copy.endId]) copy.endId = map[copy.endId];
    }
    selection = new Set(Object.values(map));
    history.snapshot("paste");
    renderAll();
  }

  function duplicateSelection() {
    if (selection.size === 0) return;
    clipboard = serializeSelection();
    pasteClipboard();
  }

  function deleteSelection() {
    if (selection.size === 0) return;
    const doDelete = () => {
      doc.remove([...selection]);
      selection.clear();
      history.snapshot("delete");
      renderAll();
    };
    if (confirmDelete && selection.size > 3) {
      UI.confirm({
        title: `Xóa ${selection.size} phần tử?`,
        message: "Các phần tử đang chọn sẽ bị xóa khỏi sơ đồ (hoàn tác được bằng Ctrl+Z).",
        okLabel: "Xóa",
      }).then((ok) => { if (ok) doDelete(); });
    } else {
      doDelete();
    }
  }

  function groupSelection() {
    if (selection.size < 2) return;
    const ids = [...selection];
    const g = { id: uid(), type: "group", x: 0, y: 0, width: 0, height: 0, children: ids, style: {} };
    // tính bounds
    const els = ids.map((id) => doc.byId(id)).filter(Boolean);
    const b = doc.bounds(els);
    if (b) { g.x = b.minX; g.y = b.minY; g.width = b.w; g.height = b.h; }
    doc.add(g);
    history.snapshot("group");
    selection = new Set([g.id]);
    renderAll();
    Toast.ok("Đã nhóm.");
  }

  /* ============ style panel ============ */

  const stylePanel = document.getElementById("stylePanel");
  let panelSig = "";

  /** Tạo phần tử DOM gọn: h("div", {class, text, onClick…}, ...con). */
  function h(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (k.length > 2 && k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k !== "list" && k in n) n[k] = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
    return n;
  }

  const toHex = (c) => {
    if (typeof c !== "string") return null;
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("").toLowerCase();
    return null;
  };

  function mkColor(value, onInput, label) {
    const input = h("input", { type: "color", class: "style-input", value: toHex(value) || "#000000", "aria-label": label || "Chọn màu" });
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }
  function mkNum(value, min, max, step, onCommit, attrs = {}) {
    const shown = String(round2(value));
    const input = h("input", { type: "number", class: "style-input", min, max, step, value: shown, ...attrs });
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) { input.value = shown; return; }
      onCommit(clamp(v, min, max));
    });
    input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") input.blur(); });
    return input;
  }
  const collapsedSections = new Set();
  const section = (title, ...kids) => {
    const d = h("details", { class: "panel-section" }, h("summary", { text: title }), h("div", { class: "panel-section-body" }, ...kids));
    d.open = !collapsedSections.has(title);
    d.addEventListener("toggle", () => { if (d.open) collapsedSections.delete(title); else collapsedSections.add(title); });
    return d;
  };
  const row = (label, ...kids) => h("div", { class: "style-row" }, label ? h("label", { text: label }) : null, ...kids);
  const optGroup = (...btns) => h("div", { class: "style-opts" }, ...btns);
  const optBtn = (label, active, onClick, attrs = {}) =>
    h("button", { type: "button", class: "style-opt" + (active ? " active" : ""), "aria-pressed": active ? "true" : "false", onClick, ...attrs },
      typeof label === "string" ? document.createTextNode(label) : label);
  const miniField = (label, input) => h("div", { class: "mini-field" }, h("span", { text: label }), input);

  function askFontName() {
    let value = "";
    const input = h("input", { type: "text", class: "input", maxLength: 80, placeholder: "Ví dụ: Bahnschrift, Arial Narrow…", "aria-label": "Tên phông chữ" });
    input.addEventListener("input", () => { value = input.value; });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); UI.closeModal(null, "ok"); } });
    const body = h("div", {},
      h("p", { text: "Nhập đúng tên một phông đã cài trên máy. Người xem chưa cài phông này sẽ thấy phông thay thế." }),
      input);
    return UI.modal({
      title: "Phông chữ khác",
      body,
      actions: [{ label: "Hủy", class: "btn-secondary", value: "cancel" }, { label: "Áp dụng", class: "btn-primary", value: "ok" }],
    }).then((v) => (v === "ok" ? FontCatalog.clean(value) : ""));
  }

  function fontSelect(current, onPick) {
    const wanted = current || FontCatalog.DEFAULT_FONT;
    const known = FontCatalog.find(wanted);
    const curName = known ? known.name : (FontCatalog.clean(wanted) || FontCatalog.DEFAULT_FONT);
    const select = h("select", { class: "style-input", "aria-label": "Phông chữ" });
    if (!known) select.append(h("option", { value: curName, text: `${curName} (tự nhập)` }));
    for (const g of FontCatalog.groups) {
      const og = h("optgroup", { label: g.label });
      for (const f of g.fonts) {
        const opt = h("option", { value: f.name, text: f.name });
        opt.style.fontFamily = f.stack;
        og.append(opt);
      }
      select.append(og);
    }
    select.append(h("option", { value: "__custom__", text: "Nhập tên phông khác…" }));
    select.value = curName;
    select.addEventListener("change", async () => {
      if (select.value === "__custom__") {
        const name = await askFontName();
        if (name) onPick(name); else select.value = curName;
        return;
      }
      onPick(select.value);
    });
    return select;
  }

  function setGeom(patch) {
    const e = selected()[0];
    if (!e || isLineType(e.type)) return;
    if ("width" in patch) { patch.width = Math.max(8, patch.width); if (e.type === "text") e.style = { ...(e.style || {}), wrap: true }; }
    if ("height" in patch) patch.height = Math.max(8, patch.height);
    Object.assign(e, patch);
    Layout.fit(e);
    history.snapshot("geom");
    renderAll();
  }
  function setRotationAbs(deg) {
    const els = selected().filter(isRotatable);
    for (const e of els) Transform.setRotation(e, deg);
    history.snapshot("rotate");
    renderAll();
  }

  function renderStylePanel() {
    const sel = selected();
    const sig = sel.map((e) => e.id + ":" + e.type).join("|");
    const ae = document.activeElement;
    // Đang gõ/chọn trong panel và vẫn cùng vùng chọn → không dựng lại (giữ focus, giữ bảng chọn màu)
    if (sig === panelSig && ae && stylePanel.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    panelSig = sig;
    stylePanel.replaceChildren();

    if (sel.length === 0) {
      stylePanel.append(
        h("div", { class: "panel-empty", text: "Chọn một phần tử để chỉnh kiểu." }),
        h("div", { class: "panel-tips" },
          h("div", { text: "Gợi ý nhanh" }),
          h("ul", {},
            h("li", { text: "Nhấp đúp để sửa chữ" }),
            h("li", { text: "Kéo núm tròn phía trên để xoay (giữ Shift: bước 15°)" }),
            h("li", { text: "Ctrl+B / I / U: đậm / nghiêng / gạch chân" }),
            h("li", { text: "Ctrl+Shift+< hoặc >: giảm / tăng cỡ chữ" }),
            h("li", { text: "Ctrl+[ hoặc ]: giảm / tăng 1 điểm" }),
            h("li", { text: "Text: kéo góc để phóng to/thu nhỏ chữ" }),
          )));
      return;
    }

    const refText = sel.find(isTextEl);
    const refShape = sel.find((e) => !isLineType(e.type));
    const refLine = sel.find((e) => isLineType(e.type));
    const e0 = sel[0];

    stylePanel.append(h("h3", { text: sel.length > 1 ? `${sel.length} phần tử` : typeLabel(e0.type) }));

    /* ---------- Chữ ---------- */
    if (refText) {
      const ts = Layout.textStyle(refText);
      const plain = refText.type === "text";
      const s = refText.style || {};
      const dp = decoParts(s);

      const sizeInput = mkNum(ts.size, MIN_FONT, MAX_FONT, 1, (v) => applyText({ fontSize: Math.round(v * 10) / 10 }), { list: "fontSizeList", "aria-label": "Cỡ chữ" });
      const datalist = h("datalist", { id: "fontSizeList" }, FONT_SIZE_PRESETS.map((p) => h("option", { value: String(p) })));

      stylePanel.append(
        section("Chữ",
          row("Phông chữ", fontSelect(s.fontFamily, (name) => { FontCatalog.ensure(name); applyText({ fontFamily: name }); })),
          row("Cỡ chữ",
            h("div", { class: "size-row" },
              h("button", { type: "button", class: "style-opt", title: "Giảm cỡ chữ (Ctrl+Shift+<)", "aria-label": "Giảm cỡ chữ", text: "A−", onClick: () => changeFontSize("step", -1) }),
              sizeInput,
              h("button", { type: "button", class: "style-opt", title: "Tăng cỡ chữ (Ctrl+Shift+>)", "aria-label": "Tăng cỡ chữ", text: "A+", onClick: () => changeFontSize("step", +1) }),
            ), datalist),
          row("Kiểu chữ", optGroup(
            optBtn(h("b", { text: "B" }), s.fontWeight === "bold", toggleBold, { title: "Đậm (Ctrl+B)", "aria-label": "Đậm" }),
            optBtn(h("i", { text: "I" }), s.fontStyle === "italic", toggleItalic, { title: "Nghiêng (Ctrl+I)", "aria-label": "Nghiêng" }),
            optBtn(h("u", { text: "U" }), dp.u, () => toggleDeco("u"), { title: "Gạch chân (Ctrl+U)", "aria-label": "Gạch chân" }),
            optBtn(h("s", { text: "S" }), dp.s, () => toggleDeco("s"), { title: "Gạch ngang", "aria-label": "Gạch ngang" }),
          )),
          row("Màu chữ", mkColor(s.textColor, (v) => applyText({ textColor: v }, "textColor"), "Màu chữ")),
          row("Căn ngang", optGroup(
            ...[["left", "Trái"], ["center", "Giữa"], ["right", "Phải"]].map(([val, lab]) =>
              optBtn(lab, ts.align === val, () => applyText({ textAlign: val })))
          )),
          row("Căn dọc", optGroup(
            ...[["top", "Trên"], ["middle", "Giữa"], ["bottom", "Dưới"]].map(([val, lab]) =>
              optBtn(lab, ts.valign === val, () => applyText({ verticalAlign: val })))
          )),
          h("div", { class: "style-cols style-row" },
            miniField("Giãn dòng", mkNum(ts.lh, 0.8, 4, 0.05, (v) => applyText({ lineHeight: round2(v) }))),
            miniField("Giãn chữ (px)", mkNum(ts.ls, -10, 100, 0.5, (v) => applyText({ letterSpacing: round2(v) }))),
          ),
          row("Kiểu chữ hoa/thường", (() => {
            const sel2 = h("select", { class: "style-input", "aria-label": "Chữ hoa thường" },
              ...[["none", "Bình thường"], ["upper", "CHỮ IN HOA"], ["lower", "chữ in thường"], ["capitalize", "Viết Hoa Đầu Từ"]]
                .map(([v, t]) => h("option", { value: v, text: t })));
            sel2.value = ts.transform;
            sel2.addEventListener("change", () => applyText({ textTransform: sel2.value }));
            return sel2;
          })()),
          row("Vừa với khung", optGroup(
            optBtn("Không", ts.autoFit === "none", () => applyText({ autoFit: "none" }), { title: "Giữ nguyên cỡ chữ và khung" }),
            optBtn("Thu chữ", ts.autoFit === "shrink", () => applyText({ autoFit: "shrink" }), { title: "Tự thu nhỏ chữ khi tràn khung (như PowerPoint)" }),
            optBtn("Giãn khung", ts.autoFit === "resize", () => applyText({ autoFit: "resize" }), { title: "Tự giãn khung vừa với chữ" }),
          )),
          plain ? null : row("Xoay chữ trong khung",
            h("div", { class: "size-row" },
              mkNum(ts.rot, -360, 360, 1, (v) => applyText({ textRotation: v }), { "aria-label": "Góc xoay chữ (độ)" }),
              h("button", { type: "button", class: "style-opt", text: "↺ 90°", title: "Xoay chữ 90° ngược chiều kim đồng hồ", onClick: () => applyText((it) => ({ textRotation: normAngle((+it.style?.textRotation || 0) - 90) })) }),
              h("button", { type: "button", class: "style-opt", text: "↻ 90°", title: "Xoay chữ 90° theo chiều kim đồng hồ", onClick: () => applyText((it) => ({ textRotation: normAngle((+it.style?.textRotation || 0) + 90) })) }),
            ),
            optGroup(optBtn("Đặt lại góc chữ", false, () => applyText({ textRotation: 0 }))),
          ),
        ),
      );
    }

    /* ---------- Vị trí, kích thước, xoay khung ---------- */
    const rotatable = sel.filter(isRotatable);
    if (rotatable.length > 0 || (sel.length === 1 && refShape)) {
      const single = sel.length === 1 && !isLineType(e0.type);
      const geomKids = [];
      if (rotatable.length > 0) {
        if (single) {
          geomKids.push(row("Góc xoay khung",
            h("div", { class: "size-row" },
              mkNum(e0.rotation || 0, 0, 360, 1, (v) => setRotationAbs(v), { "aria-label": "Góc xoay khung (độ)" }),
              h("button", { type: "button", class: "style-opt", text: "Đặt lại", title: "Về 0°", onClick: () => setRotationAbs(0) }),
            )));
        }
        geomKids.push(row(single ? "" : "Xoay nhóm", optGroup(
          optBtn("↺ 90°", false, () => rotateSelectionBy(-90), { title: "Xoay 90° ngược chiều kim đồng hồ" }),
          optBtn("↻ 90°", false, () => rotateSelectionBy(90), { title: "Xoay 90° theo chiều kim đồng hồ" }),
          optBtn("−15°", false, () => rotateSelectionBy(-15)),
          optBtn("+15°", false, () => rotateSelectionBy(15)),
        )));
      }
      if (single) {
        geomKids.push(
          h("div", { class: "style-cols style-row" },
            miniField("X", mkNum(e0.x, -1e6, 1e6, 1, (v) => setGeom({ x: v }))),
            miniField("Y", mkNum(e0.y, -1e6, 1e6, 1, (v) => setGeom({ y: v }))),
            miniField("Rộng", mkNum(e0.width || 0, 8, 100000, 1, (v) => setGeom({ width: v }))),
            miniField("Cao", mkNum(e0.height || 0, 8, 100000, 1, (v) => setGeom({ height: v }))),
          ));
      }
      stylePanel.append(section("Khung & xoay", ...geomKids));
    }

    /* ---------- Hình dạng ---------- */
    if (refShape && refShape.type !== "group") {
      const s = refShape.style || {};
      const lt = s.lineType || (s.strokeDasharray ? "dashed" : "solid");
      const isRect = ["rectangle", "rounded-rectangle", "note", "frame", "text"].includes(refShape.type);
      const notLine = (e) => !isLineType(e.type) && e.type !== "group";
      const hasFill = s.fill && s.fill !== "none";
      const hasStroke = s.stroke && s.stroke !== "none";
      stylePanel.append(section("Hình dạng",
        row("Màu nền", h("div", { class: "size-row" },
          mkColor(s.fill, (v) => applyStyle({ fill: v }, "fill", notLine), "Màu nền"),
          optBtn("Không", !hasFill, () => applyStyle({ fill: "none" }, null, notLine), { title: "Không tô nền" }))),
        row("Viền", h("div", { class: "size-row" },
          mkColor(s.stroke, (v) => applyStyle({ stroke: v }, "stroke", notLine), "Màu viền"),
          mkNum(s.strokeWidth ?? 1.5, 0, 64, 0.5, (v) => applyStyle({ strokeWidth: v }, null, notLine), { "aria-label": "Độ dày viền" }),
          optBtn("Không", !hasStroke, () => applyStyle({ stroke: "none" }, null, notLine), { title: "Không viền" }))),
        row("Kiểu nét viền", optGroup(
          ...[["solid", "Liền"], ["dashed", "Đứt"], ["dotted", "Chấm"]].map(([val, lab]) =>
            optBtn(lab, lt === val, () => applyStyle({ lineType: val, strokeDasharray: val === "dashed" ? "8 6" : val === "dotted" ? "2 4" : "" }, null, notLine)))
        )),
        isRect ? row("Bo góc", mkNum(s.radius ?? 0, 0, 512, 1, (v) => applyStyle({ radius: v }, null, (e) => ["rectangle", "rounded-rectangle", "note", "frame", "text"].includes(e.type)))) : null,
      ));
    }

    /* ---------- Đường / mũi tên ---------- */
    if (refLine) {
      const s = refLine.style || {};
      const isL = isLineType;
      const lt = s.lineType || (s.strokeDasharray ? "dashed" : "solid");
      stylePanel.append(section("Đường & mũi tên",
        row("Màu đường", mkColor(s.stroke, (v) => applyStyle({ stroke: v }, "stroke", isL), "Màu đường")),
        row("Độ dày", mkNum(s.strokeWidth ?? 2, 0, 64, 0.5, (v) => applyStyle({ strokeWidth: v }, null, isL))),
        row("Kiểu nét", optGroup(
          ...[["solid", "Liền"], ["dashed", "Đứt"], ["dotted", "Chấm"]].map(([val, lab]) =>
            optBtn(lab, lt === val, () => applyStyle({ lineType: val, strokeDasharray: val === "dashed" ? "8 6" : val === "dotted" ? "2 4" : "" }, null, isL)))
        )),
        ...[["arrowStart", "Mũi tên đầu"], ["arrowEnd", "Mũi tên cuối"]].map(([field, lab]) =>
          row(lab, optGroup(
            ...[["none", "Không"], ["arrow", "Mở"], ["triangle", "Đầy"]].map(([val, lab2]) =>
              optBtn(lab2, (s[field] || "none") === val, () => applyStyle({ [field]: val }, null, isL)))
          ))),
      ));
    }

    /* ---------- Chung ---------- */
    const s0 = e0.style || {};
    stylePanel.append(section("Chung",
      row("Độ mờ", mkNum(s0.opacity ?? 1, 0, 1, 0.05, (v) => applyStyle({ opacity: v }, "opacity"))),
      row("Lớp (z-order)", optGroup(
        optBtn("Lên trên", false, () => { for (const id of selection) doc.zTop(id); history.snapshot("z"); renderAll(); }),
        optBtn("Xuống dưới", false, () => { for (const id of selection) doc.zBottom(id); history.snapshot("z"); renderAll(); }),
      )),
    ));
  }

  function typeLabel(type) {
    const labels = {
      "rectangle": "Hình chữ nhật", "rounded-rectangle": "Bo góc", "ellipse": "Ellipse",
      "diamond": "Diamond", "text": "Text", "note": "Ghi chú", "frame": "Frame",
      "line": "Đường thẳng", "arrow": "Mũi tên", "connector": "Connector", "group": "Nhóm",
    };
    return labels[type] || type;
  }

  /* ============ context menu ============ */

  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const world = view.screenToWorld(e.clientX, e.clientY);
    const hit = hitElement(world);
    if (hit && !selection.has(hit.id)) selection = new Set([hit.id]);
    renderAll();

    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.setAttribute("role", "menu");
    const mkItem = (label, fn, cls = "", icon) => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitem");
      if (icon) b.innerHTML = ICONS[icon];
      const span = document.createElement("span");
      span.textContent = label;
      b.appendChild(span);
      if (cls) b.classList.add(cls);
      b.addEventListener("click", () => { menu.remove(); fn(); });
      return b;
    };
    const sep = () => { const d = document.createElement("div"); d.className = "ctx-sep"; return d; };

    if (selection.size > 0) {
      const title = document.createElement("div");
      title.className = "ctx-title";
      title.textContent = `${selection.size} phần tử được chọn`;
      menu.appendChild(title);
      menu.appendChild(mkItem("Sao chép", copySelection, "", "copy"));
      menu.appendChild(mkItem("Tạo bản sao", duplicateSelection, "", "copy"));
      menu.appendChild(mkItem("Xóa", deleteSelection, "danger", "trash"));
      menu.appendChild(sep());
      if (selected().some(isTextEl)) {
        menu.appendChild(mkItem("Sửa chữ (Enter)", () => { const t = selected().find(isTextEl); if (t) editTextElement(t); }));
      }
      if (selected().some(isRotatable)) {
        menu.appendChild(mkItem("Xoay phải 90°", () => rotateSelectionBy(90)));
        menu.appendChild(mkItem("Xoay trái 90°", () => rotateSelectionBy(-90)));
        if (selected().some((x) => !isLineType(x.type) && x.rotation)) menu.appendChild(mkItem("Đặt lại góc xoay", () => setRotationAbs(0)));
        menu.appendChild(sep());
      }
      menu.appendChild(mkItem("Đưa lên trên", () => { for (const id of selection) doc.zTop(id); history.snapshot("z"); renderAll(); }));
      menu.appendChild(mkItem("Đưa xuống dưới", () => { for (const id of selection) doc.zBottom(id); history.snapshot("z"); renderAll(); }));
    } else {
      menu.appendChild(mkItem("Dán", pasteClipboard, "", "copy"));
    }

    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    document.body.appendChild(menu);
    // Giữ menu trong màn hình
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth) menu.style.left = `${Math.max(4, window.innerWidth - mr.width - 8)}px`;
    if (mr.bottom > window.innerHeight) menu.style.top = `${Math.max(4, window.innerHeight - mr.height - 8)}px`;
    const close = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("pointerdown", close, true); }
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  });

  /* ============ HUD buttons ============ */

  document.getElementById("zoomIn").addEventListener("click", () => view.zoomIn());
  document.getElementById("zoomOut").addEventListener("click", () => view.zoomOut());
  document.getElementById("fitBtn").addEventListener("click", () => view.fit());
  document.getElementById("resetZoom").addEventListener("click", () => view.resetZoom());

  /* ============ autosave draft (client-only) ============ */

  const DRAFT_KEY = `diagram-draft-${diagramId || "new"}`;
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: nameInput.value, data: doc.serialize(), t: Date.now() }));
    } catch { /* full quota — bỏ qua */ }
  }
  setInterval(() => { if (dirty) saveDraft(); }, 8000);
  window.addEventListener("beforeunload", () => { if (dirty) saveDraft(); });

  /* ============ phông tải xong → đo lại chữ ============ */

  FontCatalog.onChange(() => {
    doc.refit();
    if (activeEditor) activeEditor.place();
    requestRender(false);
  });
  window.addEventListener("resize", () => { if (activeEditor) activeEditor.place(); });

  /* ============ init render ============ */

  if (doc.elements.length === 0 && !isEdit) {
    view.panX = host.clientWidth / 2;
    view.panY = host.clientHeight / 2;
    view.applyTransform();
  } else if (savedData?.viewport && (savedData.viewport.x || savedData.viewport.y || savedData.viewport.zoom !== 1)) {
    view.panX = savedData.viewport.x;
    view.panY = savedData.viewport.y;
    view.zoom = savedData.viewport.zoom;
    view.applyTransform();
  } else {
    view.fit();
  }
  document.getElementById("zoomLabel").textContent = Math.round(view.zoom * 100) + "%";
  renderAll();

  // Chỉ ở chế độ development: móc gỡ lỗi / kiểm thử tự động
  if (window.__DIAGRAM__.IS_DEV) window.__EDITOR_DEBUG__ = { doc, history, view, selected, get selection() { return selection; }, setSelection(ids) { selection = new Set(ids); renderAll(); }, renderAll };
})();
