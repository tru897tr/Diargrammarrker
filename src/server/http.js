/** Trả lời API thành công, format thống nhất toàn app. */
export function ok(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, data });
}

/** Mã lỗi + thông điệp tiếng Việt cho người dùng. */
export const errorMessages = {
  INVALID_REQUEST: 'Yêu cầu không hợp lệ.',
  VALIDATION_ERROR: 'Dữ liệu nhập không hợp lệ.',
  INVALID_JSON: 'Body JSON không hợp lệ.',
  BODY_TOO_LARGE: 'Yêu cầu quá lớn.',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type không được hỗ trợ.',
  UNAUTHORIZED: 'Bạn cần đăng nhập để thực hiện hành động này.',
  INVALID_CREDENTIALS: 'Tài khoản hoặc mật khẩu không đúng.',
  FORBIDDEN: 'Bạn không có quyền thực hiện hành động này.',
  NOT_FOUND: 'Không tìm thấy tài nguyên.',
  METHOD_NOT_ALLOWED: 'Phương thức HTTP không được hỗ trợ cho endpoint này.',
  CONFLICT: 'Dữ liệu đã tồn tại hoặc xung đột.',
  RATE_LIMITED: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
  CSRF_INVALID: 'CSRF token không hợp lệ hoặc thiếu.',
  ACCOUNT_LOCKED: 'Tài khoản đã bị khóa.',
  TOO_MANY_ELEMENTS: 'Số lượng phần tử vượt giới hạn cho phép.',
  INTERNAL_ERROR: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.',
};

/**
 * Trả lỗi theo format chuẩn:
 * { success: false, error: { code, message, details? } }
 * Lỗi "đã xử lý" (validation, 401, 403...) không bao giờ kèm stack trace.
 * Stack trace chỉ được gắn bởi errorHandler (src/middleware/errors.js)
 * khi chạy NODE_ENV=development.
 */
export function fail(res, code, message, status = 400, extra = undefined) {
  const body = {
    success: false,
    error: { code, message: message ?? errorMessages[code] ?? errorMessages.INTERNAL_ERROR },
  };
  if (extra) body.error.details = extra;
  return res.status(status).json(body);
}
