/* Phương tiện: ảnh / GIF / video / nhúng (YouTube, Canva, ...).
 *  - parseMediaInput(): nhận mã <iframe> hoặc liên kết → chuẩn hóa thành phần tử chèn được.
 *  - processImageFile(): đọc ảnh tải lên, nén ảnh tĩnh, giữ nguyên ảnh động (GIF/WebP/APNG).
 *  - MediaLayer: lớp HTML nằm DƯỚI canvas SVG, vẽ video và iframe (không tạo lại khi kéo thả → video không bị tải lại).
 * Danh sách tên miền được nhúng lấy từ máy chủ (BOOT.embedHosts), khớp với CSP frame-src.
 */
(function () {
"use strict";

const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)(?:$|[?#])/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(?:$|[?#])/i;

function hostAllowed(hostname, hosts) {
  const h = String(hostname || "").toLowerCase();
  return (hosts || []).some((d) => h === d || h.endsWith("." + d));
}

/** Kích thước mặc định (khi chèn) theo loại nội dung nhúng. */
function defaultSize(provider, ratio) {
  if (provider === "spotify-compact") return { w: 480, h: 152 };
  if (provider === "spotify") return { w: 480, h: 380 };
  if (provider === "soundcloud") return { w: 480, h: 180 };
  if (provider === "tiktok") return { w: 325, h: 575 };
  const r = ratio && isFinite(ratio) && ratio > 0.2 && ratio < 6 ? ratio : 16 / 9;
  const w = r < 1 ? 360 : 560;
  return { w, h: Math.round(w / r) };
}

function fail(error) { return { ok: false, error }; }

/** Đổi liên kết "xem" thông thường thành liên kết nhúng. Trả về null nếu không nhận diện được. */
function convertKnown(u, ctx) {
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const q = u.searchParams;

  // ----- YouTube -----
  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    let id = null;
    if (host === "youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = q.get("v");
    else if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1];
    const list = q.get("list");
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(q.get("t") || q.get("start") || "");
    const start = m && (m[1] || m[2] || m[3]) ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    if (id && /^[\w-]{6,20}$/.test(id)) {
      const p = new URLSearchParams({ rel: "0" });
      if (start) p.set("start", String(start));
      if (list) p.set("list", list);
      return { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${p}`, ratio: parts[0] === "shorts" ? 9 / 16 : 16 / 9 };
    }
    if (list && /^[\w-]{10,60}$/.test(list)) {
      return { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, ratio: 16 / 9 };
    }
    return null;
  }
  // ----- Vimeo -----
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parts.find((p) => /^\d{5,}$/.test(p));
    const hash = parts.find((p) => /^[0-9a-f]{8,}$/i.test(p) && p !== id) || q.get("h");
    if (id) return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}${hash ? "?h=" + hash : ""}`, ratio: 16 / 9 };
    return null;
  }
  // ----- Canva -----
  if (host.endsWith("canva.com") && parts[0] === "design" && parts.length >= 3) {
    return { provider: "canva", embedUrl: `https://www.canva.com/design/${parts[1]}/${parts[2]}/view?embed`, ratio: 16 / 9 };
  }
  // ----- Spotify -----
  if (host === "open.spotify.com") {
    const rest = parts[0] && parts[0].startsWith("intl-") ? parts.slice(1) : parts;
    if (rest[0] === "embed") return { provider: rest[1] === "track" ? "spotify-compact" : "spotify", embedUrl: u.href, ratio: 1 };
    if (["track", "album", "playlist", "episode", "show", "artist"].includes(rest[0]) && rest[1]) {
      return { provider: rest[0] === "track" ? "spotify-compact" : "spotify", embedUrl: `https://open.spotify.com/embed/${rest[0]}/${rest[1]}`, ratio: 1 };
    }
    return null;
  }
  // ----- SoundCloud -----
  if (host === "soundcloud.com") {
    return { provider: "soundcloud", embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href.split("?")[0])}`, ratio: 3 };
  }
  // ----- Loom -----
  if (host.endsWith("loom.com") && (parts[0] === "share" || parts[0] === "embed") && parts[1]) {
    return { provider: "loom", embedUrl: `https://www.loom.com/embed/${parts[1]}`, ratio: 16 / 9 };
  }
  // ----- Dailymotion -----
  if (host === "dai.ly" && parts[0]) return { provider: "dailymotion", embedUrl: `https://www.dailymotion.com/embed/video/${parts[0]}`, ratio: 16 / 9 };
  if (host.endsWith("dailymotion.com") && parts[0] === "video" && parts[1]) {
    return { provider: "dailymotion", embedUrl: `https://www.dailymotion.com/embed/video/${parts[1].split("_")[0]}`, ratio: 16 / 9 };
  }
  // ----- Streamable -----
  if (host === "streamable.com" && parts[0]) {
    const id = parts[0] === "e" ? parts[1] : parts[0];
    if (id) return { provider: "streamable", embedUrl: `https://streamable.com/e/${id}`, ratio: 16 / 9 };
  }
  // ----- TikTok -----
  if (host.endsWith("tiktok.com")) {
    const i = parts.indexOf("video");
    if (i >= 0 && parts[i + 1]) return { provider: "tiktok", embedUrl: `https://www.tiktok.com/embed/v2/${parts[i + 1]}`, ratio: 9 / 16 };
    if (parts[0] === "embed") return { provider: "tiktok", embedUrl: u.href, ratio: 9 / 16 };
    return null;
  }
  // ----- Twitch (cần tham số parent = tên miền của trang) -----
  if (host === "twitch.tv" || host === "player.twitch.tv") {
    const parent = ctx.hostname || "localhost";
    if (host === "player.twitch.tv") {
      const url = new URL(u.href);
      url.searchParams.set("parent", parent);
      return { provider: "twitch", embedUrl: url.href, ratio: 16 / 9 };
    }
    if (parts[0] === "videos" && parts[1]) return { provider: "twitch", embedUrl: `https://player.twitch.tv/?video=${parts[1]}&parent=${encodeURIComponent(parent)}&autoplay=false`, ratio: 16 / 9 };
    if (parts[0]) return { provider: "twitch", embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(parts[0])}&parent=${encodeURIComponent(parent)}&autoplay=false`, ratio: 16 / 9 };
    return null;
  }
  // ----- Figma -----
  if (host.endsWith("figma.com")) {
    if (parts[0] === "embed") return { provider: "figma", embedUrl: u.href, ratio: 16 / 10 };
    if (["file", "design", "proto", "board", "slides", "deck"].includes(parts[0])) {
      return { provider: "figma", embedUrl: `https://www.figma.com/embed?embed_host=diagram&url=${encodeURIComponent(u.href)}`, ratio: 16 / 10 };
    }
    return null;
  }
  // ----- Google Drive / Docs / Slides / Sheets / Forms / Maps -----
  if (host === "drive.google.com") {
    const i = parts.indexOf("d");
    if (i >= 0 && parts[i + 1]) return { provider: "google-drive", embedUrl: `https://drive.google.com/file/d/${parts[i + 1]}/preview`, ratio: 16 / 9 };
    if (parts[0] === "embeddedfolderview") return { provider: "google-drive", embedUrl: u.href, ratio: 4 / 3 };
    return null;
  }
  if (host === "docs.google.com") {
    const kind = parts[0];
    const i = parts.indexOf("d");
    const id = i >= 0 ? parts[i + 1] : null;
    if (id && id !== "e") {
      if (kind === "presentation") return { provider: "google-slides", embedUrl: `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=3000`, ratio: 16 / 9 };
      if (kind === "document") return { provider: "google-docs", embedUrl: `https://docs.google.com/document/d/${id}/preview`, ratio: 3 / 4 };
      if (kind === "spreadsheets") return { provider: "google-sheets", embedUrl: `https://docs.google.com/spreadsheets/d/${id}/preview`, ratio: 4 / 3 };
      if (kind === "forms") return { provider: "google-forms", embedUrl: `https://docs.google.com/forms/d/${id}/viewform?embedded=true`, ratio: 3 / 4 };
    }
    return { provider: "google", embedUrl: u.href, ratio: 16 / 9 }; // link "xuất bản lên web" (d/e/...) dùng nguyên
  }
  if (host === "google.com" && parts[0] === "maps") {
    if (parts[1] === "embed") return { provider: "google-maps", embedUrl: u.href, ratio: 4 / 3 };
    const place = q.get("q") || (parts[1] === "place" ? decodeURIComponent(parts[2] || "").replace(/\+/g, " ") : "");
    if (place) return { provider: "google-maps", embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(place)}&output=embed`, ratio: 4 / 3 };
    return { error: "Google Maps: hãy dùng Chia sẻ → Nhúng bản đồ rồi dán mã <iframe>." };
  }
  return null;
}

/**
 * Phân tích nội dung người dùng dán vào ô "Nhúng": mã <iframe> hoặc liên kết.
 * Kết quả:
 *   {ok:true, kind:"embed", provider, embedUrl, ratio, title, size:{w,h}}
 *   {ok:true, kind:"video"|"image", src, ...}      (khi dán thẳng liên kết tệp video/ảnh)
 *   {ok:false, error}
 */
function parseMediaInput(raw, hosts, ctx = {}) {
  raw = String(raw || "").trim();
  if (!raw) return fail("Hãy dán mã nhúng (<iframe …>) hoặc liên kết.");
  ctx = { hostname: ctx.hostname || (typeof location !== "undefined" ? location.hostname : "localhost") };
  let url = null, ratio = null, title = "";

  if (/<iframe[\s>]/i.test(raw)) {
    let doc;
    try { doc = new DOMParser().parseFromString(raw, "text/html"); } catch { return fail("Không đọc được mã nhúng."); }
    const f = doc.querySelector("iframe");
    url = f && f.getAttribute("src");
    if (!url) return fail("Mã nhúng không có thuộc tính src.");
    title = (f.getAttribute("title") || "").slice(0, 120);
    // Tỉ lệ khung: ưu tiên padding-top: NN% của khối bọc (kiểu Canva), sau đó width/height của iframe
    const wrap = f.closest("div[style]");
    const pt = wrap && /padding-top:\s*([\d.]+)%/i.exec(wrap.getAttribute("style") || "");
    if (pt && +pt[1] > 0) ratio = 100 / +pt[1];
    else {
      const w = parseFloat(f.getAttribute("width")), h = parseFloat(f.getAttribute("height"));
      if (w > 0 && h > 0) ratio = w / h;
    }
  } else {
    const m = raw.match(/https?:\/\/[^\s"'<>]+/i);
    url = m ? m[0] : raw.split(/\s+/)[0];
    if (!/^https?:\/\//i.test(url) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) url = "https://" + url;
  }
  if (url.startsWith("//")) url = "https:" + url;
  url = url.replace(/&amp;/g, "&");

  let u;
  try { u = new URL(url); } catch { return fail("Liên kết không hợp lệ."); }
  if (u.protocol === "http:") u.protocol = "https:"; // hầu hết dịch vụ đều hỗ trợ https
  if (u.protocol !== "https:") return fail("Chỉ hỗ trợ liên kết bắt đầu bằng https://");

  // Dán thẳng tệp video / ảnh
  if (VIDEO_EXT.test(u.pathname + u.search)) return { ok: true, kind: "video", src: u.href, ratio: ratio || 16 / 9 };
  if (IMAGE_EXT.test(u.pathname)) return { ok: true, kind: "image", src: u.href };

  let conv = null;
  try { conv = convertKnown(u, ctx); } catch { conv = null; }
  if (conv && conv.error) return fail(conv.error);
  const embedUrl = conv ? conv.embedUrl : u.href;
  const provider = conv ? conv.provider : u.hostname.replace(/^www\./, "").split(".").slice(-2, -1)[0] || "web";
  let eu;
  try { eu = new URL(embedUrl); } catch { return fail("Liên kết nhúng không hợp lệ."); }
  if (!hostAllowed(eu.hostname, hosts)) {
    return fail(`Trang "${eu.hostname}" chưa được hỗ trợ nhúng. Quản trị viên có thể thêm vào biến EMBED_EXTRA_HOSTS.`);
  }
  const r = ratio || (conv && conv.ratio) || 16 / 9;
  return { ok: true, kind: "embed", provider, embedUrl: eu.href, ratio: r, title, size: defaultSize(provider, r) };
}

/* ============ ảnh tải lên ============ */

function bytesToDataUrl(bytes, mime) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}
function sniffMime(b, fallback) {
  const s = (from, str) => str.split("").every((c, i) => b[from + i] === c.charCodeAt(0));
  if (b[0] === 0x89 && s(1, "PNG")) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (s(0, "GIF8")) return "image/gif";
  if (s(0, "RIFF") && s(8, "WEBP")) return "image/webp";
  if (s(4, "ftyp") && (s(8, "avif") || s(8, "avis"))) return "image/avif";
  const head = String.fromCharCode.apply(null, b.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return fallback || "";
}
function hasAscii(bytes, text, maxScan = 4096) {
  const n = Math.min(bytes.length - text.length, maxScan);
  outer: for (let i = 0; i <= n; i++) {
    for (let j = 0; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}
function isAnimated(bytes, mime) {
  if (mime === "image/gif") return true; // giữ nguyên mọi GIF (có thể là ảnh động)
  if (mime === "image/png") return hasAscii(bytes, "acTL", 256);
  if (mime === "image/webp") return hasAscii(bytes, "ANIM", 64);
  if (mime === "image/avif") return hasAscii(bytes, "avis", 64);
  return false;
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Không đọc được ảnh."));
    img.src = src;
  });
}
function loadImageSize(src) {
  return loadImage(src).then((img) => ({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 }));
}
function loadVideoSize(src) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (w, h) => { v.removeAttribute("src"); v.load(); resolve({ w: w || 560, h: h || 315 }); };
    v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight);
    v.onerror = () => done(0, 0);
    setTimeout(() => done(0, 0), 6000);
    v.src = src;
  });
}

const MAX_UPLOAD_CHARS = 3.4 * 1024 * 1024; // dưới giới hạn 4M ký tự/ảnh của máy chủ

/**
 * Đọc ảnh người dùng chọn → { src (data URI), width, height, animated }.
 * Ảnh tĩnh: thu nhỏ còn tối đa 1920px và nén lại. Ảnh động: giữ nguyên nếu đủ nhẹ.
 */
async function processImageFile(file, { maxDim = 1920 } = {}) {
  if (!file) throw new Error("Chưa chọn tệp.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes, file.type);
  if (!/^image\//.test(mime)) throw new Error("Tệp này không phải ảnh (hỗ trợ PNG, JPG, GIF, WebP, AVIF, SVG).");
  const animated = isAnimated(bytes, mime);

  if (mime === "image/svg+xml" || animated) {
    const src = bytesToDataUrl(bytes, mime);
    if (src.length > MAX_UPLOAD_CHARS) {
      throw new Error(animated
        ? "Ảnh động quá nặng (tối đa khoảng 2,5MB). Hãy dán liên kết ảnh thay vì tải lên."
        : "Tệp SVG quá nặng (tối đa khoảng 2,5MB).");
    }
    const size = await loadImageSize(src).catch(() => ({ w: 400, h: 300 }));
    return { src, width: size.w, height: size.h, animated, mime };
  }

  // Ảnh tĩnh: có thể nén
  const original = bytesToDataUrl(bytes, mime);
  const direct = ["image/png", "image/jpeg", "image/webp", "image/avif"].includes(mime);
  let img;
  try { img = await loadImage(original); } catch { throw new Error("Không đọc được ảnh này. Hãy thử PNG hoặc JPG."); }
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const longest = Math.max(nw, nh);
  if (direct && longest <= maxDim && original.length <= 700 * 1024) return { src: original, width: nw, height: nh, animated: false, mime };

  const alpha = mime !== "image/jpeg";
  let dim = Math.min(maxDim, longest);
  for (let attempt = 0; attempt < 5; attempt++) {
    const k = dim / longest;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(nw * k)); c.height = Math.max(1, Math.round(nh * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL(alpha ? "image/webp" : "image/jpeg", 0.88);
    if (out.startsWith("data:image/png") && !alpha) out = c.toDataURL("image/jpeg", 0.88);
    if (direct && k === 1 && original.length <= out.length && original.length <= MAX_UPLOAD_CHARS) out = original;
    if (out.length <= MAX_UPLOAD_CHARS) return { src: out, width: c.width, height: c.height, animated: false, mime };
    dim = Math.round(dim * 0.72);
  }
  throw new Error("Ảnh quá nặng. Hãy chọn ảnh nhỏ hơn hoặc dán liên kết ảnh.");
}

/* ============ lớp HTML cho video / nhúng ============ */

class MediaLayer {
  constructor(host, svg, { readOnly = false } = {}) {
    this.host = host;
    this.readOnly = readOnly;
    this.nodes = new Map();
    this.interactiveId = null;
    this.onInteractChange = null;
    this.root = document.createElement("div");
    this.root.className = "media-layer";
    this.world = document.createElement("div");
    this.world.className = "media-world";
    this.root.appendChild(this.world);
    host.insertBefore(this.root, svg);

    this._onDown = (e) => {
      if (!this.interactiveId) return;
      if (e.target.closest && e.target.closest(".media-box.is-interactive")) return;
      this.setInteractive(null);
    };
    this._onKey = (e) => { if (e.key === "Escape" && this.interactiveId) { e.stopPropagation(); this.setInteractive(null); } };
    document.addEventListener("pointerdown", this._onDown, true);
    document.addEventListener("keydown", this._onKey, true);
    // Bấm vào bên trong iframe không phát sinh pointerdown ở trang này; chuyển tiêu điểm sang cửa sổ khác thì không thoát.
  }

  get isInteracting() { return !!this.interactiveId; }

  setTransform(px, py, z) {
    this.world.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    this.world.style.setProperty("--zoom", String(z));
  }

  /** Bật/tắt chế độ tương tác (cho phép bấm/phát bên trong video, iframe). */
  setInteractive(id) {
    if (id && !this.nodes.has(id)) id = null;
    if (id === this.interactiveId) return;
    if (this.interactiveId) this.nodes.get(this.interactiveId)?.classList.remove("is-interactive");
    this.interactiveId = id;
    this.root.classList.toggle("has-interactive", !!id);
    this.host.classList.toggle("media-interactive", !!id);
    if (id) this.nodes.get(id).classList.add("is-interactive");
    this.onInteractChange?.(id);
  }

  sync(elements) {
    const seen = new Set();
    elements.forEach((e, i) => {
      if (e.type !== "embed" && e.type !== "video") return;
      seen.add(e.id);
      let n = this.nodes.get(e.id);
      if (!n || n._type !== e.type) {
        if (n) n.remove();
        n = e.type === "embed" ? this.makeEmbed(e) : this.makeVideo(e);
        this.nodes.set(e.id, n);
        this.world.appendChild(n);
      }
      this.update(n, e, i);
    });
    for (const [id, n] of this.nodes) {
      if (!seen.has(id)) {
        if (this.interactiveId === id) this.setInteractive(null);
        n.remove();
        this.nodes.delete(id);
      }
    }
  }

  update(n, e, z) {
    const st = n.style;
    st.left = e.x + "px"; st.top = e.y + "px";
    st.width = (e.width || 0) + "px"; st.height = (e.height || 0) + "px";
    st.transform = e.rotation ? `rotate(${e.rotation}deg)` : "";
    st.zIndex = String(z);
    const s = e.style || {};
    st.opacity = s.opacity != null ? String(s.opacity) : "";
    st.borderRadius = (s.radius || 0) + "px";
    st.boxShadow = s.shadow === false ? "none" : "";
    if (e.type === "embed") {
      const f = n.querySelector("iframe");
      if (e.embedUrl && n._src !== e.embedUrl && /^https:\/\//i.test(e.embedUrl)) { n._src = e.embedUrl; f.src = e.embedUrl; }
      f.title = e.title || e.provider || "Nội dung nhúng";
      n.querySelector(".media-label").textContent = e.title || e.provider || "Đang tải…";
    } else {
      const v = n.querySelector("video");
      if (e.src && n._src !== e.src && /^(https:|data:|blob:)/i.test(e.src)) { n._src = e.src; v.src = e.src; }
      v.loop = !!e.loop; v.muted = !!(e.muted || e.autoplay);
      v.controls = e.controls !== false;
      if (e.autoplay && this.readOnly) v.play().catch(() => {});
    }
  }

  chip() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "media-exit";
    b.textContent = "Thoát tương tác (Esc)";
    b.addEventListener("click", () => this.setInteractive(null));
    return b;
  }

  makeEmbed(e) {
    const box = document.createElement("div");
    box.className = "media-box media-embed";
    box.dataset.id = e.id;
    box._type = "embed";
    const label = document.createElement("span");
    label.className = "media-label";
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation");
    f.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write; web-share");
    f.setAttribute("allowfullscreen", "");
    // Cần Referer thì YouTube mới phát được; trang đặt Referrer-Policy: no-referrer nên ghi đè riêng cho iframe.
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.setAttribute("loading", "lazy");
    box.append(label, f, this.chip());
    return box;
  }

  makeVideo(e) {
    const box = document.createElement("div");
    box.className = "media-box media-video";
    box.dataset.id = e.id;
    box._type = "video";
    const v = document.createElement("video");
    v.setAttribute("playsinline", "");
    v.preload = "metadata";
    box.append(v, this.chip());
    return box;
  }

  destroy() {
    document.removeEventListener("pointerdown", this._onDown, true);
    document.removeEventListener("keydown", this._onKey, true);
    this.root.remove();
  }
}

window.__DIAGRAM_MEDIA__ = {
  parseMediaInput, defaultSize, processImageFile, loadImageSize, loadVideoSize, MediaLayer, hostAllowed, VIDEO_EXT, IMAGE_EXT,
};
})();
