# Redis Glossary - Từ điển thuật ngữ và mindset

Tài liệu này tổng hợp các thuật ngữ được sử dụng trong
[Cache và Redis trong VNUTOUR](redis-cache-theory-and-integration.md), kèm cách
hiểu và ví dụ gắn với codebase.

## 1. Mô hình tư duy ngắn gọn

Hãy hình dung hệ thống theo mô hình sau:

```text
PostgreSQL = hồ sơ gốc có giá trị pháp lý
Redis      = bản photo đặt ở quầy để tra cứu nhanh
Cache key  = nhãn trên từng bản photo
TTL        = hạn sử dụng ghi trên bản photo
Invalidation = hành động hủy bản photo khi hồ sơ gốc thay đổi
Cache miss = không tìm thấy bản photo, phải lấy hồ sơ gốc để photo lại
```

Trong VNUTOUR:

- Điểm, check-in, đăng ký và form draft trong PostgreSQL là hồ sơ gốc.
- Scoreboard hoặc site config trong Redis chỉ là bản sao có thể tạo lại.
- Redis bị xóa phải làm hệ thống chậm hơn trong lúc nạp lại, nhưng không được làm mất dữ liệu nghiệp vụ.
- Nếu không thể trả lời “bản gốc của key này nằm ở đâu?”, dữ liệu đó chưa phù hợp để đưa vào cache.

## 2. Dữ liệu gốc và bản sao

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **Source of truth** | Nơi chứa dữ liệu gốc được tin cậy khi các bản sao mâu thuẫn. | PostgreSQL là source of truth cho `ScoreEntry`, `StationSession`, `EventCheckIn`, team và participant. Nếu Redis khác PostgreSQL, phải tin PostgreSQL. |
| **Cache** | Bản sao tạm thời giúp tránh đọc hoặc tính lại dữ liệu gốc. | Payload scoreboard theo phase có thể được cache 5 giây thay vì chạy lại các phép `SUM` cho mọi request. |
| **Distributed cache** | Cache được đặt ở một dịch vụ dùng chung, thay vì nằm riêng trong từng process. | Hai Gunicorn worker đều đọc cùng một Redis. Nếu dùng `LocMemCache`, mỗi worker có một bản riêng và có thể trả kết quả khác nhau. |
| **Cache key** | Tên định danh duy nhất của một giá trị trong cache. | `vnutour:prod:v1:scoreboard:qualifying` đại diện cho scoreboard phase qualifying ở production. |
| **Namespace hoặc key prefix** | Tiền tố giúp các môi trường hoặc ứng dụng không ghi đè key của nhau. | `vnutour:staging:*` phải tách khỏi `vnutour:prod:*`; nếu không, staging có thể đọc nhầm site config của production. |
| **Key version** | Phiên bản nằm trong tên key để bỏ qua dữ liệu có format hoặc revision cũ. | Khi đổi format scoreboard, chuyển từ `v1` sang `v2` thay vì chạy `cache.clear()` và xóa mọi key. |
| **Serialization** | Chuyển object thành bytes hoặc chuỗi để lưu và khôi phục. | Django có thể serialize dictionary của site config trước khi lưu Redis. Payload càng lớn thì CPU và network cost càng cao. |
| **PII** | Personally Identifiable Information - dữ liệu có thể nhận diện cá nhân. | MSSV, email, số điện thoại và thông tin tài khoản không nên xuất hiện trong key hoặc response cache dùng chung. |

