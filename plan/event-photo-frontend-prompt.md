# Prompt giao AI thực hiện frontend gallery và tìm ảnh VNUTour

Copy nội dung từ mục “Nhiệm vụ” trở xuống cho AI frontend. Hợp đồng API dưới đây là mục tiêu implementation của backend đang được thực hiện song song, không phải API đã deploy. Nếu cần thay đổi contract, ghi lại đề xuất và báo người phụ trách backend trước khi sửa frontend theo contract khác.

Cập nhật backend: đã triển khai local, chưa deploy. Album có thêm `counts.indexing_failed`; ảnh admin có `indexing_error: string | null`. Ảnh `ready` có lỗi indexing vẫn xem được nhưng chưa tìm được bằng khuôn mặt; hiển thị lỗi AI riêng, cho phép retry qua endpoint retry hiện có. `no_faces` chỉ đếm ảnh AI đã xử lý thành công và không phát hiện mặt. Không cộng các bộ đếm con với `ready` để suy ra tổng.

## Nhiệm vụ

Cập nhật quyền truy cập: `/photos` yêu cầu đăng nhập; cả 4 endpoint xem/tìm (`/photo-albums`, `/photo-albums/<id>/photos`, `/photo-search`, `/photo-search/<token>`) phải gửi token theo `apiRequest` mặc định. Chỉ thành viên đội được duyệt, admin/master_admin và coop (`collab`) được backend cho phép. Nhận `403 team_not_approved` thì ẩn dữ liệu/form tìm kiếm và hiển thị thông báo. Admin endpoints giữ nguyên quyền admin. Các mô tả “công khai” bên dưới chỉ nói album đã xuất bản, không có nghĩa khách chưa đăng nhập được gọi API.

Bạn làm phần frontend của tính năng album ảnh sự kiện và tìm ảnh theo khuôn mặt trong repository VNUTour tại `D:\code\vnutour`.

Chỉ sửa frontend và test/docs frontend liên quan. Một AI khác đang làm Django API, service AI và Kubernetes. Không sửa backend, migrations, dependencies Python, manifests k8s hoặc file `plan/event-photo-search-plan.md`. Không hoàn nguyên thay đổi đang có của người khác. Đọc AGENTS.md nếu có và kiểm tra git status trước khi làm.

Đọc `plan/event-photo-search-plan.md` để hiểu nghiệp vụ, nhưng dùng hợp đồng API trong prompt này khi kết nối frontend. Kế hoạch có các ý tưởng mở rộng; chỉ làm MVP dưới đây.

## Bối cảnh và stack

- React 19 + Vite + Tailwind, JavaScript/JSX, routing hiện có ở `frontend/src/App.jsx` và `frontend/src/router.js`.
- HTTP dùng `apiRequest` trong `frontend/src/api.js`; helper hỗ trợ JSON, FormData, AbortSignal và auth token. Không đặt Content-Type bằng tay khi gửi FormData.
- Admin shell ở `frontend/src/AdminDashboard.jsx`; thêm mục “Ảnh sự kiện” cạnh Bảng tin/Khung ảnh. Có thể tham khảo `FeedAdminPanel.jsx` và `FeedImageCarousel.jsx`.
- Gallery công khai tại `/photos`; trang admin tại `/admin/photos`. Theo routing hiện có, không thêm router framework.
- Giữ ngôn ngữ tiếng Việt và hệ thiết kế hiện có: font-display/font-sans/font-mono, màu ink/paper/stone/trail và các thành phần UI sẵn có. Ảnh là nội dung chính; không dùng ảnh stock, số liệu giả hoặc hiệu ứng trang trí không cần thiết.
- Không thêm thư viện nếu chức năng có thể làm tốt bằng dependencies hiện có.

## Luồng sản phẩm

BTC upload ảnh gốc lên Google Drive → dán link thư mục vào VNUTour → hệ thống tải và xử lý nền → preview/thumbnail lưu R2, vector lưu database, link Google Drive giữ để chia sẻ/tải ảnh gốc.

Người dùng xem album công khai → gửi một ảnh chân dung → nhận các ảnh có khuôn mặt tương ứng → mở preview hoặc mở/tải ảnh gốc trên Drive. Ảnh tham chiếu chỉ dùng cho lượt tìm, không được đưa vào album.

Không upload ảnh gốc qua frontend VNUTour. Không gọi Google Drive, R2 hoặc service AI trực tiếp bằng credentials; frontend chỉ gọi Django và hiển thị URL ảnh/link mà Django trả về. R2 preview có thể là URL ký sẵn có hạn; không cache URL trong localStorage.

