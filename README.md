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

## Trình soạn thảo
- Ribbon 4 tab giống PowerPoint: **Trang chủ · Chèn · Sắp xếp · Xem**. Hoàn tác/làm lại là hai mũi tên ở thanh trên.
- Chèn: 20 hình khối, đường/mũi tên/đường nối (thẳng, gấp khúc, cong, tự bám vào hình), văn bản, ghi chú, khung, **ảnh/GIF, video, nhúng** (YouTube, Canva, Vimeo, Google Slides, Figma, Spotify...).
- Dán thẳng liên kết YouTube/Canva hoặc mã `<iframe>` bằng Ctrl+V; kéo thả ảnh vào khung vẽ.
- Trình chiếu toàn màn hình: nút **Trình chiếu** (hoặc phím `P`) ở trình soạn thảo và trang chia sẻ.
- Phím tắt: bấm `?` trong trình soạn thảo.

## Biến môi trường thêm
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `EMBED_EXTRA_HOSTS` | (trống) | Thêm tên miền được phép nhúng, cách nhau dấu phẩy |
| `DIAGRAM_BODY_MB` | `12` | Dung lượng tối đa một lần lưu sơ đồ (1–32MB) |

> Lưu ý Render gói miễn phí: dữ liệu nằm trong RAM (`MemoryStore`). Ảnh **tải lên** được nhúng vào sơ đồ nên tốn RAM; ưu tiên dán **liên kết ảnh** cho ảnh nặng.

## Kiểm thử
```bash
npm test
```
