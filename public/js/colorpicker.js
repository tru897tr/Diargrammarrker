/* Bảng chọn màu riêng của Diagram (không dùng <input type="color"> của trình duyệt).
 *  - Vùng chọn độ đậm/sáng + thanh sắc độ + thanh độ trong suốt
 *  - Ô nhập mã: HEX (3/4/6/8 số, có hoặc không có #), RGB, HSL, và tên màu CSS (vd tomato, rebeccapurple)
 *  - Ống nhỏ giọt (nếu trình duyệt hỗ trợ), "Không màu", bảng màu có sẵn, màu đang dùng trong sơ đồ, màu gần đây
 * API:
 *    ColorPicker.field({ value, allowNone, onChange(value), label }) → phần tử (ô màu + ô nhập mã) dùng trong panel
 *    ColorPicker.open({ anchor, value, allowNone, onChange(value), getDocColors() }) → mở bảng
 */
(function () {
"use strict";
const { Color, clamp, round } = window.__DIAGRAM_ENGINE__;

const RECENT_KEY = "diagram-recent-colors";
const PALETTE = [
  ["#ffffff", "#f1f5f9", "#cbd5e1", "#94a3b8", "#64748b", "#334155", "#0f172a", "#000000"],
  ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899"],
  ["#fee2e2", "#ffedd5", "#fef3c7", "#fef9c3", "#ecfccb", "#dcfce7", "#d1fae5", "#ccfbf1", "#cffafe", "#e0f2fe", "#dbeafe", "#e0e7ff", "#ede9fe", "#f3e8ff", "#fae8ff", "#fce7f3"],
];

function loadRecent() {
  try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? a.filter((c) => Color.parse(c)).slice(0, 12) : []; } catch { return []; }
}
function pushRecent(hex) {
  if (!hex || hex === "none") return;
  const list = loadRecent().filter((c) => c.toLowerCase() !== hex.toLowerCase());
  list.unshift(hex);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* bỏ qua */ }
}

function h(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
function swatchCss(value) {
  const c = Color.parse(value);
  if (!c || c.a === 0) return null;
  return `rgba(${c.r},${c.g},${c.b},${c.a})`;
}
function paintSwatch(node, value) {
  const css = swatchCss(value);
  node.classList.toggle("is-none", !css);
  node.style.setProperty("--sw", css || "transparent");
}

/* ---- kéo thả trong một vùng (pointer capture) ---- */
function drag(node, onMove, onEnd) {
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    node.focus({ preventScroll: true });
    const rect = () => node.getBoundingClientRect();
    const go = (ev) => {
      const r = rect();
      onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    };
    go(e);
    const mv = (ev) => go(ev);
    const up = (ev) => {
      node.removeEventListener("pointermove", mv);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      onEnd?.(ev);
    };
    node.addEventListener("pointermove", mv);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  });
}

let active = null; // popover đang mở

function close() {
  if (!active) return;
  const a = active; active = null;
  document.removeEventListener("pointerdown", a.onDocDown, true);
  document.removeEventListener("keydown", a.onKey, true);
  window.removeEventListener("resize", a.onResize);
  a.root.remove();
  a.anchor?.setAttribute("aria-expanded", "false");
  a.onClose?.();
}

