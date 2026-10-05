/**
 * Danh sách tên miền được phép NHÚNG (iframe) vào sơ đồ.
 *
 * Dùng ở 3 nơi, để luôn khớp nhau:
 *  - CSP `frame-src` (src/security/headers.js)
 *  - Kiểm tra dữ liệu khi lưu (src/validation/schema.js)
 *  - Client nhận qua boot-data (BOOT.embedHosts) để báo lỗi sớm khi dán link
 *
 * Muốn thêm trang khác: đặt biến môi trường EMBED_EXTRA_HOSTS="example.com,foo.bar"
 * (khớp cả tên miền con). Không dùng ký tự đại diện.
 */

export const BUILTIN_EMBED_HOSTS = [
  // Video
  'youtube.com', 'youtube-nocookie.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv',
  'loom.com', 'wistia.com', 'wistia.net', 'streamable.com', 'bilibili.com', 'tiktok.com',
  'facebook.com', 'instagram.com', 'vidyard.com',
  // Âm thanh
  'spotify.com', 'soundcloud.com', 'mixcloud.com',
  // Thiết kế / trình chiếu / tài liệu
  'canva.com', 'figma.com', 'miro.com', 'lucid.app', 'lucidchart.com', 'prezi.com',
  'genial.ly', 'genially.com', 'padlet.com', 'gamma.app', 'pitch.com', 'notion.so', 'airtable.com',
  'slideshare.net', 'scribd.com', 'issuu.com', 'flourish.studio', 'datawrapper.de',
  'whimsical.com', 'excalidraw.com', 'codepen.io', 'codesandbox.io', 'jsfiddle.net', 'observablehq.com',
  // Google / Microsoft
  'docs.google.com', 'drive.google.com', 'google.com', 'forms.gle',
  'onedrive.live.com', 'office.com', 'sharepoint.com', 'microsoft.com',
  // Bản đồ
  'openstreetmap.org', 'maps.google.com',
];

function parseExtra(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s));
}

export function getEmbedHosts(extraRaw = process.env.EMBED_EXTRA_HOSTS) {
  return [...new Set([...BUILTIN_EMBED_HOSTS, ...parseExtra(extraRaw)])];
}

/** Hostname có thuộc danh sách (khớp chính xác hoặc tên miền con)? */
export function isAllowedEmbedHost(hostname, hosts = getEmbedHosts()) {
  const h = String(hostname || '').toLowerCase();
  return hosts.some((d) => h === d || h.endsWith('.' + d));
}

/** URL nhúng hợp lệ: https + host nằm trong danh sách. */
export function isAllowedEmbedUrl(url, hosts = getEmbedHosts()) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && isAllowedEmbedHost(u.hostname, hosts);
  } catch {
    return false;
  }
}

/** Giá trị cho CSP frame-src: https://host và https://*.host. */
export function frameSrcSources(hosts = getEmbedHosts()) {
  return hosts.flatMap((d) => [`https://${d}`, `https://*.${d}`]);
}
