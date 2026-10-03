/* Diagrams list page */
"use strict";

(async function () {
  const { Api, Toast, UI, Theme, SideMenu, ICONS, user } = window.__DIAGRAM__;

  Theme.init();

  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) {
    themeBtn.innerHTML = ICONS.theme;
    themeBtn.addEventListener("click", () => Theme.toggle());
  }

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
  const menuBtn = document.getElementById("menuBtn");
  menuBtn.innerHTML = ICONS.menu;
  menuBtn.addEventListener("click", () => SideMenu.open());

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");

  const res = await Api.get("/api/v1/diagrams");
  listEl.replaceChildren();

  if (!res.success) {
    Toast.error(res.error?.message || "Không tải được danh sách.");
    return;
  }

  const diagrams = res.data.diagrams;
  if (diagrams.length === 0) {
    emptyEl.classList.remove("hidden");
    listEl.classList.add("hidden");
    return;
  }

  const fmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  for (const d of diagrams) {
    const item = document.createElement("div");
    item.className = "diagram-item";

    const thumb = document.createElement("div");
    thumb.className = "diagram-thumb";
    thumb.innerHTML = '<svg width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect x="8" y="14" width="22" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><rect x="34" y="36" width="22" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M30 22c5 0 3 20 8 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

    const info = document.createElement("a");
    info.className = "info";
    info.href = `/edit/${d.id}`;
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = d.name; // XSS-safe
    const updated = document.createElement("div");
    updated.className = "updated";
    updated.textContent = `Cập nhật ${fmt.format(new Date(d.updatedAt))}`;
    info.appendChild(name);
    info.appendChild(updated);

    const menu = document.createElement("div");
    menu.className = "item-menu";
    const menuBtn2 = document.createElement("button");
    menuBtn2.className = "item-menu-btn";
    menuBtn2.setAttribute("aria-label", `Thao tác với sơ đồ ${d.name}`);
    menuBtn2.setAttribute("aria-haspopup", "menu");
    menuBtn2.innerHTML = ICONS.dots;
    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";
    dropdown.setAttribute("role", "menu");

    const mkAction = (label, icon, fn, cls = "") => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitem");
      b.className = cls;
      b.innerHTML = ICONS[icon] || "";
      const span = document.createElement("span");
      span.textContent = label;
      b.appendChild(span);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.remove("open");
        fn();
      });
      return b;
    };

    dropdown.appendChild(mkAction("Chỉnh sửa", "edit", () => { window.location.href = `/edit/${d.id}`; }));
    dropdown.appendChild(mkAction("Tạo bản sao", "copy", () => duplicate(d.id)));
    dropdown.appendChild(mkAction("Chia sẻ", "share", () => share(d)));
    dropdown.appendChild(mkAction("Xóa", "trash", () => remove(d), "danger"));

    menuBtn2.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".dropdown.open").forEach((x) => x.classList.remove("open"));
      dropdown.classList.toggle("open");
    });
    menu.appendChild(menuBtn2);
    menu.appendChild(dropdown);

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(menu);
    listEl.appendChild(item);
  }

  document.addEventListener("click", () => {
    document.querySelectorAll(".dropdown.open").forEach((x) => x.classList.remove("open"));
  });

  async function duplicate(id) {
    const res2 = await Api.post(`/api/v1/diagrams/${id}/duplicate`);
    if (res2.success) {
      Toast.ok("Đã tạo bản sao!");
      setTimeout(() => window.location.reload(), 400);
    } else {
      Toast.error(res2.error?.message || "Không tạo được bản sao.");
    }
  }

  async function share(d) {
    // Kiem tra share ton tai
    const existing = await Api.get(`/api/v1/diagrams/${d.id}`);
    let shareUrl = null;
    if (existing.success) {
      const res2 = await Api.post(`/api/v1/diagrams/${d.id}/share`);
      if (res2.success) {
        shareUrl = `${window.location.origin}/share/${res2.data.share.token}`;
      }
    }
    if (!shareUrl) {
      Toast.error("Không tạo được liên kết chia sẻ.");
      return;
    }

    const body = document.createElement("div");
    const row = document.createElement("div");
    row.className = "share-url-row";
    const input = document.createElement("input");
    input.className = "input";
    input.readOnly = true;
    input.value = shareUrl;
    row.appendChild(input);
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn btn-secondary";
    copyBtn.textContent = "Sao chép";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        Toast.ok("Đã sao chép liên kết!");
      } catch {
        input.select();
        document.execCommand("copy");
        Toast.ok("Đã sao chép liên kết!");
      }
    });
    row.appendChild(copyBtn);
    body.appendChild(row);
    const hint = document.createElement("p");
    hint.className = "text-faint";
    hint.style.cssText = "font-size:13px;margin-top:10px;";
    hint.textContent = "Ai có liên kết đều xem được sơ đồ (chỉ đọc). Tắt chia sẻ bất cứ lúc nào từ menu này.";
    body.appendChild(hint);

    const revoke = document.createElement("button");
    revoke.className = "btn btn-danger btn-sm";
    revoke.textContent = "Tắt chia sẻ";
    revoke.style.marginTop = "12px";
    revoke.addEventListener("click", async () => {
      const res3 = await Api.del(`/api/v1/diagrams/${d.id}/share`);
      if (res3.success) {
        UI.closeModal(null);
        Toast.ok("Đã tắt chia sẻ.");
      } else {
        Toast.error("Không tắt được chia sẻ.");
      }
    });
    body.appendChild(revoke);

    await UI.modal({ title: "Chia sẻ sơ đồ (chỉ đọc)", body, actions: [{ label: "Đóng", class: "btn-secondary", value: "close" }] });
  }

  async function remove(d) {
    const ok = await UI.confirm({
      title: "Xóa sơ đồ?",
      message: `Bạn có chắc muốn xóa sơ đồ "${d.name}"? Hành động này sẽ xóa sơ đồ khỏi danh sách hiện tại và không thể hoàn tác.`,
      okLabel: "Xóa",
    });
    if (!ok) return;
    const res2 = await Api.del(`/api/v1/diagrams/${d.id}`);
    if (res2.success) {
      Toast.ok("Đã xóa sơ đồ.");
      const item = document.querySelector(`[data-id="${d.id}"]`)?.closest(".diagram-item");
      if (item) item.remove();
      setTimeout(() => window.location.reload(), 400);
    } else {
      Toast.error(res2.error?.message || "Không xóa được.");
    }
  }
})();
