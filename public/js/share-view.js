/* Share view: render diagram read-only, cho pan/zoom, khong toolbar edit */
"use strict";

(function () {
  const { Theme } = window.__DIAGRAM__;

  Theme.init();

  const svg = document.getElementById("svgRoot");
  const host = document.getElementById("canvasHost");

  // Ve truc tiep tu boot data (server da kiem tra token + tra du lieu can thiet)
  const shareData = JSON.parse(document.getElementById("boot-data").textContent).shareData;
  document.getElementById("shareTitle").textContent = shareData?.diagram?.name || "Sơ đồ";

  const renderer = new ShareRenderer(svg, host, shareData.diagram.data);

  document.getElementById("zoomIn").innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M21 21l-4.3-4.3"/></svg>';
  document.getElementById("zoomOut").innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M21 21l-4.3-4.3"/></svg>';
  document.getElementById("fitBtn").innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

  document.getElementById("zoomIn").addEventListener("click", () => renderer.zoomIn());
  document.getElementById("zoomOut").addEventListener("click", () => renderer.zoomOut());
  document.getElementById("fitBtn").addEventListener("click", () => renderer.fit());
})();

function ShareRenderer(svg, host, data) {
  const SVGNS = "http://www.w3.org/2000/svg";
  const { Render, wrapText } = window.__DIAGRAM_ENGINE__;

  function el(tag, attrs = {}) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // grid (neu frame co)
  const defs = el("defs");
  const pattern = el("pattern", { id: "sgrid", width: 8, height: 8, patternUnits: "userSpaceOnUse" });
  pattern.innerHTML = '<path d="M8 0H0V8" fill="none" stroke="currentColor" stroke-opacity="0.08" stroke-width="1"/>';
  defs.appendChild(pattern);
  svg.appendChild(defs);
  const gridRect = el("rect", { width: "100%", height: "100%", fill: "url(#sgrid)" });
  gridRect.style.color = "var(--border-strong)";
  svg.appendChild(gridRect);

  const scene = el("g");
  svg.appendChild(scene);

  this.zoom = 1;
  this.panX = 0;
  this.panY = 0;

  this.applyTransform = () => {
    scene.setAttribute("transform", `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
    pattern.setAttribute("patternTransform", `translate(${this.panX % 8} ${this.panY % 8}) scale(${this.zoom})`);
    document.getElementById("zoomLabel").textContent = Math.round(this.zoom * 100) + "%";
  };

  for (const e of data.elements) {
    scene.appendChild(Render.element(e));
  }

  this.fit = () => {
    const elements = data.elements;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of elements) {
      const xs = e.points ? e.points.map((p) => p[0]) : [e.x, e.x + (e.width || 0)];
      const ys = e.points ? e.points.map((p) => p[1]) : [e.y, e.y + (e.height || 0)];
      minX = Math.min(minX, ...xs); minY = Math.min(minY, ...ys);
      maxX = Math.max(maxX, ...xs); maxY = Math.max(maxY, ...ys);
    }
    const r = host.getBoundingClientRect();
    if (minX === Infinity || (maxX - minX < 1 && maxY - minY < 1)) {
      this.panX = r.width / 2; this.panY = r.height / 2; this.zoom = 1;
    } else {
      const pad = 60;
      this.zoom = Math.min((r.width - pad * 2) / Math.max(maxX - minX, 1), (r.height - pad * 2) / Math.max(maxY - minY, 1), 4);
      this.zoom = Math.max(this.zoom, 0.05);
      this.panX = r.width / 2 - (minX + (maxX - minX) / 2) * this.zoom;
      this.panY = r.height / 2 - (minY + (maxY - minY) / 2) * this.zoom;
    }
    this.applyTransform();
  };

  this.zoomIn = () => { this.zoomAt(1.2); };
  this.zoomOut = () => { this.zoomAt(1 / 1.2); };
  this.zoomAt = (factor) => {
    const r = host.getBoundingClientRect();
    this.zoom = Math.max(0.05, Math.min(20, this.zoom * factor));
    this.panX = r.width / 2 - (r.width / 2 - this.panX) * (this.zoom / (this.zoom / factor));
    this.panY = r.height / 2 - (r.height / 2 - this.panY) * (this.zoom / (this.zoom / factor));
    this.applyTransform();
  };

  // pan: chuot ke hoac chuot giua
  let panning = null;
  host.style.cursor = "grab";
  host.addEventListener("pointerdown", (e) => {
    panning = { sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
    host.style.cursor = "grabbing";
  });
  window.addEventListener("pointermove", (e) => {
    if (!panning) return;
    this.panX = panning.px + (e.clientX - panning.sx);
    this.panY = panning.py + (e.clientY - panning.sy);
    this.applyTransform();
  });
  window.addEventListener("pointerup", () => {
    panning = null;
    host.style.cursor = "grab";
  });

  host.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    const r = host.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const old = this.zoom;
    this.zoom = Math.max(0.05, Math.min(20, old * factor));
    this.panX = cx - ((cx - this.panX) / old) * this.zoom;
    this.panY = cy - ((cy - this.panY) / old) * this.zoom;
    this.applyTransform();
  }, { passive: false });

  this.fit();
}
