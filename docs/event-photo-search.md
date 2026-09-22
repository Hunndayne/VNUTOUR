# Event photo backend — triển khai và vận hành

## Thành phần đã có

- Django app `photo_gallery`: album, ảnh, vector 128 chiều, lease xử lý và kết quả tìm kiếm có hạn 10 phút. Toàn bộ bảng của app nằm trong **database riêng** `photos` (PostgreSQL + pgvector, StatefulSet `photos-db`), định tuyến bằng `photo_gallery/routers.py`. Database sự kiện không có bảng nào của gallery và không cần pgvector.
- Worker đọc Google Drive readonly, tải từng ảnh vào file tạm, tạo WebP 400/2048 px lên **bucket R2 hiện có**, dưới prefix `event-photos/<album>/<photo>/<lease>/`, lưu link xem/tải Drive.
- YuNet + SFace FP32 qua OpenCV CPU. Model được kiểm tra SHA256 lúc build và lúc khởi tạo. Không cần GPU hay vector database chuyên biệt: pgvector trong `photos-db`, truy vấn cosine chính xác và gộp kết quả theo ảnh.
- API AI nội bộ chỉ có health và `/v1/embed`, dùng shared token. API public/admin nằm trên backend hiện có. Worker dùng chung database; hàng đợi bền vững chính là trạng thái/lease trong DB, không cần Redis hay dispatcher riêng.
- Gallery đã xử lý vẫn xem được khi tắt search. Nếu inference lỗi, ảnh vẫn có preview: `status=ready`, `indexing_error` trên API admin và `counts.indexing_failed` trên album. Đây không phải trạng thái “không có mặt”. Retry ảnh/album cũng chọn các ảnh lỗi indexing.
- API frontend: xem [hợp đồng và prompt frontend](../plan/event-photo-frontend-prompt.md). Frontend được thực hiện riêng.
- **Quyền truy cập:** gallery, danh sách ảnh, tìm kiếm và các trang kết quả yêu cầu đăng nhập. Thành viên đội đang `approved`, `admin`/`master_admin` và coop (`collab`) được xem/tìm album đã xuất bản. Tài khoản chưa có đội, đội nháp/chờ duyệt/bị từ chối không được truy cập. Quyền import/sửa/gỡ/retry vẫn chỉ dành cho admin. Server kiểm tra quyền mỗi request, kể cả token tìm kiếm đã được tạo trước khi thu hồi duyệt; response API không được cache dùng chung. Các link ảnh R2/Drive vẫn theo quyền public của nơi lưu trữ.

## Trước khi bật

1. Không đụng gì tới database sự kiện: gallery chạy trên `photos-db` (image upstream `pgvector/pgvector:0.8.0-pg16`) với PVC riêng. Worker tự chạy `migrate photo_gallery --database photos` lúc khởi động và tự tạo extension `vector` trong database đó. Prod không phải đổi image Patroni/Spilo.
2. Tạo Google Cloud service account và bật Drive API. Lưu JSON key ngoài repository, chia sẻ thư mục ảnh cho email service account với quyền đọc. Worker chỉ đọc ảnh JPEG/PNG/WebP ngay trong thư mục được chọn; chưa đệ quy thư mục con, shortcut hay HEIC/RAW.
3. Quyền đọc của service account không cấp quyền tải cho khách. BTC cấu hình quyền chia sẻ Drive theo nhu cầu và kiểm tra link gốc bằng trình duyệt chưa đăng nhập. Backend không tự đổi quyền Drive. Có ảnh tham chiếu không chứng minh người gửi sở hữu khuôn mặt trong ảnh đó.
4. Dùng chung `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL` của ứng dụng. Để `PHOTO_R2_BUCKET` trống để tự dùng bucket hiện có; không cần tạo bucket hoặc credentials riêng. Worker chỉ ghi preview/thumbnail dưới prefix `event-photos/` và cleanup theo object đã ghi nhận trong DB gallery, không quét/xóa toàn bucket. Nếu đã dùng bucket ảnh riêng, giữ override cũ để các key đã lưu vẫn trỏ đúng nơi.

## Build

Từ root repository:

```sh
docker build -f backend/Dockerfile.photo-ai -t ghcr.io/hunndayne/vnutour-photo-ai:<tag> backend
docker push ghcr.io/hunndayne/vnutour-photo-ai:<tag>
```

Build và phát hành backend image chứa app mới + `pgvector==0.4.2` theo pipeline hiện có. Photo AI image dùng Python 3.11, OpenCV 4.10.0.84 và NumPy 1.26.4; build tải khoảng 39 MB model, fail nếu checksum sai. Không tải model khi pod bắt đầu chạy. Giấy phép upstream được đóng gói ở `/models`.

