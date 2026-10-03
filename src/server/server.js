import { config } from './config.js';
import app from './app.js';
import createLogger from './logger.js';

const log = createLogger('server');

const server = app.listen(config.port, config.host, () => {
  log.info(`Diagram server listening on http://${config.host}:${config.port}`);
  log.info(`env=${config.env} storage=${config.storageProvider}`);
  if (!config.isProduction) {
    log.info(`app url: ${config.appUrl}`);
  }
  if (config.isDevelopment) {
    log.info('NODE_ENV=development: response lỗi có kèm stack trace (chỉ dùng khi phát triển).');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`Cổng ${config.port} đang được dùng bởi tiến trình khác. Đổi PORT hoặc tắt tiến trình đó.`);
  } else {
    log.error('server error:', err.stack || err.message);
  }
  process.exit(1);
});

// Graceful shutdown (Render gửi SIGTERM khi redeploy)
function shutdown(signal) {
  log.info(`${signal} received — shutting down`);
  server.close(() => {
    log.info('server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection:', reason instanceof Error ? (reason.stack || reason.message) : reason);
});
process.on('uncaughtException', (err) => {
  log.error('uncaught exception:', err.stack || err.message);
  process.exit(1);
});

export default server;
