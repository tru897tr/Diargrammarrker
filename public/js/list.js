/* Trang danh sách sơ đồ: lưới thẻ có ảnh xem trước, tìm kiếm, sắp xếp, thao tác tại chỗ. */
"use strict";

(async function () {
  const { Api, Toast, UI, Theme, SideMenu, ICONS, user } = window.__DIAGRAM__;
  Theme.init();

  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";

  const themeBtn = $("themeBtn");
  if (themeBtn) { themeBtn.innerHTML = ICONS.theme; themeBtn.addEventListener("click", () => Theme.toggle()); }
  SideMenu.build({
    user,
    currentPath: "/diagrams",
    items: [
      { href: "/", label: "Trang chủ", icon: "home" },
      { href: "/create", label: "Tạo sơ đồ", icon: "plus" },
      { href: "/diagrams", label: "Danh sách sơ đồ", icon: "layers" },
      { href: "/settings", label: "Cài đặt", icon: "settings" },
      { href: "/admin", label: "Quản lý trang web", icon: "shield", adminOnly: true },
    ],
  });
  const menuBtn = $("menuBtn");
  menuBtn.innerHTML = ICONS.menu;
  menuBtn.addEventListener("click", () => SideMenu.open());

  const listEl = $("list"), emptyEl = $("empty"), toolbar = $("toolbar"), searchEl = $("search"), sortEl = $("sort"), countEl = $("count"), noMatch = $("noMatch");
  const fmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtDay = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  let diagrams = [];

  async function load() {
    const res = await Api.get("/api/v1/diagrams");
    if (!res.success) {
      listEl.replaceChildren();
      Toast.error(res.error?.message || "Không tải được danh sách.");
      return;
    }
    diagrams = res.data.diagrams || [];
    render();
  }

  /* ---- ảnh xem trước: vẽ từ dữ liệu gọn của máy chủ (chỉ dùng setAttribute / textContent) ---- */
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }
  const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/-]+\)|[a-z]{3,24})$/i;
  function paint(n, attr, v, fallback) {
    if (v === "auto") v = fallback;
    if (v === "none" || v === "transparent") { n.setAttribute(attr, "none"); return; }
    n.setAttribute(attr, typeof v === "string" && SAFE_COLOR.test(v) ? v : fallback);
  }
  function buildPreview(p) {
    const W = 220, H = 138, PAD = 14;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true", class: "dg-svg" });
    if (!p || !p.i || !p.i.length) return null;
    const [bx, by, bw, bh] = p.b;
    const k = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh, 1.4);
    const ox = (W - bw * k) / 2 - bx * k, oy = (H - bh * k) / 2 - by * k;
    const g = svgEl("g", { transform: `translate(${ox} ${oy}) scale(${k})` });
    const sw = Math.max(1 / k, 1.2);
    for (const it of p.i) {
      const t = it[0];
      if (t === "l") {
        const n = svgEl("line", { x1: it[1], y1: it[2], x2: it[3], y2: it[4], "stroke-linecap": "round", "stroke-width": Math.max(sw, 1.6 / k) });
        paint(n, "stroke", it[5], "#64748b"); g.appendChild(n);
      } else if (t === "t") {
        const n = svgEl("rect", { x: it[1], y: it[2] + it[4] * 0.38, width: it[3], height: Math.max(it[4] * 0.22, 2 / k), rx: 1 / k, opacity: "0.55" });
        paint(n, "fill", it[5], "#334155"); g.appendChild(n);
      } else if (t === "m") {
        const n = svgEl("rect", { x: it[1], y: it[2], width: it[3], height: it[4], rx: 3 / k, "stroke-width": sw, fill: it[5] === "image" ? "#bae6fd" : "#cbd5e1", stroke: it[5] === "image" ? "#0284c7" : "#475569" });
        g.appendChild(n);
        if (it[5] !== "image") {
          const s = Math.min(it[3], it[4]) * 0.22, cx = it[1] + it[3] / 2, cy = it[2] + it[4] / 2;
          g.appendChild(svgEl("path", { d: `M${cx - s * 0.6} ${cy - s}L${cx + s} ${cy}L${cx - s * 0.6} ${cy + s}Z`, fill: "#475569" }));
        }
      } else {
        const n = t === "e"
          ? svgEl("ellipse", { cx: it[1] + it[3] / 2, cy: it[2] + it[4] / 2, rx: it[3] / 2, ry: it[4] / 2, "stroke-width": sw })
          : svgEl("rect", { x: it[1], y: it[2], width: it[3], height: it[4], rx: Math.min(6, it[3] / 6) / 1, "stroke-width": sw });
        paint(n, "fill", it[5], "none"); paint(n, "stroke", it[6], "#64748b"); g.appendChild(n);
      }
    }
    svg.appendChild(g);
    return svg;
  }

  /* ---- vẽ lưới ---- */
  function visible() {
    const q = searchEl.value.trim().toLowerCase();
    let list = diagrams.filter((d) => !q || (d.name || "").toLowerCase().includes(q));
    const by = sortEl.value;
    list = list.slice().sort((a, b) =>
      by === "name" ? (a.name || "").localeCompare(b.name || "", "vi")
        : by === "created" ? new Date(b.createdAt) - new Date(a.createdAt)
        : new Date(b.updatedAt) - new Date(a.updatedAt));
    return list;
  }
  function render() {
    listEl.replaceChildren();
    const has = diagrams.length > 0;
    emptyEl.classList.toggle("hidden", has);
    listEl.classList.toggle("hidden", !has);
    toolbar.hidden = !has;
    if (!has) return;
    const list = visible();
    countEl.textContent = list.length === diagrams.length ? `${diagrams.length} sơ đồ` : `${list.length}/${diagrams.length} sơ đồ`;
    noMatch.classList.toggle("hidden", list.length > 0);
    for (const d of list) listEl.appendChild(card(d));
  }

  function card(d) {
    const item = document.createElement("article");
    item.className = "dg-card";
    item.dataset.id = d.id;

    const open = document.createElement("a");
    open.className = "dg-preview";
    open.href = `/edit/${d.id}`;
    open.setAttribute("aria-label", `Mở sơ đồ ${d.name}`);
    const pv = buildPreview(d.preview);
    if (pv) open.appendChild(pv);
    else { const e = document.createElement("span"); e.className = "dg-blank"; e.textContent = "Trang trống"; open.appendChild(e); }
    if (d.mediaCount) {
      const b = document.createElement("span"); b.className = "dg-badge";
      b.innerHTML = ICONS.image; b.append(document.createTextNode(String(d.mediaCount)));
      b.title = `${d.mediaCount} ảnh / video / nhúng`; open.appendChild(b);
    }

    const foot = document.createElement("div");
    foot.className = "dg-foot";
    const info = document.createElement("a");
    info.className = "dg-info"; info.href = `/edit/${d.id}`;
    const name = document.createElement("strong"); name.textContent = d.name; name.title = d.name;
    const meta = document.createElement("span");
    meta.textContent = `Sửa ${fmtDay.format(new Date(d.updatedAt))}` + (typeof d.elementCount === "number" ? ` · ${d.elementCount} phần tử` : "");
    meta.title = `Sửa lần cuối: ${fmt.format(new Date(d.updatedAt))}`;
    info.append(name, meta);

    const menu = document.createElement("div"); menu.className = "item-menu";
    const mb = document.createElement("button");
    mb.className = "item-menu-btn"; mb.type = "button"; mb.innerHTML = ICONS.dots;
    mb.setAttribute("aria-label", `Thao tác với sơ đồ ${d.name}`); mb.setAttribute("aria-haspopup", "menu"); mb.setAttribute("aria-expanded", "false");
    const dd = document.createElement("div"); dd.className = "dropdown"; dd.setAttribute("role", "menu");
    const act = (label, icon, fn, cls = "") => {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem"); b.className = cls;
      b.innerHTML = ICONS[icon] || ""; const sp = document.createElement("span"); sp.textContent = label; b.appendChild(sp);
      b.addEventListener("click", (e) => { e.stopPropagation(); closeMenus(); fn(); });
      return b;
    };
    dd.append(
      act("Chỉnh sửa", "edit", () => { location.href = `/edit/${d.id}`; }),
      act("Đổi tên", "edit", () => rename(d)),
      act("Tạo bản sao", "copy", () => duplicate(d)),
      act("Chia sẻ & trình chiếu", "present", () => share(d)),
      act("Xóa", "trash", () => remove(d), "danger"),
    );
    mb.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = dd.classList.contains("open");
      closeMenus();
      if (!wasOpen) { dd.classList.add("open"); mb.setAttribute("aria-expanded", "true"); }
    });
    menu.append(mb, dd);
    foot.append(info, menu);
    item.append(open, foot);
    return item;
  }
  function closeMenus() {
    document.querySelectorAll(".dropdown.open").forEach((x) => { x.classList.remove("open"); x.previousElementSibling?.setAttribute("aria-expanded", "false"); });
  }
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  searchEl.addEventListener("input", render);
  sortEl.addEventListener("change", render);

  /* ---- thao tác ---- */
  async function duplicate(d) {
    const res = await Api.post(`/api/v1/diagrams/${d.id}/duplicate`);
    if (!res.success) { Toast.error(res.error?.message || "Không tạo được bản sao."); return; }
    Toast.ok("Đã tạo bản sao");
    await load();
  }

  async function rename(d) {
    const body = document.createElement("div");
    const input = document.createElement("input"); input.className = "input"; input.value = d.name; input.maxLength = 120; input.setAttribute("aria-label", "Tên sơ đồ");
    body.appendChild(input);
    const p = UI.modal({ title: "Đổi tên sơ đồ", body, actions: [{ label: "Hủy", class: "btn-secondary", value: "no" }, { label: "Lưu", class: "btn-primary", value: "ok" }] });
    input.focus(); input.select();
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); UI.closeModal(null, "ok"); } });
    const v = await p;
    if (v !== "ok") return;
    const name = input.value.trim();
    if (!name || name === d.name) return;
    const res = await Api.patch(`/api/v1/diagrams/${d.id}`, { name });
    if (!res.success) { Toast.error(res.error?.message || "Không đổi được tên."); return; }
    d.name = name; d.updatedAt = res.data?.diagram?.updatedAt || d.updatedAt;
    Toast.ok("Đã đổi tên"); render();
  }

  async function share(d) {
    const res = await Api.post(`/api/v1/diagrams/${d.id}/share`);
    if (!res.success) { Toast.error(res.error?.message || "Không tạo được liên kết chia sẻ."); return; }
    const url = `${location.origin}/share/${res.data.share.token}`;
    const body = document.createElement("div");
    const row = document.createElement("div"); row.className = "share-url-row";
    const input = document.createElement("input"); input.className = "input"; input.readOnly = true; input.value = url; input.setAttribute("aria-label", "Liên kết chia sẻ");
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "btn btn-secondary"; copy.textContent = "Sao chép";
    copy.addEventListener("click", async () => { if (await UI.copyText(url)) Toast.ok("Đã sao chép liên kết"); else { input.select(); Toast.warn("Hãy nhấn Ctrl+C để sao chép."); } });
    row.append(input, copy);
    const hint = document.createElement("p"); hint.className = "text-faint"; hint.style.cssText = "font-size:13px;margin:10px 0 0;line-height:1.55;";
    hint.textContent = "Ai có liên kết đều xem được sơ đồ (chỉ đọc) và có nút Trình chiếu toàn màn hình. Bạn có thể tắt chia sẻ bất cứ lúc nào.";
    const links = document.createElement("div"); links.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;";
    const view = document.createElement("a"); view.className = "btn btn-primary btn-sm"; view.href = url; view.target = "_blank"; view.rel = "noopener"; view.innerHTML = ICONS.present + "<span>Mở trang trình chiếu</span>"; view.style.cssText = "display:inline-flex;align-items:center;gap:8px;";
    const revoke = document.createElement("button"); revoke.type = "button"; revoke.className = "btn btn-danger btn-sm"; revoke.textContent = "Tắt chia sẻ";
    revoke.addEventListener("click", async () => {
      const r = await Api.del(`/api/v1/diagrams/${d.id}/share`);
      if (r.success) { UI.closeModal(null); Toast.ok("Đã tắt chia sẻ"); } else Toast.error("Không tắt được chia sẻ.");
    });
    links.append(view, revoke);
    body.append(row, hint, links);
    await UI.modal({ title: "Chia sẻ sơ đồ (chỉ đọc)", body, actions: [{ label: "Đóng", class: "btn-secondary", value: "close" }] });
  }

  async function remove(d) {
    const ok = await UI.confirm({
      title: "Xóa sơ đồ?",
      message: `Bạn có chắc muốn xóa sơ đồ "${d.name}"? Hành động này không thể hoàn tác.`,
      okLabel: "Xóa",
    });
    if (!ok) return;
    const res = await Api.del(`/api/v1/diagrams/${d.id}`);
    if (!res.success) { Toast.error(res.error?.message || "Không xóa được."); return; }
    diagrams = diagrams.filter((x) => x.id !== d.id);
    Toast.ok("Đã xóa sơ đồ");
    render();
  }

  await load();
})();
