# Hành trình trạm & luật chơi lại (vòng loại)

Trạng thái: **ĐANG CODE** (chốt 11/08/2026). Cách tính điểm là **setting theo trạm**
với 3 chế độ. 4 câu hỏi mở đã chốt theo đề xuất mặc định (xem cuối).

Nối tiếp màn hình thí sinh ở vòng loại (`StationRunPage`, route `/participant` embed + `/form`):
danh sách trạm hiện ra khi có trạm đang chạy. Tài liệu này biến danh sách đó thành
**hành trình** (tiến trình theo đội) và thêm **luật chơi lại trạm** kiểu năm ngoái.

## Quyết định đã chốt (đầu vào)

1. **Cách tính điểm là setting theo trạm** (tick trong trình sửa trạm), 3 chế độ:
   - `pass_fail` — **Đạt / Không đạt**: coop bấm đạt/không, KHÔNG nhập điểm số; đạt cộng
     `pass_points` (điểm cấu hình khi đạt), không đạt = 0.
   - `threshold` — **Ngưỡng điểm đạt**: coop nhập điểm; điểm ≥ `pass_threshold` ⇒ đạt.
   - `score_only` — **Chỉ nhập điểm**: coop nhập điểm; không có khái niệm đạt/trượt (đã ghé
     là coi như xong).
2. **Điểm mỗi trạm = lần chơi cao nhất** (không cộng dồn). Với `threshold`/`pass_fail`, chỉ
   các lần **đạt** mới được tính điểm; chưa từng đạt = 0.
3. **Luật chơi lại có công tắc bật/tắt theo event** (vì "có thể" mới cần) — mặc định tắt.

## Tận dụng cái đã có (không phải xây lại)

- **Occupancy "1/2 đội"**: `/my-team/stations` đã trả `capacity.current_teams /
  max_concurrent_teams`. Frontend chỉ cần hiển thị.
- **Vào lại trạm**: ràng buộc DB (`uq_active_session_station_team`,
  `uq_active_session_event_team`) chỉ chặn *một phiên đang mở*. Đóng phiên xong vào lại
  là được → **hiện tại chơi lại đang không giới hạn**. Luật mới là để *siết* lại.
- **Số lần ghé**: mỗi lần vào là một `StationSession`. COUNT theo (team, station) ra số
  lần ghé — chỉ cần thêm vào payload, không cần bảng mới.
- **Điểm & leaderboard**: `ScoreEntry(kind=station)` một dòng mỗi `station_session`
  (`exit_station` / `set_session_score` ghi). **Đây là chỗ phải sửa** — xem mục Điểm.

## Mô hình dữ liệu — thay đổi

### 1. Chế độ tính điểm trên trạm
`Station` thêm:
```
scoring_mode  = CharField(choices=["pass_fail","threshold","score_only"], default="score_only")
pass_threshold = IntegerField(default=0)   # chỉ dùng khi threshold
pass_points    = IntegerField(default=0)   # chỉ dùng khi pass_fail (điểm khi đạt)
```

### 2. Kết quả đạt/không đạt trên phiên trạm
`StationSession` thêm:
```
outcome = CharField(choices=[("pending","Chưa chấm"),("passed","Đạt"),("failed","Không đạt")],
                    default="pending")
```
- Set lúc checkout, tuỳ `scoring_mode`:
  - `pass_fail`: coop bấm → `passed`/`failed`.
  - `threshold`: suy từ điểm coop nhập (`score ≥ pass_threshold` ⇒ `passed`, else `failed`).
  - `score_only`: đóng phiên là `passed` (không có trượt).
- "Đội đã qua trạm X" = tồn tại ≥1 `StationSession(team, station, outcome="passed")`.

### 3. Công tắc luật chơi lại (theo event)
`SubEvent` thêm:
```
replay_after_all = BooleanField(default=False)
```
Bật ở trình sửa event (`EventManagementPage`). Chỉ có nghĩa với event có trạm.

## Trạng thái một trạm với một đội (suy ra, không lưu)

| Trạng thái | Điều kiện |
|---|---|
| `not_visited` | Không có session nào (active/closed) |
| `active` | Có session `status=active` tại trạm này |
| `passed` | Có ≥1 session `outcome=passed` |
| `failed` | Đã ghé (có session closed) nhưng chưa có session nào `passed` |

`visit_count` = số session `status ∈ {active, closed}` (bỏ `cancelled` — coop huỷ phiên
không tính là một lần ghé).

## Điểm — max qua các lần (thay đổi cách tổng hợp)

Hiện tại mỗi session sinh một `ScoreEntry`, leaderboard **cộng tất cả** → chơi 3 lần
điểm 2/5/3 thành 10. Yêu cầu mới: trạm đó chỉ tính **5**.

