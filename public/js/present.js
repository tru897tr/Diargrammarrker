/* Chế độ trình chiếu (toàn màn hình) dùng cho trang chia sẻ và trình soạn thảo.
 * - Dùng Fullscreen API; nếu trình duyệt không hỗ trợ (vd iPhone) thì phóng đầy cửa sổ bằng CSS.
 * - Vẫn thu/phóng, kéo di chuyển; bấm vào video/nhúng để tương tác.
 * - Thanh điều khiển nổi tự ẩn khi không di chuột.
 */
(function () {
"use strict";
const { ICONS } = window.__DIAGRAM__;

const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canFullscreen = (node) => !!(node.requestFullscreen || node.webkitRequestFullscreen);

/**
 * Present.create({ container, view, onEnter, onExit, canvasHost })
 *   container: phần tử sẽ được đưa lên toàn màn hình (bao cả canvas + thanh điều khiển)
 *   view: CanvasView đang hiển thị sơ đồ
 */
function create({ container, view, onEnter, onExit }) {
  let active = false;
  let saved = null;
  let hideTimer = null;
  let pseudo = false;

  const bar = document.createElement("div");
  bar.className = "present-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Điều khiển trình chiếu");
  const btn = (icon, label, fn, cls = "") => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "present-btn " + cls;
    b.setAttribute("aria-label", label); b.title = label;
    b.innerHTML = icon;
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "present-zoom";
  zoomLabel.textContent = "100%";
  const exit = btn(ICONS.exitFullscreen, "Thoát trình chiếu (Esc)", () => stop(), "present-exit");
  const exitText = document.createElement("span"); exitText.textContent = "Thoát";
  exit.appendChild(exitText);
  bar.append(
    btn(ICONS.zoomOut, "Thu nhỏ (−)", () => view.zoomOut()),
    zoomLabel,
    btn(ICONS.zoomIn, "Phóng to (+)", () => view.zoomIn()),
    btn(ICONS.fit, "Vừa khung hình (0)", () => view.fit()),
    exit
  );
  container.appendChild(bar);

  const hint = document.createElement("div");
  hint.className = "present-hint";
  hint.textContent = "Cuộn chuột hoặc chụm hai ngón để thu phóng · kéo để di chuyển · bấm vào video để phát · Esc để thoát";
  container.appendChild(hint);

  const prevOnZoom = view.opts.onZoom;
  view.opts.onZoom = (z) => { prevOnZoom?.(z); zoomLabel.textContent = Math.round(z * 100) + "%"; };

  function wake() {
    container.classList.remove("present-idle");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (active) container.classList.add("present-idle"); }, 2600);
  }
  function refit(delay) { setTimeout(() => { if (active) view.fit(undefined, 48); }, delay); }

  function onKey(e) {
    if (!active) return;
    if (e.target && e.target.matches && e.target.matches("input, textarea, select")) return;
    const k = e.key;
    if (k === "Escape" && pseudo) { e.preventDefault(); stop(); return; }
    if (k === "+" || k === "=") { e.preventDefault(); view.zoomIn(); }
    else if (k === "-" || k === "_") { e.preventDefault(); view.zoomOut(); }
    else if (k === "0") { e.preventDefault(); view.fit(undefined, 48); }
    else if (k === "1") { e.preventDefault(); view.resetZoom(); }
    else if (k.startsWith("Arrow")) {
      e.preventDefault();
      const d = e.shiftKey ? 240 : 80;
      if (k === "ArrowLeft") view.panX += d; if (k === "ArrowRight") view.panX -= d;
      if (k === "ArrowUp") view.panY += d; if (k === "ArrowDown") view.panY -= d;
      view.applyTransform();
    }
    wake();
  }

  function enterState() {
    if (active) return;
    active = true;
    saved = { x: view.panX, y: view.panY, zoom: view.zoom };
    container.classList.add("is-presenting");
    document.documentElement.classList.add("presenting");
    view.media?.setInteractive(null);
    onEnter?.();
    refit(60); refit(450);
    wake();
    hint.classList.add("show");
    setTimeout(() => hint.classList.remove("show"), 4200);
  }
  function leaveState() {
    if (!active) return;
    active = false;
    clearTimeout(hideTimer);
    container.classList.remove("is-presenting", "present-idle", "pseudo-fs");
    document.documentElement.classList.remove("presenting");
    pseudo = false;
    view.media?.setInteractive(null);
    if (saved) { view.panX = saved.x; view.panY = saved.y; view.zoom = saved.zoom; view.applyTransform(); }
    onExit?.();
  }

  async function start() {
    if (active) return;
    if (canFullscreen(container)) {
      try {
        const p = container.requestFullscreen ? container.requestFullscreen({ navigationUI: "hide" }) : container.webkitRequestFullscreen();
        if (p && p.then) await p;
        // trạng thái được đặt trong sự kiện fullscreenchange
        if (!active) enterState();
        return;
      } catch { /* rơi xuống chế độ CSS */ }
    }
    pseudo = true;
    container.classList.add("pseudo-fs");
    enterState();
  }
  function stop() {
    if (!active) return;
    if (!pseudo && fsEl()) {
      const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.();
      if (p && p.catch) p.catch(() => {});
      // leaveState chạy trong fullscreenchange
      setTimeout(() => { if (active && !fsEl()) leaveState(); }, 400);
      return;
    }
    leaveState();
  }
  function toggle() { active ? stop() : start(); }

  const onFsChange = () => {
    if (fsEl() === container) { if (!active) enterState(); }
    else if (active && !pseudo) leaveState();
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  document.addEventListener("keydown", onKey);
  container.addEventListener("pointermove", wake);
  container.addEventListener("pointerdown", wake);

  return { start, stop, toggle, get active() { return active; } };
}

/**
 * Tương tác khi chỉ xem: bấm vào video/nhúng để bật chế độ tương tác (bấm phát, cuộn...).
 * Chỉ coi là "bấm" khi ngón tay/chuột không kéo đi xa.
 */
function enableMediaTap(view, hitTest, getDoc, isActive = () => true) {
  const host = view.host;
  let down = null;
  host.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
  host.addEventListener("pointerup", (e) => {
    if (!isActive() || !down || view.pinching) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    if (e.target.closest && e.target.closest(".media-box.is-interactive")) return;
    const w = view.screenToWorld(e.clientX, e.clientY);
    const hit = hitTest(getDoc(), w.x, w.y, 4 / view.zoom, { only: (el) => el.type === "video" || el.type === "embed" });
    if (hit) view.media?.setInteractive(hit.id);
  });
}

window.__DIAGRAM_PRESENT__ = { create, enableMediaTap, canFullscreen };
})();
