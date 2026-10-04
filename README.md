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

## Định dạng chữ & xoay trong trình soạn thảo
Chọn một phần tử rồi dùng panel bên phải. Phím tắt: `Ctrl+B/I/U` (đậm/nghiêng/gạch chân), `Ctrl+Shift+<` / `>` (giảm/tăng cỡ chữ theo bậc), `Ctrl+[` / `]` (±1 điểm), `Enter`/`F2` hoặc nhấp đúp (sửa chữ). Kéo núm tròn phía trên phần tử để xoay (giữ `Shift` để xoay theo bước 15°).
Google Fonts được tải khi bạn chọn phông đó (cần Internet); không có mạng thì chữ hiển thị bằng phông dự phòng.

## Sao lưu & khôi phục (dành cho admin)
Vào **Quản lý trang web → Sao lưu & khôi phục dữ liệu**. Vì `STORAGE_PROVIDER=memory` mất dữ liệu khi server khởi động lại, hãy xuất tệp sao lưu định kỳ.
Khôi phục sau khi server khởi động lại: đăng ký tài khoản admin (người đầu tiên là admin) → vào trang quản lý → chọn tệp → chế độ **Gộp**. Nếu dùng cùng email với admin cũ, mọi sơ đồ cũ sẽ được chuyển về tài khoản mới và các tài khoản còn lại đăng nhập lại bằng mật khẩu cũ.
Tệp sao lưu chứa mã băm mật khẩu và token chia sẻ — cần bảo quản cẩn thận.
