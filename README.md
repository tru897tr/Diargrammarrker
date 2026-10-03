# Diagram

Web app tạo sơ đồ trực tuyến với canvas vô hạn (Node.js + Express 5).

## Chạy trên máy

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm run dev            # http://localhost:3000
```

Tài khoản **đầu tiên** đăng ký sẽ tự động là admin. Dữ liệu lưu trong RAM (`STORAGE_PROVIDER=memory`),
mất khi khởi động lại server.

## Chế độ development (hiện lỗi chi tiết)

Khi `NODE_ENV=development` (mặc định nếu không đặt biến này):

- Lỗi server (HTTP 5xx), lỗi mạng và lỗi JavaScript trên trình duyệt hiện thành **toast màu đỏ** `[DEV] ...`.
- **Bấm vào toast** để mở popup chi tiết: loại lỗi, **file:dòng:cột**, request, stack trace và nút "Sao chép chi tiết".
- Terminal của server in đầy đủ stack trace cho mọi lỗi 5xx.
- Thử nhanh: mở `/api/v1/dev/error` hoặc `/dev/error-page` (hai route này chỉ tồn tại ở development).

Khi `NODE_ENV=production` (Render): người dùng chỉ thấy thông báo chung, **không** có stack trace; chi tiết lỗi
chỉ nằm trong log của server.
