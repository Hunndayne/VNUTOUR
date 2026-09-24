# Cache và Redis - Lý thuyết, case study và định hướng tích hợp VNUTOUR

> Ngày biên soạn: 23/09/2026  
> Phạm vi khảo sát: Django REST, PostgreSQL, React và Kubernetes trong repository `D:\VNUTOUR`.

## 1. Kết luận dành riêng cho VNUTOUR

Redis phù hợp với VNUTOUR, nhưng nên được đưa vào theo ba vai trò có thứ tự ưu tiên:

1. **Chuyển rate limit ra khỏi PostgreSQL.** Hiện bộ đếm rate limit được lưu trong bảng `vnutour_cache`, nên mỗi lần chống spam lại tạo thêm truy cập vào chính database cần được bảo vệ.
2. **Cache các kết quả đọc hoặc aggregate đắt và được nhiều người đọc**, như site config, dashboard, cấu trúc chương trình và bảng điểm.
3. **Micro-cache một số dữ liệu realtime trong 1–3 giây**, nhưng chỉ sau khi đã có cơ chế invalidation và đo đạc.

Không nên dùng Redis làm nguồn dữ liệu chính cho điểm số, check-in, đăng ký, thanh toán, phiên thi hoặc draft. PostgreSQL vẫn phải là source of truth.

## 2. Hiểu cache bằng 5W1H

| Câu hỏi                       | Trả lời trong VNUTOUR                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What - Cache là gì?**       | Một bản sao tạm thời của dữ liệu hoặc kết quả tính toán. Mất cache không được làm mất dữ liệu gốc.                                                       |
| **Why - Vì sao cần?**         | Giảm số query, kết nối và phép aggregate trên PostgreSQL; giảm latency; hấp thụ các đợt polling đồng thời.                                               |
| **Who - Ai sử dụng?**         | Các Gunicorn worker, backend pod, bot/email worker và về sau có thể cả frontend/CDN. Redis giúp các process dùng chung một cache.                        |
| **When - Khi nào nên cache?** | Khi dữ liệu được đọc nhiều hơn ghi, tính toán tương đối đắt, nhiều request hỏi cùng một câu và nghiệp vụ chấp nhận dữ liệu cũ trong một khoảng xác định. |
| **Where - Đặt ở đâu?**        | Giữa Django và PostgreSQL, chỉ truy cập nội bộ trong cluster hoặc VPN; không public Redis ra Internet.                                                   |
| **How - Làm thế nào?**        | Ưu tiên cache-aside: đọc Redis → miss thì đọc PostgreSQL → ghi Redis với TTL; khi ghi DB thành công thì xóa hoặc đổi version cache.                      |

Câu hỏi quan trọng nhất trước khi cache một dữ liệu là:

> Nếu Redis trả về giá trị cũ trong N giây, nghiệp vụ có sai hoặc gây thiệt hại không?

Nếu câu trả lời là “có”, không cache đường quyết định đó, hoặc phải thiết kế consistency và invalidation mạnh hơn TTL đơn thuần.

## 3. Cache giải quyết vấn đề gì?

Giả sử một endpoint nhận `R` request/giây, mỗi lần chạy tạo `Q` query DB, và cache hit ratio là `H`:

```text
DB query/giây trước cache ≈ R × Q
DB query/giây sau cache   ≈ R × (1 − H) × Q + query ghi
```

Ví dụ endpoint nhận 100 request/giây, tạo 5 query/request và đạt hit ratio 90%:

```text
Trước: 100 × 5        = 500 query/giây
Sau:   100 × 10% × 5 = 50 query/giây
```

Cache không giúp nhiều nếu:

- Mỗi request hỏi một dữ liệu khác nhau.
- Dữ liệu thay đổi liên tục.
- Query chưa có index hoặc đang gặp N+1.
- Bottleneck nằm ở write lock, CPU ứng dụng hoặc kết nối mạng.
- Giá trị cache lớn đến mức serialize và truyền qua mạng tốn ngang query DB.

Thứ tự tối ưu hợp lý:

1. Đo query và latency.
2. Sửa N+1, index và query aggregate.
3. Cache phần tải còn lặp lại.
4. Đo lại tác động.

## 4. Redis là gì?