Phương án: **giữ đúng một `ScoreEntry(kind=station)` cho mỗi (team, station)** = điểm trạm.
Sau mỗi `exit_station` / chấm lại điểm / đổi outcome, tính lại điểm trạm theo `scoring_mode`:
- `score_only`: `max(session.score)` trên MỌI session của (team, station).
- `threshold`: `max(session.score)` chỉ trên các session `outcome=passed`; chưa đạt lần nào = 0.
- `pass_fail`: `pass_points` nếu có ≥1 session `passed`, else 0.

Rồi upsert MỘT `ScoreEntry` cho (team, station) = giá trị đó (gắn về session tốt nhất), xoá
các entry thừa. Chỗ này đụng `station_service.exit_station`, `set_session_score`,
`set_submission_score` (bài nộp dùng chung ScoreEntry của phiên) và cách leaderboard đọc —
**là phần rủi ro nhất, phải có test hồi quy điểm** (chơi 3 lần điểm 2/5/3 ⇒ trạm tính 5, không
phải 10).

## Luật chơi lại — thực thi ở bước quét vào

Chặn tại `enter_station` (mọi đường vào đều qua đây: `station_scan_view`,
`station_enter_view`). Khi `sub_event.replay_after_all == True` **và** đây là *lần vào lại*
(đội đã có ≥1 session closed tại trạm này):

- Cho vào chỉ khi **CẢ HAI**:
  - đội đã **ghé đủ mọi trạm active** của event (mỗi trạm ≥1 session active/closed), **và**
  - đội **chưa `passed`** trạm này.
- Không thì từ chối, mã lỗi:
  - `replay_locked_incomplete` → "Phải đi hết tất cả các trạm trước khi quay lại."
  - `replay_locked_passed` → "Đội đã qua trạm này rồi."

Lần vào **đầu tiên** của mỗi trạm luôn được (vẫn qua các gate cũ: roster, capacity, phase,
QR bật…). Khi tắt công tắc: giữ nguyên hành vi hiện tại (vào lại tự do).

## Journey UI (frontend, tái dùng `StationRunPage` list)

Thẻ mỗi trạm hiện thêm:
- **Occupancy**: "1/2 đội" (đầy → "đầy"; không giới hạn → chỉ số hiện tại).
- **Badge trạng thái**: Chưa ghé · Đang ở đây · Đã qua (điểm cao nhất X) · Chưa qua.
- **Số lần ghé**: "Đã ghé N lần" (khi > 1).
- Nếu luật bật và đang khoá: dòng gợi ý "Đi hết các trạm rồi mới được vào lại" /
  "Bạn đã qua trạm này".

Header hành trình: "Đã đi X/Y trạm · Đã qua Z · Tổng điểm ...".

Checkout phía coop (`CoopDashboard`, sau khi quét rời trạm): thêm nút **Đạt / Không đạt**
cạnh ô điểm; lưu `outcome` vào phiên.

## API — thay đổi

- `GET /my-team/stations`: mỗi trạm thêm `visit_count`, `best_score`, `outcome`
  (`not_visited|active|passed|failed`), và khi luật bật: `replay_locked` (bool) +
  `replay_reason`. Thêm summary cấp trên: `visited_count`, `total_stations`,
  `passed_count`, `all_visited`, `replay_enabled`.
- `enter_station` / `station_scan_view`: thêm mã lỗi `replay_locked_incomplete`,
  `replay_locked_passed`; `StationRunPage.deriveStep` + `explainScanError` (CoopDashboard)
  xử lý.
- Checkout: mở rộng endpoint chấm điểm phiên (hoặc payload exit) để nhận `outcome`.

## Câu hỏi mở — ĐÃ CHỐT theo mặc định (11/08/2026)

1. **Chưa đạt không được điểm** — điểm trạm chỉ tính các lần `passed` (mode threshold/pass_fail);
   score_only tính mọi lần.
2. **Không giới hạn số lần chơi lại**, cho tới khi `passed`; hết giờ event là dừng.
3. **"Đi hết trạm"** = mọi trạm active của event tại thời điểm quét; admin thêm trạm giữa
   chừng thì mốc tăng theo.
4. Luật áp **bất kỳ event nào bật công tắc** (không hardcode theo phase).

## Phạm vi lần này (khi được duyệt)

Backend: 2 field + migration, sửa tổng hợp điểm (max/station), gate chơi lại, mở rộng
payload `/my-team/stations` + checkout outcome, test hồi quy điểm + test luật. Frontend:
journey UI trong `StationRunPage`, nút Đạt/Không đạt trong `CoopDashboard`, thông báo lỗi
khoá. Có thể chia 2 agent (backend / frontend) theo contract như các lần trước.
