import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import createLogger from './logger.js';
import { requestContext } from '../middleware/requestContext.js';
import { attachSession } from '../middleware/auth.js';
import { jsonBodyParser } from '../middleware/bodyParser.js';
import { csrfProtection } from '../security/csrf.js';
import { securityHeaders } from '../security/headers.js';
import { apiLimiter } from '../security/rateLimit.js';
import { errorHandler, apiNotFound } from '../middleware/errors.js';
import pageRoutes from '../routes/pageRoutes.js';
import healthRoutes from '../routes/healthRoutes.js';
import authRoutes from '../routes/authRoutes.js';
import diagramRoutes from '../routes/diagramRoutes.js';
import shareRoutes from '../routes/shareRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';
import { devApiRouter, devPageRouter } from '../routes/devRoutes.js';

const log = createLogger('app');
const app = express();

// Trust proxy Render (de req.ip + req.secure dung sau load balancer)
app.set('trust proxy', 1);
app.disable('x-powered-by');

// 1) Security headers (CSP, HSTS, frame...) + request id + logging
app.use(await securityHeaders());
app.use(requestContext);

// 2) Static assets truoc body parsing (GET only, khong ton RAM parse)
app.use(express.static(path.join(config.rootDir, 'public'), { maxAge: config.isProduction ? '1h' : 0, index: false }));

// 3) Cookies
app.use(cookieParser());

// 4) JSON body parser co hardening (size limit, content-type check)
app.use(jsonBodyParser);

// 5) Session + CSRF (double-submit + HMAC, timing-safe)
app.use(attachSession);
app.use(csrfProtection);

// 6) API v1
app.use('/api/v1', apiLimiter());
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/diagrams', diagramRoutes);
app.use('/api/v1/share', shareRoutes);
app.use('/api/v1/admin', adminRoutes);

// Route thử lỗi — CHỈ khi NODE_ENV=development (production không có)
if (config.isDevelopment) {
  app.use('/api/v1/dev', devApiRouter);
  app.use('/dev', devPageRouter);
  log.info('development mode: lỗi sẽ hiện dưới dạng toast + popup chi tiết (thử: /api/v1/dev/error)');
}

// /api/* không khớp route nào → 404 JSON (không rơi xuống trang HTML)
app.use('/api', apiNotFound);

// 7) Pages (SSR views: home, login, register, editor, share, errors)
app.use('/', pageRoutes);

// 404 + global error handler (cuoi pipeline)
app.use(errorHandler);

export default app;