## 3. Vòng đời của một lần đọc cache

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **Cache hit** | Tìm thấy key còn hiệu lực trong Redis. | Request scoreboard lấy được payload ngay từ Redis và không chạy lại query aggregate trên `ScoreEntry`. |
| **Cache miss** | Key không tồn tại, hết hạn hoặc đã bị invalidated. | Lần đầu mở scoreboard sau khi deploy phải đọc PostgreSQL rồi ghi kết quả vào Redis. |
| **Hit ratio** | Tỷ lệ `hit / (hit + miss)`. Tỷ lệ càng cao thường càng giảm tải DB, nhưng không chứng minh dữ liệu đúng. | 900 hit và 100 miss cho site config tương ứng hit ratio 90%. |
| **TTL** | Time To Live - thời gian key được phép tồn tại trước khi tự hết hạn. | Scoreboard có TTL 5 giây nghĩa là nếu invalidation không chạy, bản cache có thể tiếp tục được trả trong tối đa khoảng thời gian đó. |
| **TTL jitter** | Cộng một khoảng ngẫu nhiên nhỏ vào TTL để key không hết hạn đồng loạt. | Các key dashboard có thể dùng TTL từ 10 đến 15 giây thay vì tất cả cùng hết hạn ở giây thứ 10. |
| **Stale data** | Dữ liệu cache vẫn hợp lệ về TTL nhưng đã cũ hơn dữ liệu gốc. | Cộng tác viên vừa sửa điểm trong PostgreSQL nhưng scoreboard Redis vẫn hiển thị điểm trước đó. |
| **Invalidation** | Xóa hoặc đổi version cache khi dữ liệu gốc thay đổi. | Sau khi `ScoreEntry` commit thành công, xóa scoreboard của phase tương ứng. |
| **Negative caching** | Cache kết quả “không tồn tại” trong thời gian ngắn để tránh truy vấn lặp. | Nhiều request dò cùng một shortlink không tồn tại có thể cache kết quả 404 vài giây. Không dùng TTL dài vì shortlink có thể được tạo ngay sau đó. |
| **Micro-cache** | Cache có TTL rất ngắn, thường từ dưới một giây đến vài giây. | Station occupancy có thể cache 1 giây để gom nhiều request đồng thời, trong khi vẫn gần realtime. |

Luồng cache-aside của scoreboard có thể đọc như sau:

```text
GET scoreboard key
  ├─ hit  → trả payload Redis
  └─ miss → query PostgreSQL → tạo payload → SET Redis với TTL → trả payload
```

## 4. Các chiến lược đọc và ghi

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **Cache-aside** | Ứng dụng tự kiểm tra cache; khi miss thì đọc DB và nạp cache. Khi write thành công thì invalid cache. | Phù hợp với `site_config_view`, dashboard và `get_phase_scoreboard()`. Đây là chiến lược mặc định được đề xuất. |
| **Read-through** | Cache layer tự load dữ liệu gốc khi miss. | Django `RedisCache` không tự biết cách query `ScoreEntry`; muốn read-through cần viết thêm abstraction biết cách load scoreboard. |
| **Write-through** | Một write cập nhật DB và cache trước khi trả thành công. | Không nên dùng mặc định cho điểm vì phải xử lý trường hợp PostgreSQL commit nhưng Redis update thất bại hoặc ngược lại. |
| **Write-behind hoặc write-back** | Ghi cache trước rồi đồng bộ xuống DB sau. | Không phù hợp với check-in và điểm: Redis hoặc worker lỗi có thể làm mất dữ liệu chưa kịp ghi PostgreSQL. |
| **Stale-while-revalidate** | Trả bản cache cũ ngay và refresh nền để lần sau có dữ liệu mới. | Có thể dùng cho public feed; không dùng cho QR hoặc quyền truy cập vì người dùng có thể hành động trên dữ liệu cũ. |
| **`transaction.on_commit()`** | Chỉ chạy invalidation sau khi transaction DB commit thành công. | Nếu cập nhật điểm bị rollback, cache scoreboard không nên bị xóa như thể điểm đã đổi. |
| **Atomic operation** | Thao tác được thực hiện trọn vẹn, client khác không thấy trạng thái dở dang ở giữa. | Rate limiter cần tăng counter và đặt expiry theo một logic atomic để key không bị tồn tại vĩnh viễn hoặc đếm sai khi nhiều request đến cùng lúc. |
| **Lua script** | Đoạn logic chạy bên trong Redis như một thao tác atomic. | Có thể gộp `INCR`, kiểm tra giá trị đầu tiên và `EXPIRE` cho rate limiter của login/register. |

