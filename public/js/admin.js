/* Admin dashboard page */
"use strict";

(async function () {
  const { Api, Toast, UI, Theme, SideMenu, ICONS, user } = window.__DIAGRAM__;

  Theme.init();

  const themeBtn = document.getElementById("themeBtn");
  themeBtn.innerHTML = ICONS.theme;
  themeBtn.addEventListener("click", () => Theme.toggle());

  SideMenu.build({
    user,
    currentPath: "/admin",
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

  const fmtDate = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

  async function fmtUptime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
  }

  // ---- Stats ----
  const statsRes = await Api.get("/api/v1/admin/stats");
  const statsGrid = document.getElementById("statsGrid");
  if (!statsRes.success) {
    Toast.error(statsRes.error?.message || "Không tải được thống kê.");
    return;
  }
  const s = statsRes.data.stats;
  document.getElementById("storageBadge").textContent = s.storage.provider;

  const cards = [
    { label: "Người dùng", value: s.users, sub: "tổng tài khoản đã đăng ký" },
    { label: "Sơ đồ", value: s.diagrams, sub: "đang lưu trong store" },
    { label: "Phiên hoạt động", value: s.activeSessions, sub: "session đang đăng nhập" },
    { label: "Liên kết chia sẻ", value: s.activeShares, sub: "share link còn hiệu lực" },
  ];
  statsGrid.replaceChildren();
  for (const c of cards) {
    const card = document.createElement("div");
    card.className = "stat-card";
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = c.label;
    const v = document.createElement("div");
    v.className = "stat-value";
    v.textContent = String(c.value);
    const sub = document.createElement("div");
    sub.className = "stat-sub";
    sub.textContent = c.sub;
    card.append(l, v, sub);
    statsGrid.appendChild(card);
  }

  const sysCard = document.getElementById("sysCard");
  sysCard.hidden = false;
  const sys = document.getElementById("sysInfo");
  const lines = [
    `storage: ${s.storage.provider}${s.storage.persistent ? " (persistent)" : " (tạm thời — mất khi restart)"}`,
    `uptime: ${await fmtUptime(s.uptimeSeconds)}`,
    `memory RSS: ${s.memory.rssMb} MB (heap ${s.memory.heapUsedMb}/${s.memory.heapTotalMb} MB)`,
    `node: ${s.nodeVersion} · env: ${s.env}`,
  ];
  sys.replaceChildren();
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    sys.appendChild(div);
  }

  // ---- Users table ----
  const usersRes = await Api.get("/api/v1/admin/users");
  const tbody = document.getElementById("usersBody");
  if (!usersRes.success) {
    Toast.error(usersRes.error?.message || "Không tải được người dùng.");
    return;
  }
  tbody.replaceChildren();

  for (const u of usersRes.data.users) {
    const tr = document.createElement("tr");

    const tdUser = document.createElement("td");
    tdUser.style.fontWeight = "600";
    tdUser.textContent = u.username; // XSS-safe

    const tdEmail = document.createElement("td");
    tdEmail.textContent = u.email;

    const tdRole = document.createElement("td");
    const roleBadge = document.createElement("span");
    roleBadge.className = "badge " + (u.role === "admin" ? "badge-accent" : "badge-muted");
    roleBadge.textContent = u.role;
    tdRole.appendChild(roleBadge);

    const tdStatus = document.createElement("td");
    const stBadge = document.createElement("span");
    stBadge.className = "badge " + (u.status === "active" ? "badge-ok" : "badge-danger");
    stBadge.textContent = u.status === "active" ? "hoạt động" : "bị khóa";
    tdStatus.appendChild(stBadge);

    const tdCreated = document.createElement("td");
    tdCreated.textContent = fmtDate.format(new Date(u.createdAt));
    tdCreated.className = "text-soft";

    const tdActions = document.createElement("td");
    tdActions.className = "cell-actions";

    const mkBtn = (label, cls, fn, icon) => {
      const b = document.createElement("button");
      b.className = `btn btn-sm ${cls}`;
      if (icon) b.innerHTML = ICONS[icon];
      const span = document.createElement("span");
      span.textContent = label;
      b.appendChild(span);
      b.addEventListener("click", fn);
      return b;
    };

    tdActions.appendChild(
      mkBtn("Đăng xuất phiên", "btn-secondary", () => revokeSessions(u), "logout")
    );

    if (u.status === "active") {
      tdActions.appendChild(mkBtn("Khóa", "btn-secondary", () => setStatus(u, "locked"), "lock"));
    } else {
      tdActions.appendChild(mkBtn("Mở khóa", "btn-secondary", () => setStatus(u, "active"), "unlock"));
    }

    if (u.role === "user") {
      tdActions.appendChild(mkBtn("Lên admin", "btn-secondary", () => setRole(u, "admin"), "shield"));
    } else if (u.id !== user.id) {
      tdActions.appendChild(mkBtn("Hạ user", "btn-secondary", () => setRole(u, "user"), "user"));
    }

    tr.append(tdUser, tdEmail, tdRole, tdStatus, tdCreated, tdActions);
    tbody.appendChild(tr);
  }

  async function revokeSessions(u) {
    const ok = await UI.confirm({
      title: `Đăng xuất phiên của ${u.username}?`,
      message: `Tất cả phiên đăng nhập của "${u.username}" sẽ bị hủy ngay lập tức.`,
      okLabel: "Đăng xuất",
      danger: true,
    });
    if (!ok) return;
    const res = await Api.post(`/api/v1/admin/users/${u.id}/revoke-sessions`);
    if (res.success) {
      Toast.ok(`Đã hủy ${res.data.revoked} phiên.`);
      if (u.id === user.id) setTimeout(() => (window.location.href = "/login"), 600);
    } else {
      Toast.error(res.error?.message || "Không thực hiện được.");
    }
  }

  async function setStatus(u, status) {
    const res = await Api.patch(`/api/v1/admin/users/${u.id}`, { status });
    if (res.success) {
      Toast.ok(status === "locked" ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
      setTimeout(() => window.location.reload(), 400);
    } else {
      Toast.error(res.error?.message || "Không thực hiện được.");
    }
  }

  async function setRole(u, role) {
    const ok = await UI.confirm({
      title: `Đổi vai trò của ${u.username}?`,
      message: `Chuyển "${u.username}" thành ${role === "admin" ? "quản trị viên" : "người dùng thường"}.`,
      okLabel: "Xác nhận",
      danger: false,
    });
    if (!ok) return;
    const res = await Api.patch(`/api/v1/admin/users/${u.id}`, { role });
    if (res.success) {
      Toast.ok("Đã cập nhật vai trò.");
      setTimeout(() => window.location.reload(), 400);
    } else {
      Toast.error(res.error?.message || "Không thực hiện được.");
    }
  }
})();