## Phạm vi giao diện

### Gallery công khai `/photos`

- Danh sách album đã xuất bản; chọn album qua query `?album=<id>` để reload/share giữ lựa chọn.
- Lưới thumbnail responsive, lazy loading, nút tải thêm theo cursor. Chỉ tải preview lớn khi mở xem chi tiết.
- Xem ảnh lớn: đóng bằng Escape, focus được trả về nút mở, alt có tên file, điều hướng ảnh nếu phù hợp. Không cần thư viện lightbox mới.
- Mỗi ảnh có “Sao chép link Drive” và “Mở ảnh gốc trên Drive”. Chỉ hiện nút “Tải ảnh gốc” nếu `download_url` có giá trị. Link ngoài dùng rel="noopener noreferrer" khi target="_blank".
- Bản sao link dùng `share_url`; nếu clipboard thất bại phải có thông báo/cách copy thủ công. Không mặc định tải gốc trực tiếp luôn thành công: Drive có thể mở trang xem/xác nhận.
- Khối “Tìm ảnh của bạn”: chọn một ảnh JPEG/PNG/WebP, preview local và thay/xóa ảnh, nhãn tối đa 10 MB; mặc định tìm trong album đang mở.
- Gửi ảnh bằng FormData khi bấm Tìm; khóa gửi lặp trong khi request đang chạy. Không phân tích khuôn mặt trong browser.
- Kết quả tìm hiển thị cùng lưới ảnh, số kết quả, nút quay về album. Không hiển thị điểm tương đồng như phần trăm xác suất danh tính.
- Nếu kết quả bị cắt ở giới hạn server thì thông báo và gợi ý thu hẹp album. Phân trang search qua token, không gửi lại ảnh mỗi trang.
- Khi đổi album/lượt tìm, bỏ kết quả cũ và hủy request cũ bằng AbortController; không để response cũ ghi đè màn hình mới.
- Hiển thị số ảnh đã xử lý AI/tổng ảnh hợp lệ; không diễn giải album còn đang xử lý thành “không có ảnh của bạn”.

### Quản trị `/admin/photos`

- Thêm tab vào AdminDashboard theo convention hiện có, admin và master_admin đều dùng được.
- Danh sách album; tạo với tên, mô tả và link thư mục Drive. Server tạo album nháp và lên lịch import.
- Form sửa tên/mô tả; đổi trạng thái draft/published/hidden. Hiển thị link gallery của album đã xuất bản.
- Nút “Đồng bộ lại” (giữ nguyên folder đã gắn) và “Thử lại ảnh lỗi”. Không yêu cầu dán từng link ảnh.
- Hiển thị trạng thái quét thư mục và bộ đếm ảnh: tổng, chờ/đang xử lý, sẵn sàng, đã index, không có mặt, lỗi, gỡ khỏi gallery.
- Poll khoảng 5 giây khi có import/ảnh đang xử lý, dừng khi tab ẩn hoặc component unmount; làm mới khi quay lại. Không chạy nhiều polling loop chồng nhau.
- Danh sách ảnh lỗi có tên file, mã lỗi được dịch và nút thử lại; hỗ trợ gỡ ảnh khỏi gallery bằng xác nhận ngắn. Nêu rõ thao tác gỡ không xóa ảnh gốc trên Drive.
- Không tự publish album sau import; để BTC chọn xuất bản.

## Hợp đồng API (path tương đối với API_BASE_URL)

### Các kiểu dữ liệu

```js
Album = {
  id: number,
  title: string,
  description: string,
  status: 'draft' | 'published' | 'hidden',
  counts: { total: number, pending: number, processing: number, ready: number,
            indexed: number, no_faces: number, failed: number, removed: number },
  // Chỉ response quản trị có các trường dưới:
  drive_folder_url?: string,
  import_status?: 'idle' | 'queued' | 'scanning' | 'complete' | 'failed',
  import_error?: string,
}
Photo = {
  id: number, album_id: number, filename: string,
  width: number, height: number,
  thumbnail_url: string | null, preview_url: string | null,
  share_url: string | null, download_url: string | null,
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'removed',
  face_count: number, error?: string,
}
```

Các bộ đếm có thể chồng nhau: `indexed` và `no_faces` là hai phần trong `ready`; không cộng tất cả counts thành tổng.