## 5. Các sự cố thường gặp

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **Cache stampede hoặc thundering herd** | Nhiều request cùng miss một hot key và đồng loạt query DB. | Scoreboard hết TTL đúng lúc hàng trăm participant refresh; tất cả cùng chạy aggregate. Có thể dùng single-flight lock hoặc refresh sớm. |
| **Cache avalanche** | Nhiều key hết hạn cùng lúc hoặc Redis restart, khiến tải lớn đổ về DB. | Sau khi Redis production restart, site config, program, dashboard và scoreboard đều miss. TTL jitter và warm-up có kiểm soát giúp giảm tải. |
| **Cache penetration** | Request liên tục hỏi dữ liệu không tồn tại nên cache không giữ được gì và DB luôn bị gọi. | Bot thử hàng nghìn shortlink code giả. Dùng validation, rate limit và negative caching TTL ngắn. |
| **Hot key** | Một key nhận phần lớn traffic của Redis. | Scoreboard của phase hiện tại có thể nóng hơn toàn bộ các phase cũ cộng lại. Cần theo dõi latency và kích thước của key này. |
| **Big key** | Một key có value quá lớn hoặc chứa quá nhiều phần tử. | Cache toàn bộ feed, comment và reaction trong một JSON lớn có thể làm mỗi hit vẫn tốn CPU/network. Nên phân trang hoặc chia key. |
| **Cold cache** | Cache mới khởi động hoặc vừa bị xóa nên chưa có dữ liệu phổ biến. | Khi prod-standby tiếp quản traffic, Redis tại site đó có thể chưa có scoreboard và program data. |
| **Warm-up** | Nạp trước hoặc nạp dần các key phổ biến để tránh cold cache dồn tải vào DB. | Sau deploy, có thể gọi có giới hạn các endpoint site config/program; không đồng loạt nạp mọi team và mọi phase. |
| **Cache poisoning** | Ghi dữ liệu sai hoặc sai phạm vi vào key khiến request sau nhận kết quả không thuộc về nó. | Nếu cache response account details mà key không chứa account ID và quyền, user sau có thể nhận dữ liệu của user trước. |

## 6. Bộ nhớ và độ bền của Redis

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **`maxmemory`** | Giới hạn RAM Redis được phép dùng cho dataset. | Phải đặt thấp hơn memory limit của pod để chừa RAM cho client buffer, fragmentation và tiến trình Redis. |
| **Eviction** | Redis chủ động xóa key khi đạt `maxmemory`, theo policy đã cấu hình. | Evict scoreboard chỉ làm request sau query lại DB; evict rate-limit key có thể vô tình cấp lại quota cho client. |
| **LRU** | Least Recently Used - ưu tiên xóa key lâu không được truy cập. | Hợp lý khi phase hiện tại được xem thường xuyên còn dữ liệu phase cũ ít được mở. |
| **LFU** | Least Frequently Used - ưu tiên giữ key được truy cập nhiều lần. | Có thể giữ site config và scoreboard là các key được hỏi thường xuyên nhất. Cần chọn theo metrics thay vì phỏng đoán. |
| **Persistence** | Cơ chế ghi dữ liệu Redis xuống disk để phục hồi sau restart. | Response cache có thể tắt persistence vì PostgreSQL tạo lại được. Queue hoặc dữ liệu duy nhất thì cần thiết kế khác. |
| **RDB** | Snapshot Redis tại các thời điểm nhất định. | Nếu dùng cho cache thuần, RDB thường không cần thiết và quá trình snapshot vẫn tiêu tốn tài nguyên. |
| **AOF** | Append Only File - ghi lại các lệnh thay đổi để replay khi restart. | Không nên bật chỉ vì “an toàn hơn” nếu Redis chỉ chứa bản sao; phải cân nhắc I/O và mục tiêu phục hồi. |

## 7. Khả dụng, lỗi và failover

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **Fallback** | Đường xử lý thay thế khi cache không dùng được. | Redis timeout khi đọc scoreboard thì Django query PostgreSQL và vẫn trả kết quả, dù chậm hơn. |
| **Fail-open** | Dependency lỗi nhưng request vẫn được cho qua. | Nếu rate limiter fail-open khi Redis chết, login vẫn hoạt động nhưng lớp chống brute force bị suy yếu. |
| **Fail-closed** | Dependency lỗi thì từ chối request để bảo vệ tính đúng hoặc bảo mật. | Rate limiter fail-closed có thể chặn cả người dùng hợp lệ trong thời gian Redis lỗi. Đây là quyết định security/availability, không phải lựa chọn mặc định. |
| **Circuit breaker** | Sau nhiều lỗi liên tiếp, tạm ngừng gọi dependency để tránh mọi request tiếp tục chờ timeout. | Khi Redis down, backend tạm bỏ qua cache read và đi thẳng PostgreSQL trong một khoảng ngắn trước khi thử lại. |
| **Replication** | Duy trì bản sao Redis trên node khác. | Có thể tăng khả dụng nhưng không biến cache thành source of truth và không loại bỏ hoàn toàn mất dữ liệu vừa ghi. |
| **Replication lag** | Replica chậm hơn primary trong việc nhận update. | Sau invalidation ở primary, một read từ replica chậm có thể vẫn nhìn thấy giá trị cũ. |
| **Failover** | Chuyển traffic hoặc vai trò primary sang instance/site khác khi có lỗi. | Khi VNUTOUR chuyển từ prod sang prod-standby, cache tại site mới có thể cold dù PostgreSQL đã failover thành công. |
| **Connection pool** | Tập kết nối Redis được tái sử dụng thay vì mở TCP connection cho mỗi request. | Hai Gunicorn worker cần pool có giới hạn; pool không giới hạn có thể gây connection storm khi traffic tăng. |