function open(opts) {
  close();
  const { anchor, allowNone = true, allowAlpha = true, onChange, getDocColors } = opts;
  const initial = Color.parse(opts.value) || { r: 79, g: 70, b: 229, a: 1 };
  const startValue = opts.value;

  // trạng thái: HSV + alpha (giữ hue khi s=0 hoặc v=0 để không nhảy)
  const hsv0 = Color.rgbToHsv(initial.r, initial.g, initial.b);
  const st = { h: hsv0.h, s: hsv0.s, v: hsv0.v, a: initial.a === 0 && opts.value === "none" ? 1 : initial.a, none: Color.isNone(opts.value) };
  const rgb = () => Color.hsvToRgb(st.h, st.s, st.v);
  const currentValue = () => {
    if (st.none) return "none";
    const c = rgb();
    return Color.toHex({ ...c, a: allowAlpha ? round(st.a, 3) : 1 });
  };

  const root = h("div", "cp-pop", { role: "dialog", "aria-label": opts.title || "Chọn màu" });
  const sv = h("div", "cp-sv", { tabindex: "0", role: "slider", "aria-label": "Độ đậm và độ sáng" });
  const svThumb = h("div", "cp-thumb"); sv.appendChild(svThumb);
  const hue = h("div", "cp-slider cp-hue", { tabindex: "0", role: "slider", "aria-label": "Sắc độ", "aria-valuemin": "0", "aria-valuemax": "360" });
  const hueThumb = h("div", "cp-thumb"); hue.appendChild(hueThumb);
  const alpha = h("div", "cp-slider cp-alpha", { tabindex: "0", role: "slider", "aria-label": "Độ trong suốt", "aria-valuemin": "0", "aria-valuemax": "100" });
  const alphaFill = h("div", "cp-alpha-fill"); const alphaThumb = h("div", "cp-thumb"); alpha.append(alphaFill, alphaThumb);

  // hàng: xem trước + công cụ
  const top = h("div", "cp-top");
  const prev = h("div", "cp-prev");
  const prevOld = h("span", "cp-prev-old"), prevNew = h("span", "cp-prev-new");
  prev.append(prevOld, prevNew);
  prevOld.title = "Màu ban đầu (bấm để quay lại)";
  const sliders = h("div", "cp-sliders"); sliders.append(hue, alpha);
  top.append(prev, sliders);
  if ("EyeDropper" in window) {
    const eye = h("button", "cp-tool", { type: "button", "aria-label": "Lấy màu từ màn hình", title: "Lấy màu từ màn hình" });
    eye.innerHTML = window.__DIAGRAM__.ICONS.eyedropper || "";
    eye.addEventListener("click", async () => {
      try {
        const r = await new window.EyeDropper().open();
        setFromValue(r.sRGBHex, true);
      } catch { /* người dùng hủy */ }
    });
    top.appendChild(eye);
  }

  // ô nhập
  const fields = h("div", "cp-fields");
  const mkInput = (label, w, max) => {
    const wrap = h("label", "cp-in");
    const span = h("span"); span.textContent = label;
    const inp = h("input", "cp-input", { spellcheck: "false", autocomplete: "off", inputmode: max ? "numeric" : "text" });
    if (w) inp.style.width = w;
    wrap.append(inp, span);
    return { wrap, inp };
  };
  const hexF = mkInput("HEX / tên màu"); hexF.wrap.classList.add("cp-hex");
  const rF = mkInput("R"), gF = mkInput("G"), bF = mkInput("B"), aF = mkInput("A %");
  const hF = mkInput("H"), sF = mkInput("S %"), lF = mkInput("L %");
  const rowHex = h("div", "cp-row"); rowHex.appendChild(hexF.wrap);
  const rowRgb = h("div", "cp-row cp-row4"); rowRgb.append(rF.wrap, gF.wrap, bF.wrap, aF.wrap);
  const rowHsl = h("div", "cp-row cp-row4"); rowHsl.append(hF.wrap, sF.wrap, lF.wrap);
  fields.append(rowHex, rowRgb, rowHsl);
  if (!allowAlpha) aF.wrap.style.visibility = "hidden";

  const body = h("div", "cp-body");
  body.append(sv, top, fields);
  root.appendChild(body);

  // nút không màu
  if (allowNone) {
    const none = h("button", "cp-none", { type: "button" });
    none.innerHTML = '<span class="cp-none-sw"></span><span>Không màu (trong suốt)</span>';
    none.addEventListener("click", () => { st.none = true; sync("none"); emit(true); });
    root.appendChild(none);
  }

  // bảng màu
  const sections = h("div", "cp-sections");
  root.appendChild(sections);
  const addSection = (title, colors) => {
    if (!colors.length) return;
    const sec = h("div", "cp-sec");
    const t = h("div", "cp-sec-title"); t.textContent = title;
    const grid = h("div", "cp-grid");
    for (const c of colors) {
      const b = h("button", "cp-chip", { type: "button", "aria-label": c, title: c });
      paintSwatch(b, c);
      b.addEventListener("click", () => setFromValue(c, true));
      grid.appendChild(b);
    }
    sec.append(t, grid);
    sections.appendChild(sec);
  };
  function buildSections() {
    sections.replaceChildren();
    let docColors = [];
    try { docColors = (getDocColors?.() || []).slice(0, 16); } catch { /* bỏ qua */ }
    addSection("Đang dùng trong sơ đồ", docColors);
    addSection("Gần đây", loadRecent());
    PALETTE.forEach((row, i) => addSection(i === 0 ? "Bảng màu" : "", row));
    sections.querySelectorAll(".cp-sec-title").forEach((t) => { if (!t.textContent) t.remove(); });
  }
  buildSections();

  /* ---- đồng bộ giao diện theo trạng thái ---- */
  let silent = false;
  function sync(skip) {
    const c = rgb();
    const hex = Color.toHex({ ...c, a: allowAlpha ? st.a : 1 });
    const base = `rgb(${c.r},${c.g},${c.b})`;
    sv.style.setProperty("--hue", `hsl(${st.h},100%,50%)`);
    svThumb.style.left = st.s * 100 + "%";
    svThumb.style.top = (1 - st.v) * 100 + "%";
    svThumb.style.setProperty("--c", base);
    hueThumb.style.left = (st.h / 360) * 100 + "%";
    hueThumb.style.setProperty("--c", `hsl(${st.h},100%,50%)`);
    hue.setAttribute("aria-valuenow", String(Math.round(st.h)));
    alpha.style.setProperty("--base", base);
    alphaThumb.style.left = st.a * 100 + "%";
    alpha.setAttribute("aria-valuenow", String(Math.round(st.a * 100)));
    alpha.style.display = allowAlpha ? "" : "none";
    paintSwatch(prevNew, st.none ? "none" : hex);
    paintSwatch(prevOld, startValue);
    root.classList.toggle("is-none", st.none);
    const set = (f, v) => { if (skip !== f && document.activeElement !== f.inp) f.inp.value = v; f.inp.classList.remove("bad"); };
    const hsl = Color.rgbToHsl(c.r, c.g, c.b);
    set(hexF, st.none ? "none" : hex.toUpperCase());
    set(rF, c.r); set(gF, c.g); set(bF, c.b); set(aF, Math.round(st.a * 100));
    set(hF, hsl.h); set(sF, hsl.s); set(lF, hsl.l);
  }
  function emit(commit) {
    if (silent) return;
    const v = currentValue();
    onChange?.(v, { commit });
    if (commit && v !== "none") pushRecent(v);
  }
  function setFromValue(val, commit) {
    const c = Color.parse(val);
    if (!c) return false;
    if (c.a === 0) { st.none = true; sync(); emit(commit); return true; }
    const hv = Color.rgbToHsv(c.r, c.g, c.b);
    st.none = false;
    if (hv.s > 0 && hv.v > 0) st.h = hv.h;
    st.s = hv.s; st.v = hv.v; st.a = allowAlpha ? c.a : 1;
    sync(); emit(commit);
    return true;
  }

  /* ---- tương tác ---- */
  const touch = () => { st.none = false; };
  drag(sv, (x, y) => { touch(); st.s = x; st.v = 1 - y; sync(); emit(false); }, () => emit(true));
  drag(hue, (x) => { touch(); st.h = x * 360; sync(); emit(false); }, () => emit(true));
  drag(alpha, (x) => { touch(); st.a = round(x, 2); sync(); emit(false); }, () => emit(true));
  const keyStep = (e) => (e.shiftKey ? 10 : 1);
  sv.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!k) return; e.preventDefault(); touch();
    st.s = clamp(st.s + (k[0] * keyStep(e)) / 100, 0, 1); st.v = clamp(st.v + (k[1] * keyStep(e)) / 100, 0, 1);
    sync(); emit(true);
  });
  hue.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!d) return; e.preventDefault(); touch(); st.h = (st.h + d * keyStep(e) * 3 + 360) % 360; sync(); emit(true);
  });
  alpha.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!d) return; e.preventDefault(); touch(); st.a = clamp(st.a + (d * keyStep(e)) / 100, 0, 1); sync(); emit(true);
  });
  prevOld.addEventListener("click", () => { setFromValue(startValue === "none" || !startValue ? "none" : startValue, true); });

  // Ô nhập: áp dụng ngay khi hợp lệ, chuẩn hóa khi rời ô / nhấn Enter
  const bind = (f, apply) => {
    const run = (commit) => {
      const ok = apply(f.inp.value.trim());
      f.inp.classList.toggle("bad", !ok);
      if (ok && commit) { f.inp.classList.remove("bad"); sync(); }
      return ok;
    };
    f.inp.addEventListener("input", () => run(false));
    f.inp.addEventListener("change", () => { if (!run(true)) sync(); });
    f.inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); if (run(true)) emit(true); else sync(); f.inp.blur(); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (f.wrap === hexF.wrap) return;
        e.preventDefault();
        const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
        const n = parseFloat(f.inp.value) || 0; f.inp.value = String(n + d); run(true); emit(false);
      }
    });
    f.inp.addEventListener("blur", () => { f.inp.classList.remove("bad"); sync(); emit(true); });
    f.inp.addEventListener("focus", () => f.inp.select());
  };
  bind(hexF, (v) => {
    if (!v) return false;
    const c = Color.parse(v);
    if (!c) return false;
    if (!allowNone && c.a === 0) return false;
    if (c.a === 0) { st.none = true; emit(false); return true; }
    const hv = Color.rgbToHsv(c.r, c.g, c.b);
    st.none = false; if (hv.s > 0 && hv.v > 0) st.h = hv.h; st.s = hv.s; st.v = hv.v; st.a = allowAlpha ? c.a : 1;
    sync(hexF); emit(false);
    return true;
  });
  const chan = (idx) => (v) => {
    if (!/^\d{1,3}$/.test(v)) return false;
    const c = rgb(); const arr = [c.r, c.g, c.b]; arr[idx] = clamp(+v, 0, 255);
    const hv = Color.rgbToHsv(arr[0], arr[1], arr[2]);
    st.none = false; if (hv.s > 0 && hv.v > 0) st.h = hv.h; st.s = hv.s; st.v = hv.v;
    sync(idx === 0 ? rF : idx === 1 ? gF : bF); emit(false); return true;
  };
  bind(rF, chan(0)); bind(gF, chan(1)); bind(bF, chan(2));
  bind(aF, (v) => { if (!/^\d{1,3}$/.test(v)) return false; st.none = false; st.a = clamp(+v, 0, 100) / 100; sync(aF); emit(false); return true; });
  const hslApply = (v, which) => {
    if (!/^\d{1,3}$/.test(v)) return false;
    const c = rgb(); const hsl = Color.rgbToHsl(c.r, c.g, c.b);
    const next = { ...hsl, [which]: clamp(+v, 0, which === "h" ? 360 : 100) };
    const rgbN = Color.hslToRgb(next.h, next.s, next.l);
    const hv = Color.rgbToHsv(rgbN.r, rgbN.g, rgbN.b);
    st.none = false; st.h = which === "h" ? next.h : (hv.s > 0 && hv.v > 0 ? hv.h : st.h); st.s = hv.s; st.v = hv.v;
    sync(which === "h" ? hF : which === "s" ? sF : lF); emit(false); return true;
  };
  bind(hF, (v) => hslApply(v, "h")); bind(sF, (v) => hslApply(v, "s")); bind(lF, (v) => hslApply(v, "l"));

  /* ---- đặt vị trí ---- */
  document.body.appendChild(root);
  function place() {
    const small = window.innerWidth < 640;
    root.classList.toggle("is-sheet", small);
    if (small) { root.style.left = root.style.top = ""; return; }
    const r = anchor.getBoundingClientRect();
    const pw = root.offsetWidth, ph = root.offsetHeight;
    let x = r.left - pw - 12;
    if (x < 8) x = Math.min(window.innerWidth - pw - 8, r.right + 12);
    if (x < 8) x = 8;
    let y = r.top - 8;
    y = clamp(y, 8, Math.max(8, window.innerHeight - ph - 8));
    root.style.left = x + "px"; root.style.top = y + "px";
  }
  place();
  sync();

  const onDocDown = (e) => { if (!root.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); anchor?.focus?.(); } };
  const onResize = () => place();
  document.addEventListener("pointerdown", onDocDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  anchor?.setAttribute("aria-expanded", "true");
  active = { root, anchor, onDocDown, onKey, onResize, onClose: opts.onClose };
  requestAnimationFrame(() => { root.classList.add("open"); (hexF.inp).focus({ preventScroll: true }); hexF.inp.select(); });
  return { close, set: (v) => { silent = true; setFromValue(v, false); silent = false; } };
}

