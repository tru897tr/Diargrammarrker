/* Trang chủ cho người đã đăng nhập: chào, bắt đầu nhanh, sơ đồ gần đây. */
"use strict";

(async function () {
  const { SideMenu, Theme, ICONS, Api, Toast, user } = window.__DIAGRAM__;
  Theme.init();

  const $ = (id) => document.getElementById(id);

  // Thanh trên
  const actions = $("headerActions");
  const themeBtn = document.createElement("button");
  themeBtn.className = "hamburger";
  themeBtn.setAttribute("aria-label", "Đổi chủ đề sáng/tối");
  themeBtn.innerHTML = ICONS.theme;
  themeBtn.addEventListener("click", () => Theme.toggle());
  actions.appendChild(themeBtn);
  $("menuBtn").innerHTML = ICONS.menu;
  $("menuBtn").addEventListener("click", () => SideMenu.open());
  SideMenu.build({
    user,
    currentPath: "/",
    items: [
      { href: "/", label: "Trang chủ", icon: "home" },
      { href: "/create", label: "Tạo sơ đồ", icon: "plus" },
      { href: "/diagrams", label: "Danh sách sơ đồ", icon: "layers" },
      { href: "/settings", label: "Cài đặt", icon: "settings" },
      { href: "/admin", label: "Quản lý trang web", icon: "shield", adminOnly: true },
    ],
  });

  // Lời chào theo giờ trong ngày
  const now = new Date();
  const hr = now.getHours();
  const part = hr < 11 ? "Chào buổi sáng" : hr < 14 ? "Chào buổi trưa" : hr < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  const name = user?.username || "bạn";
  const h1 = $("huTitle");
  h1.textContent = "";
  h1.append(document.createTextNode(`${part}, `));
  const nm = document.createElement("span"); nm.className = "hu-name"; nm.textContent = name; // textContent: an toàn XSS
  h1.append(nm, document.createElement("br"), document.createTextNode("hôm nay vẽ gì nhỉ?"));
  $("huDate").textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" }).format(now);
  $("huNew").innerHTML = ICONS.plus + "<span>Tạo sơ đồ mới</span>";
  $("huNew").style.cssText = "display:inline-flex;align-items:center;gap:8px;";
  $("huPlus").innerHTML = ICONS.plus;
  document.querySelectorAll("[data-ico]").forEach((n) => { n.innerHTML = ICONS[n.dataset.ico] || ""; });

  // Sơ đồ gần đây
  const box = $("huRecent");
  const res = await Api.get("/api/v1/diagrams");
  box.replaceChildren();
  if (!res.success) {
    const p = document.createElement("p"); p.className = "hu-empty"; p.textContent = res.error?.message || "Không tải được danh sách sơ đồ.";
    box.appendChild(p); return;
  }
  const list = (res.data.diagrams || []).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (!list.length) {
    const e = document.createElement("div"); e.className = "hu-empty";
    const t = document.createElement("strong"); t.textContent = "Bạn chưa có sơ đồ nào";
    const s = document.createElement("span"); s.textContent = "Bấm “Trang trống” hoặc một ô ở phần Bắt đầu nhanh để tạo sơ đồ đầu tiên.";
    e.append(t, s); box.appendChild(e); return;
  }
  $("huAll").hidden = false;
  const rel = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
  const ago = (iso) => {
    const s = (new Date(iso).getTime() - Date.now()) / 1000, a = Math.abs(s);
    if (a < 60) return "vừa xong";
    if (a < 3600) return rel.format(Math.round(s / 60), "minute");
    if (a < 86400) return rel.format(Math.round(s / 3600), "hour");
    if (a < 86400 * 30) return rel.format(Math.round(s / 86400), "day");
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  };
  for (const d of list.slice(0, 6)) {
    const a = document.createElement("a"); a.className = "hu-card"; a.href = `/edit/${d.id}`;
    const tile = document.createElement("span"); tile.className = "hu-card-tile"; tile.setAttribute("aria-hidden", "true");
    tile.textContent = (d.name || "?").trim().slice(0, 1).toUpperCase();
    const body = document.createElement("span"); body.className = "hu-card-body";
    const n = document.createElement("strong"); n.textContent = d.name;
    const m = document.createElement("span");
    const parts = [`Sửa ${ago(d.updatedAt)}`];
    if (typeof d.elementCount === "number") parts.push(`${d.elementCount} phần tử`);
    if (d.mediaCount) parts.push(`${d.mediaCount} phương tiện`);
    m.textContent = parts.join(" · ");
    body.append(n, m);
    const go = document.createElement("span"); go.className = "hu-card-go"; go.innerHTML = ICONS.edit; go.setAttribute("aria-hidden", "true");
    a.append(tile, body, go);
    box.appendChild(a);
  }
})();
