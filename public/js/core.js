/* Diagram — client core: boot, api client, theme, ui (toast/modal/menu), báo lỗi development */
"use strict";

/* ============ Boot data (server nhúng vào trang) ============ */

function parseBoot() {
  const el = document.getElementById("boot-data");
  if (!el) return { user: null };
  try {
    return JSON.parse(el.textContent);
  } catch (e) {
    console.error("[boot] Không đọc được #boot-data:", e);
    return { user: null };
  }
}

const BOOT = parseBoot();
/** true khi server chạy NODE_ENV=development: lỗi hiện toast + popup chi tiết. */
const IS_DEV = BOOT.dev === true;

/* ============ Helpers ============ */

/** Bỏ origin khỏi đường dẫn file trong stack cho dễ đọc: http://localhost:3000/js/a.js → /js/a.js */
function shortenUrls(text) {
  return String(text ?? "").split(window.location.origin).join("");
}

/* ============ API client (CSRF-aware) ============ */

const Api = {
  csrfToken: null,

  init() {
    if (BOOT.csrfToken) this.csrfToken = BOOT.csrfToken;
  },

  /** Token CSRF: ưu tiên giá trị server nhúng vào trang, dự phòng đọc cookie diagram_csrf ("<token>.<hmac>"). */
  getCsrfToken() {
    if (this.csrfToken) return this.csrfToken;
    const m = document.cookie.match(/(?:^|;\s*)diagram_csrf=([^;]+)/);
    if (m) {
      const v = decodeURIComponent(m[1]);
      const i = v.lastIndexOf(".");
      if (i > 0) return v.slice(0, i);
    }
    return null;
  },

  async call(method, path, body) {
    const opts = {
      method,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    if (method !== "GET" && method !== "HEAD") {
      const token = this.getCsrfToken();
      if (token) opts.headers["X-CSRF-Token"] = token;
    }

    let res;
    try {
      res = await fetch(path, opts);
    } catch (cause) {
      const result = {
        success: false,
        error: { code: "NETWORK", message: "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại." },
      };
      DevErrors.reportApi(result, { method, path, status: 0, cause });
      return result;
    }

    let data = null;
    try { data = await res.json(); } catch { /* không phải JSON */ }
    if (!data || typeof data !== "object") {
      const result = {
        success: false,
        error: { code: "BAD_RESPONSE", message: `Phản hồi không hợp lệ từ máy chủ (HTTP ${res.status}).` },
      };
      DevErrors.reportApi(result, { method, path, status: res.status });
      return result;
    }
    if (!data.success) DevErrors.reportApi(data, { method, path, status: res.status });
    return data;
  },

  get(path) { return this.call("GET", path); },
  post(path, body) { return this.call("POST", path, body); },
  patch(path, body) { return this.call("PATCH", path, body); },
  del(path) { return this.call("DELETE", path); },
};

/* ============ Theme ============ */

const Theme = {
  init() {
    const saved = this.load();
    this.apply(saved);
  },
  load() {
    try { return localStorage.getItem("diagram-theme") || "system"; } catch { return "system"; }
  },
  apply(mode) {
    const root = document.documentElement;
    if (mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches)) {
      root.dataset.theme = "dark";
    } else {
      root.dataset.theme = "light";
    }
    try { localStorage.setItem("diagram-theme", mode); } catch { /* ignore */ }
  },
  toggle() {
    // Dựa vào giao diện đang hiển thị (kể cả khi đang ở chế độ "system")
    const next = this.isDark() ? "light" : "dark";
    this.apply(next);
    return next;
  },
  isDark() {
    return document.documentElement.dataset.theme === "dark";
  },
};

/* ============ Toast ============ */

