# Danh sách thay đổi (bản sửa lỗi)

## Lỗi đã sửa
| Lỗi | Nguyên nhân | File |
|---|---|---|
| Ô đăng nhập/đăng ký, toast, popup không chạy | `window.__DIAGRAM__` chỉ gán trong `bootApp()` mà không ai gọi → mọi script trang bị lỗi | `public/js/core.js` |
| Đăng nhập luôn báo sai mật khẩu | `store instanceof MemoryStore` luôn sai (store đã bị bọc) → không lấy được password hash | `authService.js`, `MemoryStore.js`, `storage/index.js` |
| Thao tác lưu/xóa/đăng xuất bị 403 (CSRF) | Server không đưa CSRF token vào trang | `src/server/render.js`, `pageRoutes.js`, `core.js` |
| Popup không đóng được bằng `UI.closeModal(null)` | Hàm không nhận `null` | `core.js` |
| Nút "Đăng ký" ở trang chủ không hiện | `appendChild(a, b)` chỉ nhận 1 tham số | `public/js/home.js` |
| Health check Render lỗi | Route bị gắn thành `/api/v1/health/health` | `healthRoutes.js` |
| Script inline / `style=""` bị CSP chặn | CSP quá chặt, `upgrade-insecure-requests` sai ở dev | `headers.js`, `views/*` |
| Trang 404/403/500 trả HTTP 200 | `render()` không đặt status | `render.js`, `pageRoutes.js` |
| "Đăng xuất tất cả thiết bị" đăng xuất luôn phiên hiện tại | Server xóa mọi session | `authRoutes.js`, `MemoryStore.js`, `settings.js` |
| Tên sơ đồ có `$&` làm hỏng HTML | Dùng `replaceAll` với chuỗi thay thế | `render.js` |
| Body quá lớn: client chỉ thấy "lỗi mạng" | `req.destroy()` trước khi trả 413 | `bodyParser.js` |

## Tính năng mới
- `NODE_ENV=development`: lỗi hiện thành toast `[DEV]`; bấm vào toast mở popup (file:dòng:cột, request, stack trace, nút sao chép).
- Bắt lỗi JavaScript trình duyệt (`error`, `unhandledrejection`, lỗi tải tài nguyên).
- Terminal in stack trace đầy đủ cho lỗi 5xx; production không lộ stack ra client.
- Route thử lỗi (chỉ development): `/api/v1/dev/error`, `/dev/error-page`.
- Toàn bộ thông báo (server, zod, aria-label, placeholder, tiêu đề) là tiếng Việt có dấu.
