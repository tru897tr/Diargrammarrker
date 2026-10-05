/* Trang chia sẻ (chỉ xem): kéo để di chuyển, cuộn để thu phóng, nút Trình chiếu toàn màn hình. */
"use strict";

(function () {
  const { Theme, ICONS, BOOT } = window.__DIAGRAM__;
  const E = window.__DIAGRAM_ENGINE__;
  const PR = window.__DIAGRAM_PRESENT__;
  Theme.init();

  const svg = document.getElementById("svgRoot");
  const host = document.getElementById("canvasHost");
  const wrap = document.getElementById("shareWrap");

  const shareData = BOOT.shareData;
  document.getElementById("shareTitle").textContent = shareData?.diagram?.name || "Sơ đồ";

  const doc = new E.DiagramDoc(shareData.diagram.data);
  const view = new E.CanvasView(host, svg, doc, {
    readOnly: true,
    gridVisible: true,
    onZoom: (z) => { document.getElementById("zoomLabel").textContent = Math.round(z * 100) + "%"; },
  });
  view.renderContent();
  view.fit(undefined, 72);

  // Bấm vào video / nhúng để tương tác (phát, cuộn...)
  PR.enableMediaTap(view, E.hitTest, () => doc);

  document.getElementById("zoomIn").innerHTML = ICONS.zoomIn;
  document.getElementById("zoomOut").innerHTML = ICONS.zoomOut;
  document.getElementById("fitBtn").innerHTML = ICONS.fit;
  document.getElementById("hudPresent").innerHTML = ICONS.present;
  const pb = document.getElementById("presentBtn");
  pb.innerHTML = ICONS.present + '<span class="lbl">Trình chiếu</span>';
  pb.style.cssText = "display:inline-flex;align-items:center;gap:8px;";

  document.getElementById("zoomIn").addEventListener("click", () => view.zoomIn());
  document.getElementById("zoomOut").addEventListener("click", () => view.zoomOut());
  document.getElementById("fitBtn").addEventListener("click", () => view.fit());

  const present = PR.create({ container: wrap, view });
  pb.addEventListener("click", () => present.toggle());
  document.getElementById("hudPresent").addEventListener("click", () => present.toggle());

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "p" || k === "f") { e.preventDefault(); present.toggle(); }
    else if (!present.active) {
      if (e.key === "+" || e.key === "=") view.zoomIn();
      else if (e.key === "-" || e.key === "_") view.zoomOut();
      else if (e.key === "0") view.fit();
      else if (e.key === "Escape") view.media?.setInteractive(null);
    }
  });

  // Khi đổi kích thước cửa sổ ở chế độ thường: giữ nguyên vị trí, chỉ vẽ lại lưới
  window.addEventListener("resize", () => view.applyTransform());
  window.__DIAGRAM_SHARE__ = { doc, view, present };
})();