### Công khai, gọi apiRequest với auth:false

- `GET /photo-albums?cursor=<id>&limit=24` → `{ albums: Album[], next_cursor: number|null }`.
- `GET /photo-albums/<id>/photos?cursor=<id>&limit=48` → `{ album: Album, photos: Photo[], next_cursor: number|null }`.
- `POST /photo-search`: multipart `image`, `album_id` tùy chọn → `{ token: string, photos: Photo[], total: number, next_cursor: number|null, truncated: boolean }`.
- `GET /photo-search/<token>?cursor=<offset>&limit=48` → cùng dạng response search. Token sống 10 phút; 410 `search_expired` thì mời tìm lại.

### Quản trị, gọi apiRequest với auth mặc định

- `GET /admin/photo-albums?cursor=<id>&limit=24` → `{ albums: Album[], next_cursor: number|null }`.
- `POST /admin/photo-albums`, JSON `{title, description, drive_folder_url}` → HTTP 201 `{ album: Album }`.
- `PATCH /admin/photo-albums/<id>`, JSON một/vài trường `{title, description, status}` → `{ album: Album }`. Không đổi folder của album đã tạo trong MVP.
- `POST /admin/photo-albums/<id>/import-drive`, JSON `{}` → HTTP 202 `{ album: Album }`; endpoint idempotent khi đã queued/scanning.
- `GET /admin/photo-albums/<id>/photos?cursor=<id>&limit=48` → `{ album: Album, photos: Photo[], next_cursor: number|null }`. Dùng album counts trong response để cập nhật tiến độ, không cần endpoint processing riêng.
- `POST /admin/photo-albums/<id>/retry`, JSON `{}` → HTTP 202 `{ queued: number }`.
- `POST /admin/photos/<id>/retry`, JSON `{}` → HTTP 202 `{ queued: number }`.
- `DELETE /admin/photos/<id>` → `{ removed: true }`. Đây là gỡ khỏi gallery; vẫn giữ tombstone để sync không thêm lại.

### Lỗi

Response lỗi `{error: string}`; xử lý ít nhất:

- `invalid_drive_folder`: link thư mục không hợp lệ.
- `drive_not_configured`, `drive_permission_denied`: chưa cấu hình hoặc chưa cấp quyền Drive.
- `drive_unavailable`, `storage_unavailable`, `search_unavailable`: dịch vụ tạm không sẵn sàng.
- `invalid_image`, `reference_too_large`, `too_many_pixels`: ảnh không hợp lệ/quá lớn.
- `no_face`, `multiple_faces`: cần ảnh một người rõ mặt.
- `rate_limited`, `too_many_attempts`: nhiều yêu cầu, thử lại sau.
- `search_expired`: kết quả đã hết hạn, tìm lại.
- `not_found`: album/ảnh đã bị gỡ hoặc không công khai.
- `gallery_disabled` hoặc HTTP 404 khi tính năng chưa bật: hiển thị chưa khả dụng, không crash.
- `missing_token`, `invalid_token`, `forbidden`: theo cách xử lý auth hiện có.

Không đưa lỗi kỹ thuật/raw exception thành nội dung chính với người dùng. Giữ console không log ảnh tham chiếu hoặc token tìm kiếm. Revoke object URL khi thay ảnh/unmount, không lưu ảnh vào localStorage.

## Chất lượng và kiểm thử

- Các trạng thái loading/empty/error/success rõ ràng, keyboard sử dụng được, label cho input, aria-live cho thông báo tìm kiếm/clipboard và layout mobile không tràn ngang.
- Mock API chỉ dùng test hoặc local fixture; không âm thầm fallback dữ liệu giả khi production API lỗi.
- Test có ý nghĩa cho: request FormData, đổi album khi request còn chạy, phân trang không trùng, polling cleanup, search hết hạn, nút download khi không có URL, lỗi clipboard và phân quyền entry admin.
- Chạy `npm run lint` và `npm run build` trong frontend; phân biệt lỗi sẵn có của phần người khác đang sửa với lỗi mình tạo ra.
- Nếu có browser test, kiểm tra 375px và desktop, luồng tạo album → tiến độ → gallery → tìm ảnh bằng mock API. Không cần credentials Drive thật để hoàn thành frontend.
- Không deploy, không commit/push tự động. Cuối cùng báo các file đã sửa, kiểm thử đã chạy và phần còn phụ thuộc backend. Khi API backend khác contract này, chỉ rõ endpoint/field chênh lệch.
