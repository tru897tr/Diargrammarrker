import { Router } from 'express';

/**
 * Route CHỈ dành cho môi trường development — dùng để thử thanh toast lỗi + popup chi tiết.
 * Được mount trong app.js khi config.isDevelopment === true; production không có các route này.
 *
 *   GET /api/v1/dev/error   → ném lỗi 500 (client hiện toast, bấm vào để xem stack)
 *   GET /dev/error-page     → lỗi khi tải trang (trang 500 + toast ở development)
 */
export const devApiRouter = Router();

devApiRouter.get('/error', () => {
  throw new Error('Lỗi thử nghiệm từ /api/v1/dev/error (chỉ có ở development).');
});

devApiRouter.get('/async-error', async () => {
  await Promise.resolve();
  const obj = null;
  // Cố ý gây TypeError để xem stack trace thật
  return obj.khongTonTai.x;
});

export const devPageRouter = Router();

devPageRouter.get('/error-page', () => {
  throw new Error('Lỗi thử nghiệm khi render trang (chỉ có ở development).');
});