const Toast = {
  wrap: null,

  ensure() {
    if (!this.wrap) {
      this.wrap = document.createElement("div");
      this.wrap.className = "toast-wrap";
      this.wrap.setAttribute("role", "status");
      this.wrap.setAttribute("aria-live", "polite");
      document.body.appendChild(this.wrap);
    }
    return this.wrap;
  },

  /**
   * show(message, type, ms, { onClick, hint })
   * - ms = 0: không tự đóng.
   * - onClick: toast trở thành nút bấm (vd mở popup chi tiết lỗi).
   */
  show(message, type = "info", ms = 3200, opts = {}) {
    const wrap = this.ensure();
    const el = document.createElement("div");
    el.className = `toast ${type}`;

    const content = document.createElement("div");
    content.className = "toast-body";
    const msg = document.createElement("span");
    msg.className = "toast-msg";
    msg.textContent = message; // textContent = XSS-safe
    content.appendChild(msg);
    if (opts.hint) {
      const hint = document.createElement("span");
      hint.className = "toast-hint";
      hint.textContent = opts.hint;
      content.appendChild(hint);
    }
    el.appendChild(content);

    const close = document.createElement("button");
    close.className = "toast-close";
    close.type = "button";
    close.setAttribute("aria-label", "Đóng thông báo");
    close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    close.addEventListener("click", (e) => { e.stopPropagation(); this.dismiss(el); });
    el.appendChild(close);

    if (typeof opts.onClick === "function") {
      el.classList.add("clickable");
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.addEventListener("click", () => opts.onClick(el));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onClick(el); }
      });
    }

    wrap.appendChild(el);
    if (ms > 0) setTimeout(() => this.dismiss(el), ms);
    return el;
  },

  ok(msg) { return this.show(msg, "ok"); },
  error(msg) { return this.show(msg, "error", 4500); },
  warn(msg) { return this.show(msg, "warn", 4000); },

  /**
   * Toast lỗi cho development: hiện tóm tắt, bấm vào để mở popup chi tiết (stack, file:dòng...).
   * Lỗi trùng nhau liên tiếp được gộp lại và đếm số lần.
   */
  debug(info) {
    const key = `${info.name}|${info.message}|${info.location}`;
    const existing = [...this.ensure().querySelectorAll(".toast.dev")].find((t) => t.dataset.key === key);
    if (existing) {
      const n = Number(existing.dataset.count || 1) + 1;
      existing.dataset.count = String(n);
      existing.querySelector(".toast-msg").textContent = `[DEV ×${n}] ${this._summary(info)}`;
      return existing;
    }
    // Giữ tối đa 4 toast dev cùng lúc
    const devToasts = this.wrap.querySelectorAll(".toast.dev");
    if (devToasts.length >= 4) this.dismiss(devToasts[0]);

    const el = this.show(`[DEV] ${this._summary(info)}`, "error dev", 20000, {
      hint: "Bấm để xem chi tiết lỗi",
      onClick: () => UI.errorDetail(info),
    });
    el.dataset.key = key;
    return el;
  },

  _summary(info) {
    const where = info.location ? ` — ${info.location}` : "";
    const text = `${info.name && info.name !== "Error" ? info.name + ": " : ""}${info.message}${where}`;
    return text.length > 180 ? text.slice(0, 177) + "…" : text;
  },

  dismiss(el) {
    if (!el || el.classList.contains("hide")) return;
    el.classList.add("hide");
    setTimeout(() => el.remove(), 250);
  },
};

/* ============ Modal / Confirm dialog / Chi tiết lỗi ============ */

