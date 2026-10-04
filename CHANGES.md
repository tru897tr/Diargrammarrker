# Danh sách thay đổi

## Bản cập nhật: sửa lỗi canvas + định dạng chữ/xoay + sao lưu dữ liệu

### Lỗi đã sửa (trình soạn thảo)
| Lỗi | Nguyên nhân | File |
|---|---|---|
| `NotFoundError: Failed to execute 'insertBefore'` tại `CanvasView.buildGrid` → **không mở được trang `/create`** | `buildGrid()` chạy khi `scene` chưa là con của `<svg>`. Nay dựng DOM đúng thứ tự: `defs` → lưới → `scene` | `public/js/editor-canvas.js` |
| Undo chậm một bước (lần Ctrl+Z đầu không có tác dụng), undo còn kéo viewport về chỗ cũ | History lưu trạng thái *sau* thao tác và không có trạng thái gốc | `editor-canvas.js` |
| Dòng chữ đầu tiên bị đẩy xuống thêm một dòng | `dy` của `tspan` luôn bằng một dòng | `editor-canvas.js` |
| Nhân bản/dán đường thẳng không dịch vị trí | Chỉ cộng vào `x, y`, không cộng vào `points` | `public/js/editor.js` |
| Gõ số trong panel (vd cỡ chữ "24") mất focus sau ký tự đầu; bảng chọn màu đóng ngay | Panel bị dựng lại sau mỗi lần `input` | `editor.js` |
| Kéo bảng chọn màu tạo hàng chục bước undo | Mỗi sự kiện `input` là một snapshot | `editor-canvas.js` (gộp bước) |
| Phím mũi tên không di chuyển được đường thẳng | Chỉ đổi `x, y` | `editor.js` |
| Lưu sơ đồ bị từ chối khi dùng phông/thuộc tính mới | Schema zod chỉ cho `sans/serif/mono` | `src/validation/schema.js` |

### Tính năng mới: định dạng chữ & xoay (giống PowerPoint)
- **Phông chữ**: 16 phông có sẵn trên máy + 29 Google Fonts hỗ trợ tiếng Việt (tải khi dùng, có phông dự phòng khi offline) + nhập tên phông bất kỳ.
- **Cỡ chữ**: ô nhập + danh sách cỡ chuẩn, nút `A−`/`A+` (nhảy theo bậc 8, 9, 10, 11, 12, 14, 16…), `Ctrl+Shift+<` / `>`, `Ctrl+[` / `]` (±1 điểm).
- **Phóng to/thu nhỏ chữ**: kéo góc của khung *Text* để scale chữ theo tỉ lệ; kéo cạnh để đặt bề rộng (tự xuống dòng).
- **Vừa với khung**: Không / *Thu chữ khi tràn* / *Giãn khung theo chữ*.
- **Kiểu chữ**: đậm, nghiêng, gạch chân, gạch ngang (`Ctrl+B/I/U`), màu chữ, căn ngang & dọc, giãn dòng, giãn chữ, IN HOA/thường/Viết Hoa.
- **Xoay khung**: núm tròn phía trên (giữ `Shift` = bước 15°), ô nhập góc, nút ±15° / ±90°; chọn nhiều phần tử → xoay cả nhóm quanh tâm chung. Đổi cỡ khung đã xoay giữ nguyên góc đối diện. Connector bám đúng điểm neo của hình đã xoay.
- **Xoay chữ trong khung** (độc lập với khung): góc bất kỳ hoặc ↺/↻ 90°.
- Vị trí/kích thước X, Y, Rộng, Cao; kiểu nét viền (liền/đứt/chấm); nhấp đúp hoặc `Enter`/`F2` để sửa chữ ngay trên canvas (ô nhập khớp phông, cỡ, màu và góc xoay).
- Các nhóm trong panel thu gọn được. Trang chia sẻ dùng cùng engine nên hiển thị đúng phông/góc xoay; dữ liệu cũ vẫn mở bình thường.

### Tính năng mới: sao lưu & khôi phục (trang Quản lý trang web)
- **Xuất**: tải một tệp JSON gồm tài khoản (kèm mã băm mật khẩu), sơ đồ, liên kết chia sẻ; chọn từng loại; có checksum SHA-256.
- **Nhập**: kiểm tra toàn bộ tệp → hộp xem trước (thêm/cập nhật/bỏ qua bao nhiêu) → xác nhận mới ghi.
  - *Gộp*: không xóa gì; tài khoản trùng email được gộp (sơ đồ chuyển về tài khoản đó); trùng tên đăng nhập tự đổi tên; tài khoản đang đăng nhập không bao giờ bị ghi đè.
  - *Thay thế*: thay các mục được chọn; chặn nếu kết quả không còn admin nào hoạt động; cảnh báo nếu bạn sẽ bị đăng xuất.
- Phiên đăng nhập không được sao lưu. Chỉ admin dùng được (backend kiểm tra), giới hạn tốc độ, giới hạn kích thước tệp nhập (mặc định 30 MB, đổi bằng `IMPORT_MAX_MB`) và chỉ được đọc *sau khi* xác thực admin.
- CSP: cho phép đúng `fonts.googleapis.com` (CSS) và `fonts.gstatic.com` (tệp phông), không mở script/kết nối ngoài.

### Chạy test
```bash
npm install
npm test            # gồm tests/backup.test.js (13 ca)
```

---

## Bản sửa lỗi trước đó

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
