/** Trang thai cau tra loi API thanh cong, format thong nhat toan app. */
export function ok(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, data });
}

/** Ma loi + thong diep Tieng Viet cho nguoi dung. */
export const errorMessages = {
  INVALID_REQUEST: 'Yeu cau khong hop le.',
  VALIDATION_ERROR: 'Du lieu nhap khong hop le.',
  INVALID_JSON: 'Body JSON khong hop le.',
  BODY_TOO_LARGE: 'Yeu cau qua lon.',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type khong ho tro.',
  UNAUTHORIZED: 'Ban can dang nhap de thuc hien hanh dong nay.',
  INVALID_CREDENTIALS: 'Tai khoan hoac mat khau khong dung.',
  FORBIDDEN: 'Ban khong co quyen thuc hien hanh dong nay.',
  NOT_FOUND: 'Khong tim thay tai nguyen.',
  METHOD_NOT_ALLOWED: 'Phuong thuc HTTP khong duoc ho tro cho endpoint nay.',
  CONFLICT: 'Du lieu da ton tai hoac xung dot.',
  RATE_LIMITED: 'Qua nhieu yeu cau. Vui long thu lai sau.',
  CSRF_INVALID: 'CSRF token khong hop le hoac thieu.',
  ACCOUNT_LOCKED: 'Tai khoan da bi khoa.',
  TOO_MANY_ELEMENTS: 'So luong phan tu vuot gioi han cho phep.',
  INTERNAL_ERROR: 'Da xay ra loi he thong. Vui long thu lai.',
};

/**
 * Tra loi loi theo format chuan:
 * { success: false, error: { code, message } }
 * Production khong bao gio tra stack trace.
 */
export function fail(res, code, message, status = 400, extra = undefined) {
  const body = {
    success: false,
    error: { code, message: message ?? errorMessages[code] ?? errorMessages.INTERNAL_ERROR },
  };
  if (extra) body.error.details = extra;
  return res.status(status).json(body);
}