Redis là một data server lưu dữ liệu chủ yếu trong RAM, cung cấp các phép toán atomic trên từng command và hỗ trợ TTL. Redis không chỉ là cache; nó còn có thể làm rate limiter, counter, lock, queue, Pub/Sub hoặc Stream.

Django hỗ trợ Redis trực tiếp qua `django.core.cache.backends.redis.RedisCache` và thư viện `redis-py`. Cache không được xem là nơi lưu dữ liệu vĩnh viễn.

Tài liệu tham khảo: [Django cache framework](https://docs.djangoproject.com/en/5.2/topics/cache/).

### 4.1. Các kiểu dữ liệu Redis

| Kiểu       | Dùng cho                            | Liên hệ VNUTOUR                                                                                                       |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| String     | JSON, counter, flag, lock           | Site config, dashboard JSON, rate counter                                                                             |
| Hash       | Object có nhiều field               | Trạng thái runtime nhỏ; chưa cần thiết nếu chỉ dùng Django cache backend                                              |
| Set        | Tập không trùng                     | Danh sách ID online hoặc đang hoạt động                                                                               |
| Sorted Set | Thành viên có score và ranking      | Có thể làm leaderboard, nhưng giai đoạn đầu nên cache kết quả scoreboard từ PostgreSQL thay vì duy trì hai nguồn điểm |
| List       | Hàng đợi đơn giản                   | Không nên thay email queue hiện tại khi chưa thiết kế retry và durability                                             |
| Stream     | Event log có consumer group         | Có thể dùng cho event và invalidation nâng cao                                                                        |
| Pub/Sub    | Thông báo realtime, không lưu bền   | Báo thay đổi scoreboard hoặc station state; mất kết nối có thể mất message                                            |
| Bitmap/HLL | Đếm membership hoặc unique gần đúng | Analytics; không dùng cho số liệu nghiệp vụ cần chính xác                                                             |

Dùng Django cache backend thường có nghĩa là serialize cả Python value thành một Redis String. Chỉ nên dùng Hash hoặc Sorted Set trực tiếp khi thực sự cần phép toán Redis chuyên biệt.

## 5. Những chiến lược cache quan trọng

### 5.1. Cache-aside - phù hợp nhất với VNUTOUR

Luồng đọc:

```text
Request
  → GET Redis
  → hit: trả dữ liệu
  → miss: query PostgreSQL
           → SET Redis + TTL
           → trả dữ liệu
```

Luồng ghi:

```text
Ghi PostgreSQL thành công
  → xóa hoặc đổi version cache
  → lần đọc kế tiếp nạp lại dữ liệu
```

Redis khuyến nghị cache-aside cho workload đọc lặp, dùng TTL để giới hạn thời gian stale và invalidation khi ghi.

Tài liệu tham khảo: [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/).

Ưu điểm:

- PostgreSQL vẫn là source of truth.
- Redis mất dữ liệu vẫn phục hồi được.
- Chỉ dữ liệu thực sự được truy cập mới chiếm RAM.
- Dễ rollout dần từng endpoint.

Nhược điểm:

- Request miss chịu cả latency Redis và DB.
- Phải thiết kế invalidation.
- Nhiều request cùng miss có thể gây stampede.

Đây nên là pattern mặc định cho VNUTOUR.

### 5.2. Read-through

Ứng dụng hỏi cache; cache tự biết cách load DB khi miss. Django cache backend không tự load ORM, vì vậy cần abstraction hoặc library riêng.

Ưu điểm là code đọc đơn giản. Nhược điểm là logic truy cập dữ liệu bị giấu trong cache layer và khó kiểm soát query phức tạp.

### 5.3. Write-through

Mọi write cập nhật DB và cache đồng thời trước khi trả kết quả.

Các rủi ro:

- DB thành công nhưng Redis thất bại.
- Redis thành công nhưng transaction DB rollback.
- Phải xác định hệ thống nào được ghi trước.

Không nên là lựa chọn mặc định cho điểm, check-in và đăng ký.

### 5.4. Write-behind hoặc write-back

Ghi Redis trước, đẩy xuống DB sau.

Cách này nhanh nhưng có thể mất dữ liệu nếu Redis hoặc worker lỗi. Không phù hợp cho:

- Điểm số.
- Thanh toán.
- Check-in/check-out.
- Đăng ký đội.
- Cấu hình bảo mật.

Có thể phù hợp cho analytics không quan trọng hoặc telemetry.

### 5.5. Stale-while-revalidate

Trả dữ liệu cache hơi cũ ngay, đồng thời refresh nền.

Phù hợp với feed public, nội dung landing page hoặc thống kê không quan trọng. Không phù hợp với QR, quyền truy cập và trạng thái phiên thi.

## 6. TTL và tính nhất quán

TTL trả lời câu hỏi:

> Cache được phép giữ bản sao này bao lâu?

TTL không thay thế invalidation. Nó chỉ là lớp bảo hiểm khi invalidation thất bại.

- TTL ngắn: dữ liệu mới hơn, nhưng hit ratio thấp và DB bị đánh nhiều hơn.
- TTL dài: hit ratio cao hơn, nhưng stale lâu hơn.
- Không TTL: dễ tồn tại dữ liệu cũ vô thời hạn.

Uber dùng TTL cùng invalidation và cho chủ dịch vụ quyết định TTL theo độ stale chấp nhận được. Họ cũng chỉ ra rằng TTL giới hạn thời gian một bản cache sai tiếp tục được phục vụ, nhưng dữ liệu nằm trong bản cache đó có thể đã rất cũ nếu invalidation thất bại.

Tham khảo: [Uber CacheFront consistency](https://www.uber.com/py/en/blog/how-uber-serves-over-150-million-reads/).

### 6.1. TTL jitter

Không nên cho hàng nghìn key cùng hết hạn đúng 60 giây:

```text
TTL = 60 + random(0, 15)
```

Jitter làm phân tán thời điểm hết hạn và tránh cache avalanche.

### 6.2. Invalidation an toàn với transaction

Không xóa cache trước khi transaction DB commit. Nếu transaction rollback, cache đã bị xóa vô ích; request khác còn có thể nạp trạng thái không đúng vào cache.

Trong Django nên dùng:

```python
from django.core.cache import cache
from django.db import transaction

with transaction.atomic():
    # Cập nhật PostgreSQL.
    ...

    transaction.on_commit(
        lambda: cache.delete("scoreboard:qualifying:v1")
    )
```

Với dữ liệu có nhiều key liên quan, versioned key thường dễ quản lý hơn xóa wildcard:

```text
scoreboard:qualifying:revision = 17
scoreboard:qualifying:data:17
```

Khi điểm thay đổi, tăng revision. Request mới không còn đọc key version cũ.

## 7. Các lỗi cache kinh điển

| Lỗi                   | Hiện tượng                                            | Cách phòng                                                     |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| Cache penetration     | Request liên tục hỏi ID không tồn tại và luôn đánh DB | Negative caching với TTL ngắn, validate input, rate limit      |
| Cache stampede        | Một hot key hết hạn, hàng trăm request cùng query DB  | Lock/single-flight, early refresh, stale-while-revalidate      |
| Cache avalanche       | Nhiều key hết hạn cùng lúc hoặc Redis restart         | TTL jitter, warm-up có giới hạn, circuit breaker               |
| Hot key               | Một key nhận phần lớn traffic                         | Replication, client/local cache ngắn, chia payload nếu cần     |
| Big key               | Một value JSON quá lớn gây network hoặc CPU spike     | Giới hạn kích thước, phân trang, không cache toàn bộ dataset   |
| Stale data            | Cache không bị invalidated sau write                  | `on_commit`, version key, TTL bảo hiểm                         |
| Cache poisoning       | Key thiếu user, role hoặc tenant làm lộ response      | Thiết kế key đầy đủ; không cache response cá nhân chung        |
| Eviction ngoài ý muốn | Key quan trọng bị đẩy ra khi hết RAM                  | `maxmemory`, policy phù hợp, tách rate limit khỏi cache thường |
| Redis outage          | API lỗi theo cache                                    | Cache read phải fail-open về DB; timeout ngắn, circuit breaker |
| Cold cache            | Sau restart hoặc failover, mọi request đổ vào DB      | Warm dần, giới hạn concurrency, DB phải chịu được cache miss   |

Stampede đặc biệt quan trọng với scoreboard hoặc site config: đây thường chỉ là một vài key nhưng được rất nhiều người hỏi.

## 8. TTL, eviction và persistence

### 8.1. Eviction

Redis cần có `maxmemory`. Khi chạm giới hạn, Redis xử lý key theo eviction policy.

- `allkeys-lru`: ưu tiên giữ key được dùng gần đây.
- `allkeys-lfu`: ưu tiên giữ key được dùng thường xuyên.
- `volatile-*`: chỉ xóa key có TTL.
- `noeviction`: không xóa; lệnh ghi mới trả lỗi.

Tài liệu Redis xem `allkeys-lru` là lựa chọn mặc định hợp lý khi một phần nhỏ dữ liệu được truy cập nhiều hơn phần còn lại.

Tham khảo: [Redis eviction](https://redis.io/docs/latest/reference/eviction/).

Đối với VNUTOUR:

- Cache response thuần túy: cân nhắc `allkeys-lru` hoặc `allkeys-lfu` dựa trên metrics.
- Rate limiter: eviction có thể làm người dùng được reset quota sớm. Nếu rate limit quan trọng, nên dùng Redis instance riêng với policy và memory riêng.
- Tách logical database `/0`, `/1` chỉ tách namespace; không tách RAM hoặc eviction.

`maxmemory` phải thấp hơn memory limit của container vì Redis còn cần RAM cho client buffer, fragmentation, replication và persistence. Không đặt `maxmemory` bằng đúng Kubernetes memory limit.

### 8.2. Persistence

Redis hỗ trợ:

- Không persistence.
- RDB snapshot.
- AOF log.
- RDB + AOF.

Tham khảo: [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).

Đề xuất:

- **Cache response thuần túy:** không persistence; mất Redis thì nạp lại từ PostgreSQL.
- **Rate limiter:** có thể chấp nhận mất window khi restart, nhưng phải quyết định rõ theo yêu cầu bảo mật.
- **Queue hoặc dữ liệu duy nhất:** không dùng cùng cấu hình cache thuần; phải đánh giá AOF, backup và failure semantics riêng.

## 9. Hiện trạng cache trong VNUTOUR

### 9.1. Cache đang được lưu trong PostgreSQL

Trong `backend/webapi/serverapi/settings.py`, `CACHES["default"]` đang dùng:

```python
"BACKEND": "django.core.cache.backends.db.DatabaseCache"
"LOCATION": "vnutour_cache"
```

Bảng cache được tạo bởi migration `backend/webapi/api/migrations/0032_antibot_cache_table.py`.

Rate limiter tại `backend/webapi/api/views_shared.py` gọi `cache.add()` và `cache.incr()`. Do backend hiện tại là PostgreSQL, một request login hoặc register bị rate-limit vẫn thực hiện thao tác vào DB.

Django cũng lưu ý `incr()` không được bảo đảm atomic nếu backend không hỗ trợ native increment.

### 9.2. Ưu tiên số 1: chuyển rate limit sang Redis

Chuyển cache backend sang Redis có thể offload rate limit mà gần như không phải sửa các callsite hiện tại. Tuy nhiên, để rate limiter chắc chắn dưới concurrency cao, nên tiến tới Lua script atomic:

```text
INCR key
nếu kết quả = 1 → EXPIRE key window
trả về count và TTL
```

Không nên để rate-limit key cạnh tranh memory với cache response nếu yêu cầu rate limit có tính bảo mật cao.

## 10. Nguồn tải lặp trong codebase

- Participant poll station state mỗi 5 giây tại `frontend/src/StationRunPage.jsx`.
- Shared form draft poll mỗi 5 giây tại `frontend/src/FormResponses.jsx`.
- Coop dashboard refresh mỗi 3 giây tại `frontend/src/CoopDashboard.jsx`. Mỗi lần refresh có thể gọi 2–5 endpoint.
- Station/check-in page poll mỗi 12–15 giây tại `frontend/src/StationsPage.jsx`.
- Question history poll mỗi 10 giây tại `frontend/src/QuestionReview.jsx`.
- Mỗi request authenticated còn gọi `find_by_token()` và query `Account` tại `backend/webapi/api/services/auth_service.py`.

Đây chưa phải số liệu production, nhưng về mặt cấu trúc, traffic polling có thể khuếch đại DB load rất nhanh.

Ví dụ, nếu 50 coop cùng mở dashboard và mỗi dashboard gọi trung bình 4 endpoint mỗi 3 giây:

```text
50 × 4 / 3 ≈ 67 API request/giây
```

Con số này chưa gồm participant polling, auth lookup và số query nghiệp vụ trong mỗi endpoint.

## 11. Ma trận cache đề xuất

| Dữ liệu                            |                   TTL khởi điểm | Invalidation                             | Khuyến nghị                                            |
| ---------------------------------- | ------------------------------: | ---------------------------------------- | ------------------------------------------------------ |
| Rate limit                         |            Theo window 10–3600s | Tự hết hạn                               | Chuyển Redis đầu tiên; instance hoặc alias riêng       |
| Public site config                 |                          15–30s | Setting, registration hoặc team thay đổi | Rất phù hợp                                            |
| Program phases/sub-events/stations |                         30–120s | Admin cập nhật cấu trúc                  | Phù hợp                                                |
| Scoreboard theo phase              | 3–10s khi thi; dài hơn khi khóa | ScoreEntry, roster, advancement thay đổi | Rất phù hợp                                            |
| Dashboard overview                 |                           3–10s | Team, check-in, session thay đổi         | Phù hợp                                                |
| Activity feed                      |                            2–5s | Có thể chỉ dùng TTL ngắn                 | Phù hợp vừa                                            |
| Event stats/occupancy              |                            1–2s | Enter/exit/check-in                      | Micro-cache sau                                        |
| Public feed page                   |                          15–60s | Post, comment hoặc reaction thay đổi     | Cache phần public; tách reaction cá nhân               |
| Station state của từng đội         |       Không cache giai đoạn đầu | Nhiều loại write liên quan               | Rủi ro cao                                             |
| Shared form draft                  | Không cache làm source of truth | PUT thường xuyên, last-write-wins        | Giữ PostgreSQL; có thể dùng Pub/Sub chỉ để báo refresh |
| Auth token/account                 |                    Cân nhắc sau | Logout, disable, role change             | Không cache model tùy tiện                             |
| Health endpoint                    |                     Không cache | -                                        | Phải kiểm tra DB thật                                  |
| Registration capacity decision     |                     Không cache | -                                        | Transaction và lock DB là nguồn quyết định             |
| Score/check-in/payment write       |            Không cache response | -                                        | PostgreSQL phải xác nhận write                         |

## 12. Các điểm nóng rõ nhất

### 12.1. Public site config

`backend/webapi/api/views_public.py` gọi trạng thái registration, full và remaining. Các helper đọc `SystemSetting` và đếm membership nhiều lần.

Trước khi cache nên:

1. Gom các setting trong một query.
2. Tính current registration một lần.
3. Cache payload hoàn chỉnh 15–30 giây.
4. Vẫn kiểm tra capacity bằng transaction khi người dùng submit.

Cache ở đây chỉ giúp UI; không thay thế `lock_registration_capacity()`.

### 12.2. Dashboard overview

`backend/webapi/api/views_dashboard.py` có nhiều `COUNT` và lặp qua từng event để đếm check-in/session. Đây vừa là ứng viên tối ưu aggregate query, vừa là ứng viên cache ngắn.

### 12.3. Scoreboard

`get_phase_scoreboard()` trong `backend/webapi/api/services/score_service.py` tạo roster, aggregate tổng điểm, sau đó chạy thêm aggregate cho từng sub-event.

Đây là ứng viên cache tốt vì nhiều người xem cùng một phase nhưng write điểm ít hơn read.

Key gợi ý:

```text
vnutour:prod:v1:scoreboard:{phase_key}:revision:{revision}
```

Khi tạo, sửa hoặc xóa `ScoreEntry`, tăng revision sau transaction commit.

### 12.4. Participant station state

`my_team_station_state_view()` trong `backend/webapi/api/views_participant.py` thực hiện nhiều query và mang cả QR hiện tại. QR có thể rotate sau scan và phải đi cùng session state.

Không nên cache toàn response này ban đầu. Một QR cũ trong cache có thể khiến người dùng đưa ra mã mà server đã thu hồi.

Hướng phù hợp hơn:

- Giảm query.
- Tránh query lặp trong một request.
- Sau này dùng SSE, WebSocket hoặc event notification.
- Nếu micro-cache thì tối đa khoảng 1 giây và phải invalidation đồng bộ khi scan hoặc rotate QR.

### 12.5. Form draft

Form draft hiện là dữ liệu cộng tác, thay đổi thường xuyên và dùng last-write-wins. Đưa nó thành dữ liệu chỉ tồn tại trong Redis có thể làm mất bản nháp khi Redis restart.

Có thể dùng Redis Pub/Sub để báo client khác refresh, nhưng PostgreSQL vẫn giữ nội dung draft.

## 13. Cấu hình Django tối thiểu

Codebase cho phép Django 5.x nhưng `backend/requirements.txt` hiện chưa khai báo `redis`. Khi triển khai cần thêm và pin phiên bản `redis-py` đã được test.

Cấu hình khái niệm:

```python
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": os.environ["REDIS_CACHE_URL"],
        "TIMEOUT": 60,
        "KEY_PREFIX": f"vnutour:{os.getenv('DJANGO_ENV', 'development')}:v1",
        "OPTIONS": {
            "pool_class": "redis.BlockingConnectionPool",
        },
    },
}
```

Django hỗ trợ Redis URL, authentication, replication và connection pool. Xem [cấu hình RedisCache chính thức](https://docs.djangoproject.com/en/5.2/topics/cache/).

Nguyên tắc:

- URL và password lấy từ Kubernetes Secret.
- Prefix khác nhau cho staging, prod và prod-standby.
- Không hard-code credential.
- Cache read lỗi phải fallback DB.
- Timeout kết nối Redis phải ngắn hơn DB hoặc request timeout.
- Không dùng `cache.clear()` trong production vì có thể xóa cả key của ứng dụng khác.

Ví dụ cache-aside:

```python
from django.core.cache import cache

_MISS = object()


def get_site_config():
    key = "public:site-config:v1"
    value = cache.get(key, _MISS)

    if value is not _MISS:
        return value

    value = load_site_config_from_database()
    cache.set(key, value, timeout=20)
    return value
```

Khi thay setting:

```python
transaction.on_commit(
    lambda: cache.delete("public:site-config:v1")
)
```

Production cần bọc cache access để Redis lỗi được xem là cache miss thay vì biến cache thành single point of failure.

## 14. Kiến trúc Redis cho hai vùng production

Codebase có `prod` và `prod-standby`.

### 14.1. Redis riêng tại mỗi site

Ưu điểm:

- Latency thấp.
- Không phụ thuộc đường truyền liên vùng.
- Redis site A lỗi không ảnh hưởng site B.

Nhược điểm:

- Standby có cold cache khi failover.
- Rate limit có thể reset sau chuyển vùng.
- Không phù hợp nếu hai site đồng thời nhận traffic và cần counter toàn cục.

Đây là lựa chọn hợp lý nếu Redis chỉ chứa cache disposable.

### 14.2. Redis dùng chung hoặc replicated liên vùng

Ưu điểm:

- Cache và counter liên tục qua failover.

Nhược điểm:

- Phức tạp hơn.
- Có replication lag.
- Redis chung có thể trở thành dependency liên vùng.
- Network partition tạo bài toán consistency.

Đề xuất cho VNUTOUR:

- Cache response: Redis riêng từng site.
- Rate limiter: xác định rõ có cần continuity toàn cục không. Nếu không, chấp nhận reset ngắn khi failover. Nếu có, thiết kế rate-limit store hoặc service riêng thay vì mặc định xem replication cache là nhất quán.
- PostgreSQL vẫn là nguồn dữ liệu chung có durability.

## 15. Case study thực tế

### 15.1. Uber: cache để giảm chi phí và latency DB

Uber xây CacheFront trước Docstore vì workload read lớn hơn write nhiều bậc, trong khi scale database bằng hardware hoặc sharding trở nên tốn kém và không giải quyết tốt hot partition. Hệ thống ban đầu phục vụ hơn 40 triệu read/giây và tập trung vào giảm tài nguyên DB, cải thiện P50/P99 và ổn định microburst.

Tham khảo: [Uber CacheFront - 40M reads/s](https://www.uber.com/us/en/blog/how-uber-serves-over-40-million-reads-per-second-using-an-integrated-cache/).

Sau đó họ phát triển lên hơn 150 triệu row read/giây với:

- TTL.
- Automatic invalidation.
- Negative caching.
- Pipelining.
- Cache warming.
- Circuit breaker.
- Connection rate limiter.
- Công cụ đo độ stale.

Tham khảo: [Uber CacheFront - 150M reads/s](https://www.uber.com/py/en/blog/how-uber-serves-over-150-million-reads/).

**Bài học cho VNUTOUR:** cache không chỉ là `GET/SET`; observability, invalidation và cách hệ thống phản ứng khi Redis lỗi quyết định chất lượng production.

### 15.2. GitHub: Redis cho rate limiter và bài học về eviction

GitHub từng để rate-limit data chung với application cache trong Memcached. Khi cache đầy và eviction xảy ra, một số rate-limit key biến mất, làm client có window mới ngoài ý muốn. GitHub chuyển sang replicated, sharded Redis cho rate limiter.

Tham khảo: [GitHub Redis rate limiter](https://github.blog/engineering/how-we-scaled-github-api-sharded-replicated-rate-limiter-redis/).

**Bài học cho VNUTOUR:** rate limit và cache response có mức độ quan trọng khác nhau. Không nên mặc định cho cả hai cạnh tranh cùng một memory pool và eviction policy.

### 15.3. GitHub: không biến Redis thành source of truth mặc định

GitHub phân biệt:

- Transient Redis: LRU cache cho kết quả tính toán có bản gốc ở Git hoặc MySQL.
- Persistent Redis: dữ liệu không có bản gốc khác.

GitHub chuyển dữ liệu persistent Redis về MySQL để giảm độ phức tạp vận hành và dựa trên thế mạnh database hiện có. Trong quá trình đó, họ còn giảm 65% write cho một activity timeline bằng cách thay đổi mô hình fan-out.

Tham khảo: [GitHub moving persistent data out of Redis](https://github.blog/engineering/infrastructure/moving-persistent-data-out-of-redis/).

**Bài học cho VNUTOUR:** đôi khi tối ưu data access pattern quan trọng hơn thêm Redis. Redis nên giữ bản sao, không phải nơi duy nhất chứa điểm, check-in hoặc draft.

## 16. Observability bắt buộc

Không đánh giá Redis bằng cảm giác “API có vẻ nhanh hơn”. Cần đo trước và sau rollout.

### 16.1. Ở ứng dụng

- `cache_hit_total`, `cache_miss_total`.
- Hit ratio theo endpoint hoặc key family.
- Cache get/set latency.
- Cache error và fallback count.
- Payload serialized size.
- Số query DB/request.
- P50, P95 và P99 của endpoint.

### 16.2. Ở Redis

- `used_memory`, `used_memory_rss`, fragmentation.
- `keyspace_hits`, `keyspace_misses`.
- `evicted_keys`, `expired_keys`.
- `connected_clients`, `blocked_clients`.
- `rejected_connections`.
- Command latency.
- Network ingress/egress.
- Replication lag nếu có replica.

### 16.3. Ở PostgreSQL

- Queries/second.
- Active và idle connections.
- Lock wait.
- PostgreSQL buffer cache hit ratio.
- Slow query.
- CPU và I/O.
- P95 transaction time.

Mục tiêu rollout nên được viết rõ:

```text
Scoreboard DB queries giảm ≥ 80%
Redis hit ratio ≥ 85%
P95 endpoint giảm ≥ 50%
Không tăng error rate
Khi tắt Redis, API vẫn đọc được từ PostgreSQL
Không quan sát response stale vượt ngân sách đã định
```

Các ngưỡng trên chỉ là ví dụ khởi điểm; cần điều chỉnh theo baseline thực tế.

## 17. Lộ trình tích hợp an toàn

### Giai đoạn 0 - Baseline

- Thu thập query count và endpoint latency.
- Xác định top endpoint theo `request rate × query count × query cost`.
- Load-test polling scenario.
- Đo kích thước payload dự kiến cache.

### Giai đoạn 1 - Redis cho rate limit

- Deploy Redis ở staging.
- Đổi Django cache backend.
- Chạy lại test anti-bot, login, signup và password reset.
- Kiểm tra concurrency và expiry.
- Xác nhận Redis lỗi không làm toàn API lỗi.
- Sau khi ổn định, cân nhắc Lua rate limiter.

### Giai đoạn 2 - Low-risk cache

Cache:

- Public site config.
- Program structure.
- System settings.
- Scoreboard.
- Dashboard overview.

Dùng cache-aside, TTL, jitter và `transaction.on_commit`.

### Giai đoạn 3 - Realtime micro-cache

- Event stats.
- Occupancy.
- Recent sessions.
- Check-in counts.

Dùng TTL 1–3 giây và invalidation sau write. Đánh giá độ stale với trải nghiệm vận hành thực tế.

### Giai đoạn 4 - Giảm polling

Cache chỉ giảm tác hại của polling; nó không loại bỏ polling. Khi số người dùng tăng, cân nhắc:

- SSE cho station và scoreboard updates.
- WebSocket nếu cần giao tiếp hai chiều.
- Redis Pub/Sub chỉ làm tín hiệu refresh.
- PostgreSQL vẫn lưu state chính.

## 18. Checklist 5W trước khi thêm một cache key

### What

- Giá trị cụ thể được cache là gì?
- Là model, aggregate hay toàn response?
- Kích thước serialized lớn nhất là bao nhiêu?
- Có chứa PII, token hoặc dữ liệu phân quyền không?

### Why

- Query nào đang chậm hoặc lặp?
- Request rate hiện tại là bao nhiêu?
- Cache dự kiến giảm bao nhiêu query DB?
- Có thể giải quyết bằng index hoặc query tốt hơn không?

### Who

- Key dùng chung toàn hệ thống, theo phase, theo team hay theo user?
- Role khác nhau có nhìn thấy payload khác nhau không?
- Ai chịu trách nhiệm invalidation khi write?

### When

- Khi nào dữ liệu thay đổi?
- Độ stale tối đa được phép là bao nhiêu?
- Khi nào key phải bị xóa hoặc đổi version?
- Khi Redis restart, DB có chịu nổi warm-up không?

### Where

- PostgreSQL table nào là source of truth?
- Key nằm trong cache response hay rate-limit store?
- Redis của site nào giữ key?
- Môi trường staging và prod đã có prefix riêng chưa?

### How

- Cache-aside, micro-cache hay stale-while-revalidate?
- TTL và jitter là bao nhiêu?
- Fail-open hay fail-closed khi Redis lỗi?
- Metric và alert nào chứng minh cache hoạt động đúng?

## 19. Nguyên tắc cần ghi nhớ

- Cache dữ liệu có thể tái tạo; không cache quyết định cần tính đúng tuyệt đối.
- TTL là giới hạn stale, không phải cơ chế đồng bộ đầy đủ.
- DB commit trước, invalidation sau.
- Redis lỗi nên làm hệ thống chậm hơn, không làm hệ thống ngừng hoạt động.
- Hit ratio cao không có ý nghĩa nếu dữ liệu trả về sai.
- Với VNUTOUR, điểm khởi đầu có ROI cao nhất là đưa rate limit ra khỏi PostgreSQL, sau đó cache site config, scoreboard và dashboard; không bắt đầu từ station state hoặc các transaction check-in.

Từ điển thuật ngữ đã được tách thành
[REDIS-GLOSSARY.md](REDIS-GLOSSARY.md) để tiện tra cứu độc lập.

## 20. Tài liệu tham khảo

- [Django’s cache framework](https://docs.djangoproject.com/en/5.2/topics/cache/)
- [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/)
- [Redis key eviction](https://redis.io/docs/latest/reference/eviction/)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Uber: How Uber Serves Over 40 Million Reads Per Second](https://www.uber.com/us/en/blog/how-uber-serves-over-40-million-reads-per-second-using-an-integrated-cache/)
- [Uber: How Uber Serves Over 150 Million Reads Per Second](https://www.uber.com/py/en/blog/how-uber-serves-over-150-million-reads/)
- [GitHub: Sharded, replicated rate limiter in Redis](https://github.blog/engineering/how-we-scaled-github-api-sharded-replicated-rate-limiter-redis/)
- [GitHub: Moving persistent data out of Redis](https://github.blog/engineering/infrastructure/moving-persistent-data-out-of-redis/)
