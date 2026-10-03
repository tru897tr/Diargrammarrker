import { config } from '../server/config.js';

/**
 * Helmet config + CSP that nhat cho app same-origin.
 * - default-src 'self': moi script/style/font/img deu phai cung origin.
 * - KHONG co script CDN — assets build local trong public/.
 * - connect-src 'self' chi cho fetch API cung origin.
 * - frame-ancestors 'none' chong clickjacking.
 */

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  upgradeInsecureRequests: config.isProduction ? [] : null,
};

/** Helmet instance tao 1 lan (tranh trung lap header giua cac request). */
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
      helmetMiddleware(req, res, () => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        next();
      });
    } catch (err) {
      next(err);
    }
  };
}

export default securityHeaders;
