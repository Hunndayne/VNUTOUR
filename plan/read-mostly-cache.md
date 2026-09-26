# Kế hoạch Redis cache cho dữ liệu cấu hình đọc nhiều

## 1. Branch đề xuất

`feat/perf-redis-read-mostly-cache`

Luồng Git đề xuất:

1. Cập nhật remote refs và xử lý chênh lệch `main`/`staging` trước khi bắt đầu. Ở snapshot local hiện tại, `main...staging` đang lệch `25/16` commit; không nên tạo branch rồi mới phát hiện thiếu thay đổi từ một nhánh.
2. Sau khi `staging` đã nhận các thay đổi production cần thiết từ `main`, tạo branch trên `staging`.
3. Mở PR `feat/perf-redis-read-mostly-cache` → `staging`.
4. Test cache hit/miss/invalidation và Redis outage trên staging.
5. Khi đạt tiêu chí nghiệm thu, promote `staging` → `main` theo quy trình release hiện hành.

Không tạo branch trong lượt lập kế hoạch này.

## 2. Mục tiêu và phạm vi

Tận dụng Django cache backend/Redis đã có, không dựng Redis thứ hai. Áp dụng cache-aside cho ba nhóm dữ liệu:

1. Public site config: `GET /api/public/site-config`.
2. Program structure: payload phase/sub-event/current phase/current sub-event từ `get_program()`.
3. Station configuration: `GET /api/program/phases/{phase_key}/sub-events/{event_id}/stations`.

PostgreSQL vẫn là source of truth. Redis chỉ giữ bản sao có thể tái tạo; Redis hỏng hoặc mất dữ liệu thì request vẫn đọc DB và trả kết quả.

Không đưa vào scope:

- Không cache quyết định ghi hoặc kiểm tra nghiệp vụ cần chính xác: mở đăng ký khi submit, capacity lock, anti-bot verification, check-in, QR, điểm và phân quyền.
- Không cache ORM model instance hoặc `HttpResponse`; chỉ cache dict/list đã serialize.
- Không thay Redis thành nơi lưu dữ liệu duy nhất.
- Không dùng `cache.clear()` hoặc xóa key theo wildcard.

## 3. Những điểm phải sửa so với giả định trong ảnh

### 3.1. Site config không chỉ phụ thuộc SystemSetting

Payload hiện chứa:

- `allow_signup` từ `SystemSetting.registration_open`;
- `registration_full` và `registration_slots_remaining` từ `max_registrations` cộng số `TeamMembership` thuộc các team đã submit;
- cấu hình anti-bot;
- cờ photo gallery từ environment.

Vì vậy full payload phải invalidate khi:

- admin đổi `registration_open`, `max_registrations` hoặc anti-bot;
- team chuyển từ draft sang trạng thái được tính capacity;
- thêm/xóa thành viên ở team được tính capacity;
- restore backup hoặc undo setting.

Đường submit/registration thật vẫn luôn đọc DB và dùng transaction/lock; cache site config chỉ phục vụ UI.

### 3.2. Station payload có hai mức dữ liệu

Admin nhận `submission_config` đầy đủ; cộng tác viên nhận bản đã loại answer key. Cache chung hai response có thể làm lộ đáp án.

Cache key phải tách ít nhất theo:

- `event_id`;
- `include_inactive`;
- scope `full` hoặc `public`.

Authorization phải chạy trước khi đọc cache.

### 3.3. Current phase/current sub-event chỉ cache ở response đọc

`get_current_sub_event()` đang được dùng trong các flow check-in/scan. Không cache helper/model này. Chỉ cache payload `get_program()` dùng để hiển thị; các quyết định nghiệp vụ vẫn đọc DB.

## 4. Thiết kế cache

### 4.1. Abstraction dùng chung

Tạo service riêng, ví dụ `api/services/read_mostly_cache.py`, cung cấp:

- key builder có namespace và version;
- cache-aside `get_or_load()`;
- TTL có jitter để tránh nhiều key hết hạn cùng lúc;
- fail-open: lỗi Redis được log/đếm metric rồi chạy loader DB;
- invalidation bằng `transaction.on_commit()`;
- bounded single-flight/dogpile protection cho cold miss; không để request chờ quá request budget.

Không tái sử dụng nguyên trạng `coop_realtime_cache.py`: module đó dành cho micro-cache 2–5 giây và key realtime. Có thể trích helper chung nếu việc này không làm đổi hành vi cache Coop.

Namespace gợi ý:

```text
vnutour:read-mostly:v1:site-config
vnutour:read-mostly:v1:program
vnutour:read-mostly:v1:stations:event:{event_id}:inactive:{0|1}:scope:{full|public}
```

Khi format payload thay đổi không tương thích, tăng `v1` thành `v2`; không flush toàn Redis.

### 4.2. TTL khởi điểm

| Cache                    | TTL khởi điểm | Lý do                                                                           |
| ------------------------ | ------------: | ------------------------------------------------------------------------------- |
| Site config full payload |    20–30 giây | Có capacity thay đổi theo đăng ký; không dùng TTL vài phút cho toàn payload     |
| Program structure        |  180–300 giây | Cấu trúc chỉ đổi qua admin, có invalidation chủ động                            |
| Station config           |  120–300 giây | Payload lớn, đọc rất nhiều, thay đổi ít và có invalidation chính xác theo event |

TTL là safety net khi sót hoặc lỗi invalidation, không phải cơ chế consistency chính.

Các setting đề xuất:

```text
READ_MOSTLY_CACHE_ENABLED=1
SITE_CONFIG_CACHE_TTL_SECONDS=30
PROGRAM_CACHE_TTL_SECONDS=300
STATION_CONFIG_CACHE_TTL_SECONDS=300
READ_MOSTLY_CACHE_TTL_JITTER_PERCENT=10
```

## 5. Workflow dễ hiểu

### 5.1. Luồng đọc

```text
Request
  → xác thực/phân quyền
  → tạo cache key đúng biến thể
  → Redis GET
      ├─ HIT  → trả payload cache
      ├─ MISS → lấy single-flight lock ngắn
      │          → đọc PostgreSQL
      │          → serialize payload
      │          → Redis SET với TTL+jitter
      │          → trả payload
      └─ ERROR → bỏ qua cache
                 → đọc PostgreSQL
                 → trả payload bình thường
```

Tại cold miss, chỉ một request nên rebuild key. Request cạnh tranh chờ rất ngắn rồi đọc lại key; nếu lock/Redis gặp lỗi thì fallback DB, không trả 500.

### 5.2. Luồng ghi và invalidate

```text
Admin/user gửi write
  → mở transaction
  → ghi PostgreSQL
      ├─ ROLLBACK → giữ cache hiện tại
      └─ COMMIT   → transaction.on_commit(...)
                      → xóa đúng key bị ảnh hưởng
                      → request đọc tiếp theo rebuild từ DB
```

Không update DB và cache như hai source song song. Write chỉ ghi DB; sau commit xóa cache. Nếu Redis delete lỗi, TTL sẽ tự loại bỏ bản cũ và hệ thống ghi log/metric để phát hiện.

## 6. Invalidation map

| Dữ liệu ghi                                         | Key cần invalidate                                              |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `registration_open`, `max_registrations`, anti-bot  | Site config                                                     |
| Team draft → pending hoặc team bị xóa               | Site config                                                     |
| Thêm/xóa membership làm thay đổi số người được tính | Site config                                                     |
| Set current phase/current sub-event                 | Program                                                         |
| Tạo/sửa/xóa phase hoặc sub-event                    | Program                                                         |
| Tạo/sửa/xóa station                                 | Mọi biến thể station key của `event_id` đó                      |
| Import/sửa/xóa/clear question bank                  | Mọi biến thể station key của `event_id` đó                      |
| Auto-create check-in station                        | Station keys của event đó                                       |
| Restore backup                                      | Site config + program + toàn bộ station cache namespace/version |