## Bật component trong Kubernetes

Component `k8s/kustomize/components/photo-ai` là opt-in; chưa được thêm vào overlay đang chạy.

1. Tạo Secret `photo-ai-secret` trong namespace đích, với `PHOTO_AI_TOKEN` ngẫu nhiên, `PHOTO_DB_PASSWORD` (mật khẩu `photos-db`, đặt trước khi PVC được tạo lần đầu) và `credentials.json` là key Drive. File mẫu trong component không được Kustomize apply.
2. Thêm `../../components/photo-ai` vào `components` của overlay chủ động xử lý ảnh. Chưa bật worker ở site standby; cơ chế site-activator hiện tại chưa quản lý workload ảnh.
3. Trong overlay, đặt tag bất biến cho `ghcr.io/hunndayne/vnutour-photo-ai` và cập nhật backend image cùng bản code. Giữ `PHOTO_R2_BUCKET: ""` trong ConfigMap `photo-ai-config` để backend và worker cùng dùng `R2_BUCKET` hiện có.
4. Render bằng `kubectl kustomize k8s/kustomize/overlays/<environment>` và kiểm tra các giá trị trước khi sync. Component truyền bucket, token và mật khẩu `photos-db` cho backend; API AI chỉ nhận token (không có credential DB hay R2), worker mount key Drive và nhận mật khẩu DB.
5. Chỉ bật `PHOTO_GALLERY_ENABLED=1` khi image backend đang chạy ĐÃ có router (`photo_gallery/routers.py`). Trên staging (22/09/2026) component được bật trong cùng lần sync mà backend vẫn là image cũ, nên PreSync job của bản cũ tạo bảng gallery ngay trong database sự kiện; phải drop 5 bảng, xóa dòng `django_migrations` và `DROP EXTENSION vector` để dọn. Môi trường mới: deploy image có router trước, lần sync sau mới thêm component.
6. Migration của gallery KHÔNG chạy trong PreSync job: worker chạy `migrate photo_gallery --database photos` lúc khởi động, nên database sự kiện và hook PreSync giữ nguyên như trước. Worker sẽ restart cho tới khi `photos-db` sẵn sàng.
6. Sau rollout, kiểm tra API readiness, trạng thái worker và tạo một album nhỏ bằng API admin. Publish album sau khi kiểm tra preview và link Drive.
7. Đánh giá tập ảnh tham chiếu thật; patch `backend-config` với `PHOTO_SEARCH_ENABLED=1` và ngưỡng đã hiệu chỉnh trong `PHOTO_SEARCH_THRESHOLD`, rồi restart backend để nhận env mới. Mặc định search tắt và ngưỡng `0.50` chỉ là giá trị khởi đầu.

`photos-db` và API AI dùng ClusterIP nội bộ, không có Ingress. `photos-db` ghim vào node có nhãn `vnutour/storage=true` vì dùng local-path.

API AI dùng ClusterIP, không có Ingress. API/worker chạy user 10001, root filesystem readonly, file tạm nằm trên emptyDir disk giới hạn 1 GiB mỗi pod. API limit 2 CPU/1.5 GiB, worker limit 3 CPU/2 GiB; một replica mỗi loại, hai thread OpenCV. Đây là cấu hình khởi đầu cần đo trên node Proxmox, chưa bao gồm RAM backend/DB và workload khác.

Worker không dùng probe giả chỉ kiểm tra import thư viện. Tiến trình chết sẽ được Deployment restart; SIGTERM dừng có phối hợp, lease hết hạn sau 10 phút cho phép nhận lại job nếu pod bị kill. API có startup/readiness/liveness HTTP probes. Cần theo dõi queue không tiến triển, ảnh lỗi và việc pod restart trong hệ thống monitoring hiện có; chưa bổ sung bộ metrics/alerts chuyên biệt.

## Lên staging (vnutour.hunn.io.vn)

Bật gallery **không** đổi database sự kiện. Overlay staging thêm component `photo-ai` (API, worker, `photos-db`), hạ tài nguyên cho node nhỏ và bật `PHOTO_SEARCH_ENABLED=1`.

Thứ tự:

1. Tạo `photo-ai-secret` trong namespace đích với `PHOTO_AI_TOKEN`, `PHOTO_DB_PASSWORD` (mật khẩu của `photos-db`) và `credentials.json` (key Drive). Thiếu secret thì backend vẫn chạy (hai key đầu là optional, search trả lỗi tạm thời), nhưng `photos-db`, `photo-ai` và worker không khởi động.
2. Push nhánh môi trường. CI build image `photo-ai` và bump tag trong overlay. ArgoCD tạo `photos-db`; worker chờ DB lên rồi migrate database `photos`.
3. Migration job PreSync vẫn chỉ chạy cho database sự kiện; nó không tạo bảng gallery nhờ router.
4. Kiểm tra: `kubectl -n <ns> get pods` (photos-db, photo-ai, photo-ai-worker Ready), `psql` vào `photos-db` thấy extension `vector` và các bảng `photo_gallery_*`, còn DB sự kiện thì không có bảng nào như vậy. Tạo album nhỏ ở `/admin/photos`, chờ worker xử lý, publish, rồi thử `/photos`.

