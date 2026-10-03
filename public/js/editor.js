/* Editor page: tools, selection, editing, save, dirty guard */
"use strict";

(async function () {
  const { Api, Toast, UI, Theme, SideMenu, ICONS, user, BOOT } = window.__DIAGRAM__;
  const { DiagramDoc, History, CanvasView, Render, updateConnectorPoints, el, uid, snap, GRID, DEFAULT_STYLES } = window.__DIAGRAM_ENGINE__;

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

  /** Dialog canh bao truoc khi roi editor. */
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
      dirty = false; // cho phep di
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
      if (t.id === "undo") { history.undo(); renderAll(); return; }
      if (t.id === "redo") { history.redo(); renderAll(); return; }
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
    e.stopPropagation(); // tranh trigger shortcut editor
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
          // Cap nhat trang thai local de luu tiep lai la PATCH
          window.location.reload();
        }
        return true;
      }
      Toast.error(res.error?.message || "Không lưu được.");
      return false;
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById("saveBtn").addEventListener("click", save);

  /* ============ render ============ */

  function renderAll() {
    view.content.replaceChildren();
    // Cap nhat connector gan shape truoc
    for (const e of doc.elements) {
      if (e.type === "connector" || ((e.type === "arrow" || e.type === "line") && (e.startId || e.endId))) {
        updateConnectorPoints(doc, e);
      }
    }
    for (const e of doc.elements) {
      const node = Render.element(e);
      if (selection.has(e.id)) node.classList.add("selected");
      view.content.appendChild(node);
    }
    renderOverlay();
    renderStylePanel();
  }

  function renderOverlay() {
    view.overlay.replaceChildren();
    for (const id of selection) {
      const e = doc.byId(id);
      if (!e) continue;
      if (["line", "arrow", "connector"].includes(e.type) && e.points) continue; // khong resize connector
      const s = 8 / view.zoom;
      const r = el("rect", {
        x: e.x - s, y: e.y - s, width: (e.width || 0) + s * 2, height: (e.height || 0) + s * 2,
        fill: "none", stroke: "var(--accent)", "stroke-width": 1.5 / view.zoom, "stroke-dasharray": `${4 / view.zoom} ${3 / view.zoom}`,
        class: "selection-box",
      });
      view.overlay.appendChild(r);
      if (selection.size === 1) {
        const hs = Math.min(10 / view.zoom, (e.width || 20) / 4, (e.height || 20) / 4);
        for (const [hx, hy, cur] of [
          [e.x, e.y, "nw"], [e.x + (e.width || 0), e.y, "ne"],
          [e.x, e.y + (e.height || 0), "sw"], [e.x + (e.width || 0), e.y + (e.height || 0), "se"],
        ]) {
          const h = el("rect", { x: hx - hs / 2, y: hy - hs / 2, width: hs, height: hs, class: `resize-handle ${cur}` });
          view.overlay.appendChild(h);
        }
      }
    }
  }

  let rafPending = false;
  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderAll();
    });
  }

  /* ============ pointer interactions ============ */

  let action = null; // {kind: 'draw'|'move'|'resize'|'marquee'|'connect', ...}

  host.addEventListener("pointerdown", (e) => {
    if (e.button === 1) { view.startPan(e); return; }
    if (e.button !== 0) return;
    if (tool === "hand") { view.startPan(e); return; }

    const world = view.screenToWorld(e.clientX, e.clientY);

    // Resize handle?
    if (handleUnderCursor(e, world)) return;
    // Connector anchor drag?
    if (tryStartConnect(e, world)) return;

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
      requestRender();
      return;
    }

    // Drawing tools
    if (hit && (tool === "connector" || tool === "arrow")) {
      startConnectFromShape(e, world, hit);
      return;
    }
    if (tool === "text") {
      createTextAt(world);
      return;
    }
    startDraw(e, world);
  });

  function handleUnderCursor(_e, world) {
    if (selection.size !== 1) return false;
    const e0 = doc.byId([...selection][0]);
    if (!e0 || ["line", "arrow", "connector"].includes(e0.type)) return false;
    const hs = Math.min(10 / view.zoom, 30);
    const corners = [
      [e0.x, e0.y, "nw"], [e0.x + (e0.width || 0), e0.y, "ne"],
      [e0.x, e0.y + (e0.height || 0), "sw"], [e0.x + (e0.width || 0), e0.y + (e0.height || 0), "se"],
    ];
    for (const [cx, cy, corner] of corners) {
      if (Math.abs(world.x - cx) < hs && Math.abs(world.y - cy) < hs) {
        startResize(e0, corner);
        return true;
      }
    }
    return false;
  }

  function hitElement(world) {
    // Ung cung: duyet nguoc tu tren
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const e = doc.elements[i];
      if (["line", "arrow", "connector"].includes(e.type)) {
        if (e.points && hitPolyline(e.points, world, 10 / view.zoom)) return e;
        continue;
      }
      if (e.type === "text") {
        const w = measureTextWidth(e.text, e.style?.fontSize || 16);
        if (world.x >= e.x - 4 && world.x <= e.x + w + 4 && world.y >= e.y - 4 && world.y <= e.y + (e.style?.fontSize || 16) * 1.3) return e;
        continue;
      }
      const r = doc.hitRect(e);
      if (world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h) return e;
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

  function measureTextWidth(text, fontSize) {
    return (text || "").split("\n").reduce((m, l) => Math.max(m, l.length), 0) * fontSize * 0.55;
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
          // gioi han 0/45/90 do
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
          // click don → shape mac dinh
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
      requestRender();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

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
      if (ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
      }
      if (view.snapEnabled) {
        const first = originals[0];
        const target = doc.byId(first.id);
        if (target) {
          const sx = view.snapEnabled ? snap(first.x + dx) - first.x : dx;
          const sy = view.snapEnabled ? snap(first.y + dy) - first.y : dy;
          dx = sx; dy = sy;
        }
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
      if (moved) history.snapshot("move");
      action = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---- resize ---- */

  function startResize(e0, corner) {
    const origin = { x: e0.x, y: e0.y, w: e0.width || 0, h: e0.height || 0 };
    const id = e0.id;

    const move = (ev) => {
      const w = view.screenToWorld(ev.clientX, ev.clientY);
      let nx = origin.x, ny = origin.y, nw = origin.w, nh = origin.h;
      const px = view.snapEnabled ? snap(w.x) : w.x;
      const py = view.snapEnabled ? snap(w.y) : w.y;
      if (corner.includes("e")) { nw = px - origin.x; }
      if (corner.includes("s")) { nh = py - origin.y; }
      if (corner.includes("w")) { nx = px; nw = origin.x + origin.w - px; }
      if (corner.includes("n")) { ny = py; nh = origin.y + origin.h - py; }
      nw = Math.max(8, nw); nh = Math.max(8, nh);
      const el0 = doc.byId(id);
      if (el0) {
        el0.x = nx; el0.y = ny; el0.width = nw; el0.height = nh;
        requestRender();
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      history.snapshot("resize");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
          requestRender();
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---- connectors ---- */

  function tryStartConnect(_e, world) {
    if (tool !== "connector" && tool !== "arrow") return false;
    // diem cuoi connector dang chon co the drag — xu o startConnectFromShape
    return false;
  }

  function startConnectFromShape(e, world, hitShape) {
    if (["line", "arrow", "connector", "text"].includes(hitShape.type)) return;
    const id = uid();
    const shape = {
      id, type: tool, x: world.x, y: world.y,
      points: [[...anchorPointOf(hitShape, world)], [world.x, world.y]],
      style: { ...DEFAULT_STYLES[tool] },
      startId: hitShape.id,
      startSide: nearestSide(hitShape, world),
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
        updateConnectorPoints(doc, sh);
        sh.points[sh.points.length - 1] = [...anchorPointOf(target, w)];
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
        // Khong gan duoc → xoa
        if (sh) doc.remove([id]);
        selection.clear();
      } else {
        history.snapshot("connect");
      }
      action = null;
      requestRender();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function anchorPointOf(shape, world) {
    return anchorPointLocal(shape, nearestSide(shape, world));
  }
  function anchorPointLocal(shape, side) {
    const w = shape.width || 0, h = shape.height || 0;
    switch (side) {
      case "top": return [shape.x + w / 2, shape.y];
      case "bottom": return [shape.x + w / 2, shape.y + h];
      case "left": return [shape.x, shape.y + h / 2];
      case "right": return [shape.x + w, shape.y + h / 2];
    }
    return [shape.x, shape.y];
  }
  function nearestSide(shape, world) {
    const cx = shape.x + (shape.width || 0) / 2;
    const cy = shape.y + (shape.height || 0) / 2;
    const dx = world.x - cx, dy = world.y - cy;
    return Math.abs(dx) * (shape.height || 1) > Math.abs(dy) * (shape.width || 1)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "bottom" : "top");
  }

  /* ---- text editing ---- */

  function createTextAt(world) {
    const id = uid();
    const e = { id, type: "text", x: world.x, y: world.y, text: "", style: { ...DEFAULT_STYLES.text } };
    doc.add(e);
    selection = new Set([id]);
    renderAll();
    editTextElement(e);
    setTool("select");
  }

  function editTextElement(e) {
    // overlay textarea tai vi tri element
    const textarea = document.createElement("textarea");
    textarea.className = "text-editor-overlay";
    const fs = e.style?.fontSize || 16;
    const scale = view.zoom;
    textarea.style.left = `${e.x * scale + view.panX}px`;
    textarea.style.top = `${e.y * scale + view.panY}px`;
    textarea.style.fontSize = `${fs * scale}px`;
    textarea.style.fontFamily = "Segoe UI, system-ui, sans-serif";
    textarea.style.color = e.style?.textColor || "var(--text)";
    textarea.style.minWidth = `${120 * scale}px`;
    textarea.value = e.text || "";
    host.appendChild(textarea);
    textarea.focus();

    const finish = () => {
      e.text = textarea.value;
      textarea.remove();
      if (!e.text) {
        doc.remove([e.id]);
        selection.delete(e.id);
      } else {
        history.snapshot("text");
      }
      requestRender();
    };
    textarea.addEventListener("blur", finish);
    textarea.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        textarea.value = e.text || "";
        textarea.removeEventListener("blur", finish);
        textarea.remove();
        if (!e.text) { doc.remove([e.id]); }
        requestRender();
      }
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        textarea.blur();
      }
    });
  }

  // Double click vao element de edit text
  host.addEventListener("dblclick", (e) => {
    const world = view.screenToWorld(e.clientX, e.clientY);
    const hit = hitElement(world);
    if (!hit) return;
    if (["line", "arrow", "connector"].includes(hit.type)) return;
    if (hit.type === "text") { editTextElement(hit); return; }
    // them label cho shape
    editTextElement(hit);
  });

  /* ============ keyboard shortcuts ============ */

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) { history.redo(); } else { history.undo(); }
      renderAll();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      history.redo();
      renderAll();
      return;
    }
    if (mod && key === "s") {
      e.preventDefault();
      save();
      return;
    }
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
    if (e.key.startsWith("Arrow") && selection.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : GRID;
      for (const id of selection) {
        const el0 = doc.byId(id);
        if (!el0) continue;
        if (e.key === "ArrowLeft") el0.x -= step;
        if (e.key === "ArrowRight") el0.x += step;
        if (e.key === "ArrowUp") el0.y -= step;
        if (e.key === "ArrowDown") el0.y += step;
      }
      history.snapshot("nudge");
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
    return [...selection].map((id) => doc.byId(id)).filter(Boolean).map((e) => JSON.parse(JSON.stringify(e)));
  }

  function copySelection() {
    if (selection.size === 0) return;
    clipboard = serializeSelection();
    Toast.ok(`Đã sao chép ${clipboard.length} phần tử.`);
  }

  function pasteClipboard() {
    if (!clipboard || clipboard.length === 0) return;
    history.snapshot("paste-before");
    const map = {};
    for (const item of clipboard) {
      const copy = JSON.parse(JSON.stringify(item));
      copy.id = uid();
      map[item.id] = copy.id;
      copy.x += GRID * 2;
      copy.y += GRID * 2;
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
    // tinh bounds
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

  function renderStylePanel() {
    const sel = [...selection].map((id) => doc.byId(id)).filter(Boolean);
    if (sel.length === 0) {
      stylePanel.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "panel-empty";
      empty.textContent = "Chọn một phần tử để chỉnh kiểu.";
      stylePanel.appendChild(empty);
      return;
    }
    const e = sel[0];
    const s = e.style || {};
    const isLine = ["line", "arrow", "connector"].includes(e.type);

    stylePanel.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = sel.length > 1 ? `${sel.length} phần tử` : typeLabel(e.type);
    stylePanel.appendChild(title);

    const mkRow = (labelText, input) => {
      const row = document.createElement("div");
      row.className = "style-row";
      const label = document.createElement("label");
      label.textContent = labelText;
      row.appendChild(label);
      row.appendChild(input);
      stylePanel.appendChild(row);
      return row;
    };
    const mkColor = (value, onInput) => {
      const input = document.createElement("input");
      input.type = "color";
      input.className = "style-input";
      input.value = normalizeColor(value) || "#000000";
      input.addEventListener("input", () => onInput(input.value));
      return input;
    };
    const mkNumber = (value, min, max, step, onInput) => {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "style-input";
      input.value = value;
      input.min = min; input.max = max; input.step = step;
      input.addEventListener("input", () => onInput(+input.value));
      return input;
    };

    const applyStyle = (patch, snapshotLabel) => {
      for (const item of sel) {
        item.style = { ...(item.style || {}), ...patch };
      }
      history.snapshot(snapshotLabel);
      renderAll();
    };

    if (!isLine) {
      mkRow("Fill", mkColor(s.fill, (v) => applyStyle({ fill: v }, "style")));
      const row = document.createElement("div");
      row.className = "style-row";
      const lab = document.createElement("label");
      lab.textContent = "Border";
      row.appendChild(lab);
      const cols = document.createElement("div");
      cols.className = "style-cols";
      cols.appendChild(mkColor(s.stroke, (v) => applyStyle({ stroke: v }, "style")));
      cols.appendChild(mkNumber(s.strokeWidth ?? 1.5, 0, 64, 0.5, (v) => applyStyle({ strokeWidth: v }, "style")));
      row.appendChild(cols);
      stylePanel.appendChild(row);
      if (["rectangle", "rounded-rectangle", "note", "frame"].includes(e.type)) {
        mkRow("Bo góc", mkNumber(s.radius ?? 0, 0, 512, 1, (v) => applyStyle({ radius: v }, "style")));
      }
      mkRow("Cỡ chữ", mkNumber(s.fontSize ?? 15, 6, 200, 1, (v) => applyStyle({ fontSize: v }, "style")));
    } else {
      mkRow("Màu đường", mkColor(s.stroke, (v) => applyStyle({ stroke: v }, "style")));
      mkRow("Độ dày", mkNumber(s.strokeWidth ?? 2, 0, 64, 0.5, (v) => applyStyle({ strokeWidth: v }, "style")));
      const row = document.createElement("div");
      row.className = "style-row";
      const lab = document.createElement("label");
      lab.textContent = "Kiểu nét";
      row.appendChild(lab);
      const opts = document.createElement("div");
      opts.className = "style-opts";
      const lineTypes = [["solid", "Liền"], ["dashed", "Đứt"], ["dotted", "Chấm"]];
      for (const [val, lab2] of lineTypes) {
        const b = document.createElement("button");
        b.className = "style-opt" + ((s.lineType || "solid") === val ? " active" : "");
        b.textContent = lab2;
        b.addEventListener("click", () => applyStyle({ lineType: val, strokeDasharray: val === "dashed" ? "8 6" : val === "dotted" ? "2 4" : "" }, "style"));
        opts.appendChild(b);
      }
      row.appendChild(opts);
      stylePanel.appendChild(row);
      // arrows
      for (const [field, lab2] of [["arrowStart", "Đầu"], ["arrowEnd", "Cuối"]]) {
        const row2 = document.createElement("div");
        row2.className = "style-row";
        const l2 = document.createElement("label");
        l2.textContent = `Mũi tên ${lab2.toLowerCase()}`;
        row2.appendChild(l2);
        const opts2 = document.createElement("div");
        opts2.className = "style-opts";
        for (const [val, lab3] of [["none", "Không"], ["arrow", "Mở"], ["triangle", "Đầy"]]) {
          const b = document.createElement("button");
          b.className = "style-opt" + ((s[field] || "none") === val ? " active" : "");
          b.textContent = lab3;
          b.addEventListener("click", () => applyStyle({ [field]: val }, "style"));
          opts2.appendChild(b);
        }
        row2.appendChild(opts2);
        stylePanel.appendChild(row2);
      }
    }

    // opacity + text chung
    mkRow("Độ mờ", mkNumber(s.opacity ?? 1, 0, 1, 0.05, (v) => applyStyle({ opacity: v }, "style")));

    if (!isLine) {
      const rowT = document.createElement("div");
      rowT.className = "style-row";
      const labT = document.createElement("label");
      labT.textContent = "Màu chữ";
      rowT.appendChild(labT);
      rowT.appendChild(mkColor(s.textColor, (v) => applyStyle({ textColor: v }, "style")));
      stylePanel.appendChild(rowT);

      const rowA = document.createElement("div");
      rowA.className = "style-row";
      const labA = document.createElement("label");
      labA.textContent = "Căn lề";
      rowA.appendChild(labA);
      const optsA = document.createElement("div");
      optsA.className = "style-opts";
      for (const [val, lab2] of [["left", "Trái"], ["center", "Giữa"], ["right", "Phải"]]) {
        const b = document.createElement("button");
        b.className = "style-opt" + ((s.textAlign || "center") === val ? " active" : "");
        b.textContent = lab2;
        b.addEventListener("click", () => applyStyle({ textAlign: val }, "style"));
        optsA.appendChild(b);
      }
      rowA.appendChild(optsA);
      stylePanel.appendChild(rowA);

      const rowF = document.createElement("div");
      rowF.className = "style-row";
      const labF = document.createElement("label");
      labF.textContent = "Kiểu chữ";
      rowF.appendChild(labF);
      const optsF = document.createElement("div");
      optsF.className = "style-opts";
      const wBtn = document.createElement("button");
      wBtn.className = "style-opt" + (s.fontWeight === "bold" ? " active" : "");
      wBtn.textContent = "Đậm";
      wBtn.addEventListener("click", () => applyStyle({ fontWeight: s.fontWeight === "bold" ? "normal" : "bold" }, "style"));
      const iBtn = document.createElement("button");
      iBtn.className = "style-opt" + (s.fontStyle === "italic" ? " active" : "");
      iBtn.textContent = "Nghiêng";
      iBtn.addEventListener("click", () => applyStyle({ fontStyle: s.fontStyle === "italic" ? "normal" : "italic" }, "style"));
      optsF.append(wBtn, iBtn);
      rowF.appendChild(optsF);
      stylePanel.appendChild(rowF);
    }

    // layer actions
    const layerRow = document.createElement("div");
    layerRow.className = "style-row";
    const labL = document.createElement("label");
    labL.textContent = "Lớp (z-order)";
    layerRow.appendChild(labL);
    const btns = document.createElement("div");
    btns.className = "style-opts";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.className = "style-opt";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    btns.append(
      mk("Lên trên", () => { for (const id of selection) doc.zTop(id); history.snapshot("z"); renderAll(); }),
      mk("Xuống dưới", () => { for (const id of selection) doc.zBottom(id); history.snapshot("z"); renderAll(); }),
    );
    layerRow.appendChild(btns);
    stylePanel.appendChild(layerRow);
  }

  function typeLabel(type) {
    const labels = {
      "rectangle": "Hình chữ nhật", "rounded-rectangle": "Bo góc", "ellipse": "Ellipse",
      "diamond": "Diamond", "text": "Text", "note": "Ghi chú", "frame": "Frame",
      "line": "Đường thẳng", "arrow": "Mũi tên", "connector": "Connector", "group": "Nhóm",
    };
    return labels[type] || type;
  }

  function normalizeColor(c) {
    if (!c) return null;
    // CSS ten mau → hex de hien color picker
    const named = { "#eef2ff": "#eef2ff" };
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    return "#eef2ff" in named ? c : null;
  }

  /* ============ context menu ============ */

  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const world = view.screenToWorld(e.clientX, e.clientY);
    const hit = hitElement(world);
    if (hit && !selection.has(hit.id)) selection = new Set([hit.id]);
    if (!hit && selection.size > 0) { /* giu selection */ }
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

    if (selection.size > 0) {
      const title = document.createElement("div");
      title.className = "ctx-title";
      title.textContent = `${selection.size} phần tử được chọn`;
      menu.appendChild(title);
      menu.appendChild(mkItem("Sao chép", copySelection, "", "copy"));
      menu.appendChild(mkItem("Tạo bản sao", duplicateSelection, "", "copy"));
      menu.appendChild(mkItem("Xóa", deleteSelection, "danger", "trash"));
      menu.appendChild(document.createElement("div")).className = "ctx-sep";
      menu.appendChild(mkItem("Đưa lên trên", () => { for (const id of selection) doc.zTop(id); history.snapshot("z"); renderAll(); }));
      menu.appendChild(mkItem("Đưa xuống dưới", () => { for (const id of selection) doc.zBottom(id); history.snapshot("z"); renderAll(); }));
    } else {
      menu.appendChild(mkItem("Dán", pasteClipboard, "", "copy"));
    }

    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    document.body.appendChild(menu);
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
    } catch { /* full quota — bo qua */ }
  }
  setInterval(() => { if (dirty) saveDraft(); }, 8000);
  window.addEventListener("beforeunload", () => { if (dirty) saveDraft(); });

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
})();