Ưu tiên invalidation tại domain service/write path và `transaction.on_commit()`. Với `bulk_create()`/`QuerySet.update()`, phải gọi invalidation tường minh vì Django signal không chạy. Nếu dùng signal để bao phủ `save/delete`, vẫn phải giữ hook tường minh cho các bulk path và backup restore.

## 7. Các bước triển khai

### Bước 0 — Baseline

- Đo request rate, p50/p95/p99, số query/request và thời gian DB của ba endpoint.
- Đo kích thước station payload và xác nhận số request thực tế được nêu trong ảnh.
- Ghi baseline Redis memory/error và DB CPU/connections để so sánh sau rollout.

### Bước 1 — Cache foundation

- Thêm service cache-aside, key version, jitter, fail-open và invalidation helper.
- Thêm config/env với khả năng tắt nhanh.
- Thêm metric/log: hit, miss, loader duration, Redis error, invalidation error, payload size.

### Bước 2 — Site config

- Gom việc đọc các setting cần thiết và chỉ tính `current_registrations` một lần khi rebuild payload.
- Cache riêng payload public endpoint; không cache các helper đang dùng cho signup/capacity enforcement.
- Invalidate ở setting, team/membership write và undo/restore liên quan.

### Bước 3 — Program structure

- Cache dict do `get_program()` tạo ra.
- Invalidate khi phase/sub-event/current event thay đổi.
- Giữ `get_current_phase()` và `get_current_sub_event()` trên DB cho các flow hành động.

### Bước 4 — Station config

- Chuyển phần serialize station thành loader/service có thể cache.
- Tách key `full/public` và `include_inactive`.
- Invalidate đủ bốn biến thể của event sau station/question-bank write.
- Kiểm tra và giảm N+1 ở cold miss bằng prefetch/batch question-bank nếu baseline cho thấy cần; cache không được dùng để che một cold path quá đắt.

### Bước 5 — Test và tài liệu

- Unit/integration test cho hit, miss, expiry, jitter, Redis down và key version.
- Test invalidation chỉ xảy ra sau commit; rollback không xóa cache.
- Test mọi mutation route nêu trong bảng invalidation.
- Test admin không bao giờ nhận payload bị strip và collab không bao giờ nhận answer key từ cache.
- Test signup/capacity/check-in vẫn đọc trạng thái DB mới nhất dù response cache đang cũ.
- Cập nhật tài liệu Redis và config mẫu.

### Bước 6 — Rollout

1. Deploy staging với cache disabled để xác nhận config không đổi hành vi.
2. Bật site config và program trước; theo dõi ít nhất một chu kỳ vận hành/test mutation.
3. Bật station cache sau khi test role separation và question-bank invalidation.
4. Load test warm cache, cold cache và invalidate đồng thời.
5. Promote production; bật theo từng nhóm key và theo dõi Redis/DB/API.

## 8. Tiêu chí nghiệm thu

- Response trước/sau cache giống nhau cho mọi biến thể được hỗ trợ.
- Warm hit không truy vấn các bảng cấu hình tương ứng.
- Admin đổi cấu hình và request kế tiếp sau commit thấy dữ liệu mới.
- Rollback không làm mất entry hợp lệ.
- Redis unavailable không làm endpoint trả 500; DB chịu được đường fallback.
- Không có answer key trong response collab kể cả khi admin vừa warm cache.
- Capacity enforcement vẫn đúng dưới concurrency vì quyết định ghi dùng DB lock, không dùng site-config cache.
- Không có `cache.clear()` trong production path.
- Hit ratio và DB load cải thiện so với baseline; p95 không xấu đi khi Redis lỗi.

## 9. Rollback

- Đặt `READ_MOSTLY_CACHE_ENABLED=0` và rollout backend; mọi request quay về DB.
- Không cần migration và không cần xóa Redis.
- Nếu chỉ một nhóm có lỗi, hỗ trợ cờ bật/tắt riêng theo nhóm hoặc tăng key version sau khi sửa format.