Rollback: revert commit overlay. Dữ liệu gallery nằm trong `photos-db`, tách hẳn khỏi database sự kiện; xóa PVC `photos-db-data` là xóa sạch, và import lại từ Drive dựng lại được toàn bộ.

## Vận hành

- **Import/sync:** `POST /api/admin/photo-albums/<id>/import-drive {}`. Có checkpoint theo trang; bấm lại khi đang quét không khởi tạo scan trùng. Metadata/links được cập nhật khi sync; ảnh không đổi revision không xử lý lại. Model version đổi sẽ reindex ảnh khi sync.
- **Ảnh mất/đổi nguồn:** chỉ đánh dấu nguồn mất sau khi quét đầy đủ thành công. Worker kiểm tra revision trước/sau download và checksum nếu có. Không tự quét theo lịch; BTC phải gọi sync khi thay đổi thư mục/quyền.
- **Retry:** `POST /api/admin/photo-albums/<id>/retry {}` hoặc `/api/admin/photos/<id>/retry {}`. Lỗi network/media tự retry tối đa 3 lần, có backoff; lỗi inference giữ preview và chờ retry thủ công hoặc sync. Retry/index mới có thể tạm ẩn ảnh đó trong thời gian xử lý.
- **Gỡ ảnh:** `DELETE /api/admin/photos/<id>` tạo tombstone, xóa vector và loại khỏi gallery/search; không xóa nguồn Drive, sync không hồi sinh ảnh đã gỡ. Worker cũ không thể commit sau khi mất lease/token/revision.
- **Dọn:** mỗi khoảng 60 giây worker xóa search token hết hạn và tối đa 50 object R2 không active đã cũ hơn 20 phút. Khi worker dừng, cleanup cũng dừng. Lỗi R2 giữ metadata để thử lại; không đặt lifecycle xóa toàn bộ prefix đang active.
- **Tắt search:** đặt `PHOTO_SEARCH_ENABLED=0` trên backend rồi rollout restart. Gallery tiếp tục hoạt động. Muốn dừng nhập mới, scale worker về 0. Không cần rollback/drop bảng dữ liệu để tắt tính năng.
- **Preview:** API vẫn trả signed URL có hạn 5 phút, có thể cache private 4 phút. Nếu bucket dùng chung có domain public thì URL qua domain đó tuân theo quyền public của bucket; draft/hidden chỉ được lọc ở API gallery/search. Gỡ/ẩn album chặn cấp signed URL mới nhưng không thu hồi URL public hoặc bản sao đã tải. Không lưu signed URL lâu dài ở frontend.
- **Backup:** `photos-db` chưa có backup tự động; `pg_dump` thủ công trước sự kiện nếu muốn giữ trạng thái album/tombstone. Backup này gồm vector, trạng thái và tombstone; backup R2 derivatives theo chính sách riêng. Ảnh gốc do Drive giữ. Sau restore, xác minh trạng thái album/tombstone trước khi mở lại public để tránh xuất bản lại ảnh đã gỡ sau mốc backup.

## Kiểm tra local

```sh
cd backend/webapi
python -m pytest photo_gallery/tests --ds=serverapi.settings_test_photos -q
python manage.py makemigrations photo_gallery --check --dry-run --settings=serverapi.settings_test_photos
python -m pytest api/tests --ds=serverapi.settings_test -q
```

Các test dùng SQLite và giả lập dịch vụ bên ngoài; không thay thế kiểm tra PostgreSQL/pgvector, Drive/R2 thật hoặc benchmark nhận diện. Đã smoke test tải/khởi tạo model thật và inference ảnh trống trên CPU local; chưa đo độ chính xác hay throughput ảnh sự kiện trên node đích. Môi trường hiện tại không có Docker daemon chạy nên chưa build container hoặc test DB PostgreSQL trong container. Chưa deploy lên cluster.

Đánh giá trước khi mở search: đo ảnh đông người/thiếu sáng/góc nghiêng và truy vấn người không có trong album; tách người giữa tập hiệu chỉnh và đánh giá. Ghi precision/recall theo ảnh, tỷ lệ false match, thời gian tải Drive, indexing, p50/p95 search và RAM/CPU pod. Ngưỡng và tốc độ không suy ra từ smoke test ảnh trống.