/** Ô màu dùng trong panel: nút ô màu (mở bảng) + ô nhập mã nhanh. */
function field({ value, allowNone = true, allowAlpha = true, onChange, getDocColors, label = "Màu" }) {
  const wrap = h("div", "color-field");
  const sw = h("button", "color-swatch", { type: "button", "aria-label": `${label}: mở bảng chọn màu`, "aria-haspopup": "dialog", "aria-expanded": "false" });
  const inp = h("input", "color-hex", { spellcheck: "false", autocomplete: "off", "aria-label": `${label} (nhập mã màu)`, placeholder: "#RRGGBB" });
  wrap.append(sw, inp);
  let cur = value;
  const show = (v) => { cur = v; paintSwatch(sw, v); if (document.activeElement !== inp) inp.value = Color.isNone(v) ? "none" : Color.toHex(Color.parse(v)).toUpperCase(); };
  show(value);

  sw.addEventListener("click", () => {
    if (active && active.anchor === sw) { close(); return; }
    open({
      anchor: sw, value: cur, allowNone, allowAlpha, getDocColors, title: label,
      onChange: (v, meta) => { show(v); onChange?.(v, meta); },
    });
  });
  const tryApply = (commit) => {
    const raw = inp.value.trim();
    const c = Color.parse(raw);
    if (!c || (!allowNone && c.a === 0)) { inp.classList.add("bad"); return false; }
    inp.classList.remove("bad");
    const v = c.a === 0 ? "none" : Color.toHex(c);
    paintSwatch(sw, v); cur = v;
    onChange?.(v, { commit });
    if (commit && v !== "none") pushRecent(v);
    return true;
  };
  inp.addEventListener("input", () => tryApply(false));
  inp.addEventListener("change", () => { if (tryApply(true)) show(cur); });
  inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
  inp.addEventListener("blur", () => { inp.classList.remove("bad"); show(cur); });
  inp.addEventListener("focus", () => inp.select());
  wrap.setValue = (v) => { if (document.activeElement !== inp || v !== cur) show(v); };
  return wrap;
}

window.__DIAGRAM_COLORPICKER__ = { open, close, field, isOpen: () => !!active };
})();
