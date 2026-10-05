import { config } from '../server/config.js';
import { getEmbedHosts, frameSrcSources } from '../shared/embedHosts.js';

/**
 * Helmet config + CSP chặt cho app same-origin.
 * - default-src 'self': mọi script/style/font/img đều phải cùng origin.
 * - KHÔNG có script CDN — assets build local trong public/.
 * - Không cho phép <script> inline (các view dùng file /js/*.js).
 * - style-src-attr 'unsafe-inline': cho phép thuộc tính style="..." trong HTML
 *   (các view dùng style="..." cho layout). Thẻ <style> và script inline vẫn bị chặn.
 * - img-src / media-src cho phép https: (ảnh, GIF, video chèn bằng liên kết) và data:/blob: (ảnh tải lên).
 * - frame-src chỉ cho các tên miền trong src/shared/embedHosts.js (YouTube, Canva, ...).
 * - connect-src 'self' chỉ cho fetch API cùng origin.
 * - frame-ancestors 'none' chống clickjacking.
 */

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  styleSrcAttr: ["'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
  frameSrc: ["'self'", ...frameSrcSources(getEmbedHosts())],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};
// Chỉ thêm directive này ở production (dev chạy http://localhost nên không được nâng cấp lên https).
if (config.isProduction) cspDirectives.upgradeInsecureRequests = [];

/** Helmet instance tạo 1 lần (tránh trùng lặp header giữa các request). */
let helmetMiddleware = null;

export function securityHeaders() {
  return async (req, res, next) => {
    try {
      if (!helmetMiddleware) {
        const helmet = (await import('helmet')).default;
        helmetMiddleware = helmet({
          contentSecurityPolicy: { useDefaults: false, directives: cspDirectives },
          xContentTypeOptions: true,
          referrerPolicy: { policy: 'no-referrer' },
          frameguard: { action: 'deny' },
          hsts: config.isProduction
            ? { maxAge: 31536000, includeSubDomains: true }
            : false,
          crossOriginEmbedderPolicy: false,
          crossOriginResourcePolicy: { policy: 'same-origin' },
          originAgentCluster: true,
        });
      }
      helmetMiddleware(req, res, (err) => {
        if (err) return next(err);
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), fullscreen=*');
        next();
      });
    } catch (err) {
      next(err);
    }
  };
}

export default securityHeaders;