const UI = {
  activeModal: null,

  /**
   * modal({ title, body, actions: [{label, class, value, autofocus}], wide })
   * → Promise<value|null>  (null khi đóng bằng Esc / bấm nền)
   */
  modal({ title, body, wide = false, actions = [{ label: "Đóng", class: "btn-secondary", value: "close" }] }) {
    return new Promise((resolve) => {
      if (this.activeModal) this.closeModal(this.activeModal, null);

      const previouslyFocused = document.activeElement;
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop._resolve = resolve;
      backdrop._returnFocus = previouslyFocused;

      const modal = document.createElement("div");
      modal.className = wide ? "modal modal-wide" : "modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", title);

      const h = document.createElement("h3");
      h.textContent = title;
      modal.appendChild(h);

      const p = document.createElement("div");
      p.className = "modal-body";
      if (typeof body === "string") {
        const span = document.createElement("p");
        span.textContent = body; // XSS-safe
        p.appendChild(span);
      } else if (body instanceof Node) {
        p.appendChild(body);
      }
      modal.appendChild(p);

      const row = document.createElement("div");
      row.className = "modal-actions";
      for (const a of actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `btn ${a.class || "btn-secondary"}`;
        btn.textContent = a.label;
        if (a.value === "confirm-primary" || a.autofocus) btn.autofocus = true;
        btn.addEventListener("click", () => this.closeModal(backdrop, a.value));
        row.appendChild(btn);
      }
      modal.appendChild(row);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      this.activeModal = backdrop;

      // Hiện popup (thêm class "open" sau khi gắn vào DOM để chạy transition)
      requestAnimationFrame(() => backdrop.classList.add("open"));

      // Focus: nút autofocus, nếu không có thì phần tử focus được đầu tiên
      const focusables = [...modal.querySelectorAll("button, input, select, textarea, [tabindex]")];
      (focusables.find((x) => x.autofocus) || focusables[0])?.focus();

      backdrop.addEventListener("mousedown", (e) => {
        if (e.target === backdrop) this.closeModal(backdrop, null);
      });

      // Esc đóng popup dù focus đang ở đâu
      backdrop._onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); this.closeModal(backdrop, null); }
      };
      document.addEventListener("keydown", backdrop._onKey, true);

      // Giữ focus trong popup
      modal.addEventListener("keydown", (e) => {
        if (e.key !== "Tab") return;
        const list = [...modal.querySelectorAll("button, input, select, textarea")].filter((x) => !x.disabled);
        if (list.length === 0) return;
        e.preventDefault();
        const idx = list.indexOf(document.activeElement);
        const next = e.shiftKey ? (idx <= 0 ? list.length - 1 : idx - 1) : (idx === list.length - 1 ? 0 : idx + 1);
        list[next].focus();
      });
    });
  },

  /** Đóng popup (mặc định: popup đang mở) và trả `value` cho Promise của modal(). */
  closeModal(backdrop, value = null) {
    backdrop = backdrop || this.activeModal;
    if (!backdrop || backdrop._closed) return;
    backdrop._closed = true;
    backdrop.classList.remove("open");
    document.removeEventListener("keydown", backdrop._onKey, true);
    setTimeout(() => backdrop.remove(), 200);
    if (this.activeModal === backdrop) this.activeModal = null;
    try { backdrop._returnFocus?.focus?.(); } catch { /* phần tử đã bị gỡ */ }
    backdrop._resolve?.(value);
  },

  /** confirm({ title, message, okLabel, danger }) → Promise<bool> */
  confirm({ title, message, okLabel = "Xóa", danger = true, cancelLabel = "Hủy" }) {
    return this.modal({
      title,
      body: message,
      actions: [
        { label: cancelLabel, class: "btn-secondary", value: false },
        { label: okLabel, class: danger ? "btn-danger" : "btn-primary", value: true },
      ],
    }).then((v) => v === true);
  },

  /** Sao chép văn bản vào clipboard. Trả về true nếu thành công. */
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let done = false;
      try { done = document.execCommand("copy"); } catch { /* bỏ qua */ }
      ta.remove();
      return done;
    }
  },

  /** Popup chi tiết lỗi (development): thông báo, vị trí file:dòng, request, stack trace. */
  errorDetail(info) {
    const body = document.createElement("div");
    body.className = "err-detail";

    const rows = [
      ["Thông báo", info.message],
      ["Loại lỗi", [info.name, info.code].filter(Boolean).join(" · ")],
      ["Vị trí", info.location],
      ["Nguồn", info.source === "server" ? "Máy chủ (Node.js)" : info.source === "client" ? "Trình duyệt (JavaScript)" : info.source],
      ["Yêu cầu", info.request ? `${info.request.method} ${info.request.url}` : null],
      ["HTTP", info.status ? String(info.status) : null],
      ["Request ID", info.request?.requestId],
      ["Thời điểm", info.time],
      ["Node", info.node],
    ].filter(([, v]) => v);

    const dl = document.createElement("dl");
    dl.className = "err-meta";
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    body.appendChild(dl);

    const addBlock = (label, text) => {
      if (!text) return;
      const lab = document.createElement("div");
      lab.className = "err-label";
      lab.textContent = label;
      const pre = document.createElement("pre");
      pre.className = "err-stack";
      pre.textContent = text; // textContent = XSS-safe
      body.append(lab, pre);
    };
    addBlock("Stack trace", info.stack);
    addBlock("Nguyên nhân (cause)", info.cause);

    const plain = [
      ...rows.map(([k, v]) => `${k}: ${v}`),
      info.stack ? `\nStack trace:\n${info.stack}` : "",
      info.cause ? `\nCause:\n${info.cause}` : "",
    ].join("\n");

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-secondary btn-sm";
    copyBtn.textContent = "Sao chép chi tiết";
    copyBtn.addEventListener("click", async () => {
      const ok = await this.copyText(plain);
      copyBtn.textContent = ok ? "Đã sao chép!" : "Không sao chép được";
      setTimeout(() => { copyBtn.textContent = "Sao chép chi tiết"; }, 1800);
    });
    body.appendChild(copyBtn);

    return this.modal({
      title: "Chi tiết lỗi (chế độ development)",
      body,
      wide: true,
      actions: [{ label: "Đóng", class: "btn-primary", value: "close", autofocus: true }],
    });
  },
};

/* ============ Báo lỗi (DevErrors) ============ */