## 8. Đo hiệu năng

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **Latency** | Thời gian hoàn thành một request hoặc operation. | Thời gian từ lúc coop dashboard gọi API đến lúc nhận event stats. |
| **Throughput** | Số operation hệ thống xử lý trong một đơn vị thời gian. | Số API request hoặc Redis command xử lý mỗi giây trong giờ cao điểm. |
| **P50** | 50% request nhanh hơn hoặc bằng giá trị này; gần với trung vị. | P50 scoreboard 40 ms nghĩa là một nửa request hoàn thành trong tối đa 40 ms. |
| **P95** | 95% request nhanh hơn hoặc bằng giá trị này; phản ánh nhóm người dùng chậm hơn bình thường. | P95 giảm từ 600 ms xuống 150 ms sau cache thường có ý nghĩa vận hành hơn chỉ nhìn average. |
| **P99** | 99% request nhanh hơn hoặc bằng giá trị này; cho thấy tail latency và spike hiếm. | P99 tăng mạnh khi cache stampede dù P50 vẫn thấp. |
| **Cache error rate** | Tỷ lệ thao tác Redis lỗi hoặc timeout. | Hit ratio cao nhưng cache error tăng trong giờ cao điểm vẫn là dấu hiệu pool, network hoặc Redis đang quá tải. |

## 9. Realtime và giao tiếp bất đồng bộ

| Thuật ngữ | Cách hiểu | Ví dụ trong VNUTOUR |
| --- | --- | --- |
| **Polling** | Client hỏi server lặp lại theo chu kỳ dù dữ liệu có thay đổi hay không. | `StationRunPage` hỏi station state mỗi 5 giây; `CoopDashboard` refresh live data mỗi 3 giây. |
| **SSE** | Server-Sent Events - server đẩy sự kiện một chiều tới browser qua kết nối HTTP dài. | Server có thể báo “station state changed” để participant tải lại thay vì poll cố định. |
| **WebSocket** | Kết nối hai chiều lâu dài giữa browser và server. | Chỉ cần khi client và server đều phải gửi realtime thường xuyên; phức tạp hơn nhu cầu chỉ nhận thông báo thay đổi. |
| **Redis Pub/Sub** | Redis chuyển message tức thời tới subscriber đang online nhưng không lưu message cho subscriber mất kết nối. | API scan có thể publish `station-state-changed`; gateway realtime nhận và báo browser refresh. PostgreSQL vẫn lưu session thật. |
| **Redis Stream** | Log sự kiện có thứ tự, lưu lại và hỗ trợ consumer group. | Có thể dùng cho pipeline event cần retry/ack trong tương lai, nhưng nằm ngoài phạm vi cache response hiện tại. |

## 10. Cách chọn thuật ngữ đúng cho từng case trong repo

| Case | Cách nên nghĩ |
| --- | --- |
| Site config được đọc nhiều, đổi ít | Cache-aside, TTL 15–30 giây, invalidation sau cập nhật setting. |
| Scoreboard được nhiều người xem | Hot key, cache-aside, TTL ngắn, jitter, chống stampede và invalidation sau score commit. |
| Registration capacity | Quyết định cần chính xác; PostgreSQL lock và transaction là nguồn quyết định, không dựa vào cache. |
| Station-state chứa QR có thể rotate | Dữ liệu nhạy với stale; không cache toàn response ở giai đoạn đầu. |
| Rate limiter | Counter cần atomic và TTL; phải quyết định fail-open/fail-closed và bảo vệ khỏi eviction. |
| Redis restart | Cold cache và nguy cơ avalanche; cần fallback DB, warm-up có giới hạn và quan sát DB load. |
| Chuyển traffic sang prod-standby | Failover ứng dụng không đồng nghĩa cache đã warm; phải chấp nhận hoặc chuẩn bị cold-cache load. |
| Hai Gunicorn worker cùng phục vụ API | Cần distributed cache hoặc shared rate counter; `LocMemCache` không cho hai worker cùng thấy một giá trị. |

## 11. Tài liệu liên quan

- [Cache và Redis trong VNUTOUR](redis-cache-theory-and-integration.md)
