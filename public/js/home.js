/* Home page: header actions + side menu */
"use strict";

(async function () {
  const { SideMenu, Theme, ICONS, Api, user, BOOT } = window.__DIAGRAM__ || {};

  // Header actions thay doi theo trang thai dang nhap
  const actions = document.getElementById("headerActions");
  if (actions) {
    actions.replaceChildren();
    const themeBtn = document.createElement("button");
    themeBtn.className = "hamburger";
    themeBtn.setAttribute("aria-label", "Doi chu de sang/tai");
    themeBtn.innerHTML = ICONS.theme;
    themeBtn.addEventListener("click", () => Theme.toggle());
    actions.appendChild(themeBtn);

    if (user) {
      const menuBtn = document.getElementById("menuBtn");
      if (menuBtn) menuBtn.hidden = false;
      const a = document.createElement("a");
      a.className = "btn btn-primary";
      a.href = "/diagrams";
      a.textContent = "Sơ đồ của tôi";
      actions.appendChild(a);
    } else {
      const login = document.createElement("a");
      login.className = "btn btn-ghost";
      login.href = "/login";
      login.textContent = "Đăng nhập";
      const reg = document.createElement("a");
      reg.className = "btn btn-primary";
      reg.href = "/register";
      reg.textContent = "Đăng ký";
      actions.appendChild(login, reg);
      const menuBtn = document.getElementById("menuBtn");
      if (menuBtn) menuBtn.hidden = false;
    }
  }

  // Hero CTAs theo trang thai
  const ctaPrimary = document.getElementById("ctaPrimary");
  if (ctaPrimary && user) {
    ctaPrimary.href = "/create";
    ctaPrimary.textContent = "Tạo sơ đồ mới";
    const ctaSecondary = document.getElementById("ctaSecondary");
    if (ctaSecondary) {
      ctaSecondary.href = "/diagrams";
      ctaSecondary.textContent = "Sơ đồ của tôi";
    }
  }

  // Side menu
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

  const menuBtn = document.getElementById("menuBtn");
  if (menuBtn) {
    menuBtn.innerHTML = ICONS.menu;
    menuBtn.addEventListener("click", () => SideMenu.open());
  }
})();