const DevErrors = {
  lastGenericAt: 0,

  /** Lỗi từ API. Development: toast + popup chi tiết cho lỗi server (500...) và lỗi mạng. */
  reportApi(result, ctx) {
    const e = result?.error || {};
    const transport = e.code === "NETWORK" || e.code === "BAD_RESPONSE";
    if (!IS_DEV) return;                 // production: trang tự hiện toast thân thiện từ e.message
    if (!e.debug && !transport) return;  // lỗi nghiệp vụ (validation, 401...) không phải bug → không báo

    const d = e.debug || {};
    Toast.debug({
      source: "server",
      name: d.name || (transport ? "NetworkError" : "Error"),
      message: d.message || e.message,
      code: d.code || e.code,
      status: d.status || ctx.status || undefined,
      location: d.location || null,
      stack: d.stack || (ctx.cause && ctx.cause.stack ? shortenUrls(ctx.cause.stack) : null),
      cause: d.cause,
      request: d.request || { method: ctx.method, url: ctx.path },
      time: d.time || new Date().toISOString(),
      node: d.node,
    });
  },

  /** Lỗi JavaScript chạy trên trình duyệt (error / unhandledrejection). */
  reportJs({ name, message, location, stack }) {
    console.error(`[${name || "Error"}] ${message}`, location || "", stack || "");
    if (IS_DEV) {
      Toast.debug({
        source: "client",
        name: name || "Error",
        message: message || "Lỗi JavaScript không xác định",
        location: location || null,
        stack: stack ? shortenUrls(stack) : null,
        request: { method: "GET", url: shortenUrls(window.location.href) },
        time: new Date().toISOString(),
      });
      return;
    }
    // Production: một toast chung, tối đa 1 lần / 8 giây (tránh spam)
    const t = Date.now();
    if (t - this.lastGenericAt > 8000) {
      this.lastGenericAt = t;
      Toast.error("Đã xảy ra lỗi không mong muốn. Nếu chức năng không hoạt động, hãy tải lại trang.");
    }
  },

  install() {
    // capture = true để bắt cả lỗi tải tài nguyên (<script>, <link>, <img>) — những lỗi này không nổi bọt.
    window.addEventListener("error", (ev) => {
      if (ev.target && ev.target !== window) {
        const url = ev.target.src || ev.target.href;
        if (IS_DEV && url) {
          this.reportJs({ name: "ResourceError", message: `Không tải được tài nguyên: ${shortenUrls(url)}`, location: shortenUrls(url) });
        }
        return;
      }
      const msg = String(ev.message || "");
      if (msg.includes("ResizeObserver loop")) return;        // vô hại, trình duyệt tự sinh
      if (msg === "Script error." && !ev.filename) return;    // lỗi cross-origin không có thông tin
      this.reportJs({
        name: ev.error?.name || "Error",
        message: ev.error?.message || msg,
        location: ev.filename ? `${shortenUrls(ev.filename)}:${ev.lineno}:${ev.colno}` : null,
        stack: ev.error?.stack,
      });
    }, true);

    window.addEventListener("unhandledrejection", (ev) => {
      const r = ev.reason;
      const stack = r instanceof Error ? r.stack : null;
      const loc = stack ? (stack.split("\n").find((l) => /:\d+:\d+/.test(l)) || "").trim() : "";
      this.reportJs({
        name: r instanceof Error ? r.name : "UnhandledRejection",
        message: r instanceof Error ? r.message : String(r),
        location: loc ? shortenUrls(loc.replace(/^at\s+/, "")) : null,
        stack,
      });
    });
  },
};

/* ============ Side menu (hamburger) ============ */

