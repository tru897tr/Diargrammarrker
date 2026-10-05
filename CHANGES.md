# Danh sách thay đổi

## Bản nâng cấp: trình soạn thảo, media, trình chiếu

### Đã làm theo yêu cầu
| Yêu cầu | Cách làm | File chính |
|---|---|---|
| Trang chủ khi đã đăng nhập có giao diện giới thiệu khác | Server chọn view theo phiên: khách → landing, đã đăng nhập → trang làm việc (chào theo giờ, bắt đầu nhanh, sơ đồ gần đây, tính năng mới) | `pageRoutes.js`, `views/home-user.html`, `home-user.js` |
| SVG sai / không chạy / không phù hợp | Viết lại engine: đo chữ thật bằng canvas và ngắt dòng đúng, vùng chữ theo từng hình, 20 hình khối (đường path chuẩn), xoay mọi phần tử, đổi cỡ đúng cả khi đã xoay, màu có độ trong suốt (`fill-opacity`), đổ bóng, hit-test đúng với hình rỗng/xoay | `public/js/editor-canvas.js` |
| Nút hoàn tác / làm lại là mũi tên | Hai nút mũi tên cong ở thanh trên trình soạn thảo (tự tắt khi không còn bước), cùng Ctrl+Z / Ctrl+Shift+Z. Sửa lỗi gốc: lịch sử trước đây lưu trạng thái **sau** thao tác nên hoàn tác không có tác dụng; kéo thanh màu/gõ số được gộp thành một bước | `editor-canvas.js` (`History`), `icons.js`, `editor.js` |
| Làm lại các giao diện xấu / sai | Danh sách sơ đồ thành lưới thẻ có ảnh xem trước, tìm kiếm, sắp xếp, đổi tên/nhân bản/xóa tại chỗ (không tải lại trang); trình soạn thảo mới; font Be Vietnam Pro tự host | `list.js`, `pages.css`, `editor.css`, `public/fonts/` |
| Bảng màu riêng, nhập mã màu đầy đủ | Bảng chọn màu tự viết: vùng chọn đậm/sáng, thanh sắc độ + độ trong suốt, nhập HEX 3/4/6/8 số (có hoặc không có `#`), `rgb()`, `hsl()`, tên màu CSS, ô R G B A / H S L, ống nhỏ giọt, "Không màu", màu đang dùng trong sơ đồ, màu gần đây, bàn phím và đọc màn hình | `public/js/colorpicker.js` |
| Nút Trình chiếu ở trang chia sẻ và trang xem | Toàn màn hình (Fullscreen API, tự chuyển sang chế độ CSS nếu trình duyệt không hỗ trợ), vẫn thu phóng bằng chuột/cảm ứng/phím, kéo di chuyển, bấm vào video/nhúng để tương tác, thanh điều khiển tự ẩn. Có cả ở trình soạn thảo (phím P) | `present.js`, `share-view.js`, `views/share/view.html` |
| Menu kiểu PowerPoint | Ribbon 4 tab: **Trang chủ · Chèn · Sắp xếp · Xem**; Chèn tách riêng *Hình khối* (thư viện nhóm), *Đường & nối*, *Văn bản*, *Phương tiện* | `editor.js` (`TABS`) |
| Chèn ảnh, GIF, video, liên kết nhúng | Xem bên dưới | `media.js`, `schema.js`, `embedHosts.js` |

### Ảnh, GIF, video, nhúng
- **Ảnh/GIF**: tải lên (kéo thả, dán Ctrl+V, hoặc nút Chèn) hoặc dán liên kết. Ảnh tĩnh tự thu nhỏ ≤1920px và nén; **GIF/WebP/APNG động được giữ nguyên** để vẫn chuyển động. Có tỉ lệ khóa, đổi cỡ, xoay.
- **Video**: dán liên kết `.mp4/.webm` (có nút điều khiển, lặp, tắt tiếng, tự phát khi xem) hoặc liên kết YouTube/Vimeo… (tự thành trình phát).
- **Nhúng**: dán nguyên mã `<iframe>` (kể cả đoạn Canva có `padding-top: 58.8%` — tỉ lệ khung được đọc đúng) hoặc chỉ liên kết. Tự nhận diện YouTube (watch, youtu.be, shorts, playlist, mốc thời gian), Vimeo, Canva, Google Slides/Docs/Sheets/Drive/Forms/Maps, Figma, Spotify, SoundCloud, Loom, TikTok, Twitch, Dailymotion, Streamable. Kéo đi bất kỳ đâu, xoay, đổi cỡ tự do; nhấp đúp để bấm vào trình phát, Esc để thoát.
- Video/nhúng là phần tử HTML nằm **dưới** lớp vẽ SVG: bạn có thể vẽ mũi tên, chữ, hình đè lên trình phát; ảnh (SVG) và hình vẽ luôn nằm trên video/nhúng bất kể thứ tự lớp.

### Bảo mật
- Chỉ nhúng được tên miền trong danh sách cho phép (`src/shared/embedHosts.js`, mở rộng bằng `EMBED_EXTRA_HOSTS`); cùng một danh sách dùng cho CSP `frame-src`, kiểm tra dữ liệu khi lưu và kiểm tra ở trình duyệt. Chỉ `https`.
- Iframe nhúng có `sandbox` + `referrerpolicy`; ảnh chỉ nhận `https:` hoặc `data:image/*` (không `javascript:`); video chỉ `https:`.
- Màu được kiểm tra bằng regex (hex/rgb/hsl/tên); mọi chữ người dùng chỉ vào DOM bằng `textContent`.
- Giới hạn: 4M ký tự/ảnh tải lên, 9MB ảnh tải lên/sơ đồ; body riêng cho `/api/v1/diagrams` (mặc định 12MB, `DIAGRAM_BODY_MB`), các endpoint khác giữ 512KB.

### Lỗi sẵn có đã sửa thêm
| Lỗi | Nguyên nhân |
|---|---|
| Hoàn tác không có tác dụng | `History` lưu ảnh chụp **sau** thao tác rồi khôi phục chính nó |
| Nhấp đúp vào hình không mở được ô gõ chữ | Mỗi lần vẽ lại, node SVG bị gỡ rồi gắn lại nên trình duyệt mất chuỗi nhấp đúp. Nay đồng bộ DOM tại chỗ + nhận nhấp đúp bằng con trỏ |
| Chữ nhiều dòng trong hình bị lệch | `dy` được tính cho mọi dòng như dòng đầu |
| Hộp thoại không nhận focus (ô nhập, nút mặc định) | `focus()` gọi khi hộp thoại còn `visibility:hidden` |
| Đường nối bị xóa nếu thả ra khoảng trống | Nay giữ lại đầu tự do; đầu gắn vào hình bám theo khi hình di chuyển |
| Lưu sơ đồ mới xong tải lại cả trang | Nay giữ nguyên phiên làm việc, chỉ đổi URL |
| Bản nháp tự lưu nhưng không bao giờ được khôi phục | Nay hỏi khôi phục khi mở lại |
| Chữ tự do màu tối không đọc được ở giao diện tối | Màu chữ mặc định là `auto`, đổi theo giao diện |

### Kiểm thử
`npm test` — 20 test (danh sách nhúng, schema, xem trước, API lưu/đọc, CSP, trang chủ theo trạng thái đăng nhập). Ngoài ra đã kiểm thử tay bằng Chromium headless: vẽ, nối, xoay, đổi cỡ, bảng màu, GIF, nhúng Canva/YouTube, lưu/tải lại, chia sẻ, trình chiếu.

---

## Bản sửa lỗi trước đó

### Lỗi đã sửa
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
