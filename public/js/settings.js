/* Settings page */
"use strict";

(async function () {
  const { Api, Toast, UI, Theme, SideMenu, ICONS, user } = window.__DIAGRAM__;

  Theme.init();

  const themeBtn = document.getElementById("themeBtn");
  themeBtn.innerHTML = ICONS.theme;
  themeBtn.addEventListener("click", () => Theme.toggle());

  SideMenu.build({
    user,
    currentPath: "/settings",
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

  // ---- Profile ----
  const profileForm = document.getElementById("profileForm");
  profileForm.username.value = user.username;
  profileForm.email.value = user.email;

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById("perr-username").textContent = "";
    document.getElementById("perr-email").textContent = "";
    const body = {};
    const un = profileForm.username.value.trim();
    const em = profileForm.email.value.trim().toLowerCase();
    if (un !== user.username) body.username = un;
    if (em !== user.email) body.email = em;
    if (Object.keys(body).length === 0) {
      Toast.warn("Không có gì thay đổi.");
      return;
    }
    if (un.length < 3 || un.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(un)) {
      document.getElementById("perr-username").textContent = "Tên đăng nhập 3–32 ký tự (chữ, số, . _ -).";
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(em)) {
      document.getElementById("perr-email").textContent = "Email không hợp lệ.";
      return;
    }
    const btn = document.getElementById("profileSave");
    btn.disabled = true;
    try {
      const res = await Api.patch("/api/v1/auth/me", body);
      if (res.success) {
        Toast.ok("Đã lưu hồ sơ.");
        setTimeout(() => window.location.reload(), 500);
      } else {
        const details = res.error?.details || {};
        if (details.username) document.getElementById("perr-username").textContent = details.username;
        if (details.email) document.getElementById("perr-email").textContent = details.email;
        Toast.error(res.error?.message || "Không lưu được.");
      }
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Password ----
  const passwordForm = document.getElementById("passwordForm");
  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    ["pwerr-current", "pwerr-new", "pwerr-confirm"].forEach((id) => (document.getElementById(id).textContent = ""));
    const cur = passwordForm.currentPassword.value;
    const nw = passwordForm.newPassword.value;
    const cf = document.getElementById("cf-password").value;
    let ok = true;
    if (!cur) { document.getElementById("pwerr-current").textContent = "Nhập mật khẩu hiện tại."; ok = false; }
    if (nw.length < 8 || nw.length > 128) { document.getElementById("pwerr-new").textContent = "Mật khẩu mới 8–128 ký tự."; ok = false; }
    if (nw !== cf) { document.getElementById("pwerr-confirm").textContent = "Xác nhận không khớp."; ok = false; }
    if (!ok) return;

    const btn = document.getElementById("passwordSave");
    btn.disabled = true;
    try {
      const res = await Api.post("/api/v1/auth/change-password", { currentPassword: cur, newPassword: nw });
      if (res.success) {
        if (res.data.csrfToken) Api.csrfToken = res.data.csrfToken;
        Toast.ok("Đã đổi mật khẩu. Các phiên khác đã được đăng xuất.");
        passwordForm.reset();
      } else {
        document.getElementById("pwerr-current").textContent = res.error?.message || "Không đổi được mật khẩu.";
      }
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Theme options ----
  const themeGroup = document.getElementById("themeGroup");
  function markTheme() {
    const cur = Theme.load();
    themeGroup.querySelectorAll(".theme-opt").forEach((b) => {
      const active = b.dataset.theme === cur;
      b.classList.toggle("btn-primary", active);
      b.classList.toggle("btn-secondary", !active);
      b.setAttribute("aria-checked", String(active));
    });
  }
  markTheme();
  themeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".theme-opt");
    if (!btn) return;
    Theme.apply(btn.dataset.theme);
    markTheme();
  });

  // ---- Editor prefs (localStorage — chi la uu tien client, khong phai database) ----
  const PREFS = "diagram-prefs";
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* ignore */ }
  }
  const prefs = loadPrefs();
  const gridEl = document.getElementById("opt-grid");
  const snapEl = document.getElementById("opt-snap");
  const confirmEl = document.getElementById("opt-confirm");
  gridEl.checked = prefs.gridVisible !== false;
  snapEl.checked = prefs.snapEnabled !== false;
  confirmEl.checked = prefs.confirmBeforeDelete !== false;
  [gridEl, snapEl, confirmEl].forEach((el) =>
    el.addEventListener("change", () => savePrefs({ ...loadPrefs(), gridVisible: gridEl.checked, snapEnabled: snapEl.checked, confirmBeforeDelete: confirmEl.checked }))
  );

  // ---- Logout all ----
  document.getElementById("logoutAll").addEventListener("click", async () => {
    const ok = await UI.confirm({
      title: "Đăng xuất tất cả thiết bị?",
      message: "Tất cả phiên đăng nhập khác sẽ bị hủy. Phiên hiện tại được giữ lại.",
      okLabel: "Đăng xuất",
      danger: true,
    });
    if (!ok) return;
    const res = await Api.post("/api/v1/auth/logout-all");
    if (res.success) {
      Toast.ok(res.data.revoked > 0 ? `Đã đăng xuất ${res.data.revoked} thiết bị khác.` : "Không có thiết bị nào khác đang đăng nhập.");
    } else {
      Toast.error(res.error?.message || "Không thực hiện được.");
    }
  });
})();