const SideMenu = {
  build({ items, user, currentPath }) {
    const backdrop = document.createElement("div");
    backdrop.className = "side-menu-backdrop";
    backdrop.addEventListener("click", () => this.close());
    document.body.appendChild(backdrop);

    const menu = document.createElement("nav");
    menu.className = "side-menu";
    menu.setAttribute("aria-label", "Menu chính");

    const head = document.createElement("div");
    head.className = "side-menu-head";
    const brand = document.createElement("a");
    brand.className = "brand";
    brand.href = "/";
    brand.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect x="4" y="4" width="56" height="56" rx="14" fill="#4f46e5"/><rect x="14" y="18" width="16" height="12" rx="3" fill="#fff" fill-opacity="0.95"/><rect x="36" y="36" width="16" height="12" rx="3" fill="#fff" fill-opacity="0.7"/><path d="M30 24 C34 24, 32 38, 36 40" stroke="#c7d2fe" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M36 40 l-4.5 -3 M36 40 l0.5 -5.5" stroke="#c7d2fe" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg><span>Diagram</span>';
    head.appendChild(brand);
    const closeBtn = document.createElement("button");
    closeBtn.className = "hamburger";
    closeBtn.setAttribute("aria-label", "Đóng menu");
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener("click", () => this.close());
    head.appendChild(closeBtn);
    menu.appendChild(head);

    if (user) {
      const u = document.createElement("div");
      u.className = "side-menu-user";
      const av = document.createElement("div");
      av.className = "avatar";
      av.textContent = (user.username || "?").slice(0, 1).toUpperCase();
      const meta = document.createElement("div");
      meta.className = "meta";
      const nm = document.createElement("div");
      nm.className = "name";
      nm.textContent = user.username; // XSS-safe
      const rl = document.createElement("div");
      rl.className = "role";
      rl.textContent = user.role === "admin" ? "admin" : "thành viên";
      meta.appendChild(nm);
      meta.appendChild(rl);
      u.appendChild(av);
      u.appendChild(meta);
      menu.appendChild(u);
    }

    for (const item of items) {
      if (item.adminOnly && user?.role !== "admin") continue;
      const a = document.createElement("a");
      a.className = "menu-link" + (currentPath === item.href ? " active" : "");
      a.href = item.href;
      a.innerHTML = ICONS[item.icon] || "";
      const label = document.createElement("span");
      label.textContent = item.label;
      a.appendChild(label);
      menu.appendChild(a);
    }

    const footer = document.createElement("div");
    footer.className = "side-menu-footer";
    const themeBtn = document.createElement("button");
    themeBtn.className = "menu-link";
    themeBtn.innerHTML = ICONS.theme;
    const tl = document.createElement("span");
    tl.textContent = "Chủ đề sáng/tối";
    themeBtn.appendChild(tl);
    themeBtn.addEventListener("click", () => {
      Theme.toggle();
    });
    footer.appendChild(themeBtn);
    if (user) {
      const logoutBtn = document.createElement("button");
      logoutBtn.className = "menu-link";
      logoutBtn.innerHTML = ICONS.logout;
      const ll = document.createElement("span");
      ll.textContent = "Đăng xuất";
      logoutBtn.appendChild(ll);
      logoutBtn.addEventListener("click", async () => {
        await Api.post("/api/v1/auth/logout");
        window.location.href = "/";
      });
      footer.appendChild(logoutBtn);
    }
    menu.appendChild(footer);
    document.body.appendChild(menu);
    this.menu = menu;
    this.backdrop = backdrop;
  },

  open() { this.menu?.classList.add("open"); this.backdrop?.classList.add("open"); },
  close() { this.menu?.classList.remove("open"); this.backdrop?.classList.remove("open"); },
};

/* ============ SVG icons (khong emoji, khong CDN) ============ */

const ICONS = {
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  home: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  layers: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>',
  settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  theme: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>',
  user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  dots: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  unlock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  grid: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3h18v18H3z"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
  select: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3l7 17 2.5-7.5L21 10z"/></svg>',
  hand: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34L3.4 15.8a2 2 0 0 1 2.83-2.82L8 15"/></svg>',
  rect: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
  roundRect: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="5"/></svg>',
  circle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>',
  diamond: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9z"/></svg>',
  line: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 19L19 5"/></svg>',
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19L19 5"/><path d="M9 5h10v10"/></svg>',
  connector: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="5" r="2.5"/><path d="M7 17.5C10 14 14 10 17 7"/></svg>',
  text: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M8 19h8"/></svg>',
  note: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  frame: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/></svg>',
  undo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 7"/></svg>',
  redo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 7"/></svg>',
  zoomIn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M21 21l-4.3-4.3"/></svg>',
  zoomOut: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M21 21l-4.3-4.3"/></svg>',
  fit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  reset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/></svg>',
};

/* ============ Khởi tạo ============ */

// QUAN TRỌNG: gán window.__DIAGRAM__ ĐỒNG BỘ ngay khi core.js chạy,
// vì các file auth.js / list.js / editor.js ... đọc nó ngay ở dòng đầu tiên.
Api.init();
Theme.init();
DevErrors.install();

window.__DIAGRAM__ = { Api, Toast, UI, Theme, SideMenu, ICONS, DevErrors, user: BOOT.user ?? null, BOOT, IS_DEV };

// Trang lỗi (404/500...) ở development: server nhúng sẵn chi tiết lỗi → hiện toast ngay.
if (IS_DEV && BOOT.debugError) {
  Toast.debug({ source: "server", ...BOOT.debugError });
}
