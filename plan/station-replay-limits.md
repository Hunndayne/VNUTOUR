# Sửa luồng chơi lại trạm và giới hạn tổng lượt chơi

Trạng thái: **ĐỀ XUẤT — chưa triển khai**. Ngày: 15/09/2026.

## 1. Yêu cầu đã chốt

- Giới hạn cấu hình riêng trong phần setting của từng trạm, tính theo từng đội trong event. Người dùng đã xác nhận vị trí setting này; event chỉ giữ tùy chọn phải đi hết trạm.
- **3 lượt = tổng cộng 3 lượt chơi**, gồm lượt đầu và tối đa 2 lượt chơi lại. Đây là xác nhận của người dùng.
- Khi chưa đạt và còn lượt, đội có thể chơi lại. Đã đạt thì khóa chơi lại.
- Tùy chọn cấp event quyết định có phải đi hết các trạm trước khi chơi lại hay không.
- Tắt tùy chọn đi hết trạm: được chơi lại ngay trạm vừa sai, sau khi kết thúc lượt hiện tại.
- Bật tùy chọn: đi hết trạm xong phải mở lại được những trạm chưa đạt và còn lượt.
- **Giữ nguyên nhãn “Cho phép chơi lại trạm sau khi đã đi hết”** theo yêu cầu người dùng; không đổi tên nhãn khi triển khai.

Tài liệu này cập nhật quyết định “không giới hạn lượt” và “tắt công tắc thì vào lại tự do” trong `plan/qualifying-journey-and-replay.md`.

## 2. Hiện trạng và bước xác minh lỗi

Đã đọc code và test hiện có, sau đó **chạy component frontend thật trong trình duyệt với API giả lập** theo yêu cầu kiểm thử bổ sung. Đã tái hiện một lỗi cập nhật quyền chơi lại và một lỗi thiếu nút khi công tắc tắt; chưa kiểm thử trực tiếp event được báo lỗi, nên chưa kết luận đó là toàn bộ nguyên nhân của event này. Chưa sửa code sản phẩm.

Các điểm đã xác nhận từ code:

1. `station_service.enter_station` chỉ áp dụng cả hai điều kiện “đi hết” và “chưa đạt” khi `SubEvent.replay_after_all=True`. Chưa có giới hạn lượt theo trạm.
2. `/my-team/stations` tính cả bài nộp không có phiên vào tiến độ; `enter_station` chỉ tính `StationSession`. Event có trạm tự do có thể hiển thị đã đi hết nhưng API quét vẫn chặn.
3. `StationRunPage` chỉ hiện nút chơi lại khi `station.replay_locked === false`; backend bỏ field này khi tùy chọn tắt. Luồng tắt tùy chọn vì vậy không có nút chơi lại tương ứng.
4. Polling màn chi tiết chỉ lấy `/my-team/station-state`, chưa cập nhật luật chơi lại từ danh sách. Sau checkout/chấm lại, cờ khóa có thể cũ cho đến khi tải lại danh sách.
5. `score_only` hiện suy outcome thành `passed`, kể cả điểm 0. Vì vậy “trả lời sai” ở form không nhất thiết tương đương “chưa đạt trạm”. Bài nộp còn có `is_correct` riêng cần đồng bộ đúng với chế độ chấm.

Thứ tự giả thuyết cần kiểm chứng khi triển khai:

- **H1 — định nghĩa đã ghé không đồng nhất:** event A quét QR + B tự do, hoàn thành cả hai; nếu danh sách báo đủ mà API vào A trả `replay_locked_incomplete`, xác nhận nhánh lỗi này.
- **H2 — kết quả trạm bị coi là đạt:** nếu lượt trả lời sai có session `passed`, API sẽ trả `replay_locked_passed`; kiểm tra cấu hình chấm và đường cập nhật outcome.
- **H3 — trạng thái giao diện cũ:** API cho vào nhưng nút chơi lại thiếu, hoặc tải lại trang làm nút xuất hiện; kiểm tra dữ liệu polling và màn hoàn tất.

Viết test thất bại cho đúng nhánh tái hiện trước khi sửa. Bộ test hiện có đã mô tả A sai → ghé B → vào lại A, nhưng chưa bao phủ đầy đủ event hỗn hợp và giao diện.

### Kết quả kiểm thử frontend (15/09/2026)

Harness: `frontend/tests/diagnostics/station-replay-harness.mjs`. Chạy từ `frontend` bằng `node tests/diagnostics/station-replay-harness.mjs`, mở `http://127.0.0.1:4178`, bấm **Run frontend checks**.

Dùng `StationRunPage`, React, router và QR thật. Thay API bằng fixture cô lập; các phần trang trí, lịch sử câu hỏi và tổng kết bài nộp được stub. Kiểm tra tương tác/nút/QR trên DOM thật, bao gồm chu kỳ polling 2 giây. Harness không gọi backend thật và không thay đổi dữ liệu event. Chạy 2 lần đều cho cùng kết quả: 5 PASS, 2 FAIL.

| Kịch bản | Kết quả |
|---|---|
| Dữ liệu mới: đã đi hết, A sai, `replay_locked=false` | PASS: có nút chơi lại, bấm mới hiện QR vào |
| Chưa đi hết trạm | PASS: không hiện nút chơi lại |
| Đã đi hết nhưng A đã đạt | PASS: không hiện nút chơi lại |
| Đang mở A với cờ khóa cũ; tiến độ server chuyển sang đã đi hết | FAIL: polling chạy nhưng nút vẫn ẩn, `/my-team/stations` chỉ được gọi lúc đầu |
| Sau tình huống trên, về danh sách rồi mở A | PASS: tải lại quyền và hiện nút chơi lại |
| Luồng một màn hình A → vào B → ra B → về danh sách → mở A | PASS: chơi lại được |
| Tắt công tắc, API không trả `replay_locked` | FAIL: frontend không hiện nút dù backend hiện cho chơi lại |

**Kết luận:** biểu thức `replay_locked === false` hoạt động đúng khi công tắc bật và payload mới, đủ field. Lỗi xác nhận ở nhánh bật công tắc là frontend giữ payload danh sách cũ trong khi chỉ poll session/QR. Có thể xảy ra khi một thành viên giữ màn A còn tiến độ được cập nhật từ thiết bị khác, hoặc sau CTV chấm lại. Luồng quay về danh sách bình thường chưa tái hiện được báo lỗi “không mở các trạm khác”.

**Điều chỉnh ưu tiên sửa:** cập nhật quyền chơi lại cùng trạng thái chi tiết và khi mở lại trạm; tránh sửa điều kiện thành luôn cho chơi lại hoặc chỉ dựa vào `all_visited`, vì vẫn phải khóa trạm đã đạt. Kiểm thử hồi quy cả stale-locked → unlocked và unlocked → passed. Nếu lỗi còn xảy ra sau tải lại danh sách, đối chiếu payload `replay_reason`, outcome/scoring mode và lỗi API trước khi kết luận lỗi frontend.

Giữ harness ở thư mục diagnostics để chạy lại lúc triển khai; hai dòng FAIL là lỗi hiện trạng đã phát hiện, không phải bộ regression đã được sửa xanh.

## 3. Luật nghiệp vụ đề xuất

### Cấu hình

| Nơi cấu hình | Trường | Ý nghĩa |
|---|---|---|
| Event | `replay_after_all` hiện có | Giữ nguyên nhãn “Cho phép chơi lại trạm sau khi đã đi hết” |
| Trạm | `max_attempts` mới | Tổng lượt chơi tối đa; số nguyên ≥ 1; `null` = không giới hạn |

Giao diện ghi **“Tổng số lượt chơi tối đa”**, ví dụ “3 lượt: 1 lượt đầu + tối đa 2 lượt chơi lại”. Không dùng 0 để biểu diễn không giới hạn. `max_attempts=1` nghĩa là chỉ được chơi một lần.

### Bảng quyết định

Các điều kiện về event đang chạy, đội hợp lệ, sức chứa, phiên đang mở và khóa kết quả vẫn được kiểm tra trước khi tạo lượt mới.

| Tình trạng | Đi hết trạm: tắt | Đi hết trạm: bật |
|---|---|---|
| Chưa chơi lần nào | Được chơi lần đầu | Được chơi lần đầu |
| Lượt trước đã đạt | Khóa: đã đạt | Khóa: đã đạt |
| Đã dùng hết lượt | Khóa: hết lượt | Khóa: hết lượt |
| Lượt trước chưa có kết quả | Chờ chấm | Chờ chấm |
| Sai, còn lượt, chưa đi hết | Được chơi lại | Khóa: chưa đi hết |
| Sai, còn lượt, đã đi hết | Được chơi lại | Được chơi lại |

- “Đi hết” là ghé mỗi trạm active có ghi nhận tiến độ ít nhất một lần, không yêu cầu đạt tất cả. Chỉ phải hoàn thành vòng đầu; không bắt đi lại một vòng giữa mỗi lần thử tiếp theo.
- Trạm quét QR: một phiên active/closed hợp lệ là một lượt; phiên cancelled không tính. Đang có phiên thì tiếp tục phiên đó, không tạo lượt mới.
- Bấm nút chơi lại, xem QR, tải lại trang, lưu nháp hoặc nộp lại trong cùng phiên không tiêu hao thêm lượt. Chỉ bắt đầu lượt mới thành công mới tính lượt.
- Phạm vi đếm là đội + trạm + event. Không đặt bộ đếm trên thiết bị hay tài khoản thành viên.
- “Còn lượt” = `max(0, max_attempts - attempts_used)`; không giới hạn trả `null`. Đã đạt vẫn khóa dù còn lượt.
- Trạm inactive không tính vào điều kiện đi hết. Trạm active mới thêm giữa event được tính từ lúc thêm, theo quy tắc hiện tại.

### Kết quả đúng/sai và trạm tự do

- `pass_fail`: kết quả đạt/không đạt do CTV xác nhận; nếu dùng chấm tự động, đồng bộ kết quả cuối cùng về outcome của lượt. Không suy đạt chỉ từ điểm lớn hơn 0.
- `threshold`: đạt khi điểm cuối cùng ≥ ngưỡng; form nhiều câu có câu sai nhưng đủ ngưỡng vẫn là đạt. Chờ chấm không được coi là sai.
- `score_only`: không có tiêu chí đúng/sai. Đề xuất giữ cơ chế điểm hiện tại; muốn áp dụng “sai được thử tiếp, đúng thì dừng” thì admin chuyển sang đạt/không đạt hoặc đặt ngưỡng. UI phải giải thích vì sao một trạm score_only đang được hệ thống coi là đã hoàn thành; không tự chuyển mode của trạm cũ.
- Trạm tự do có form: bài nộp đã gửi/chấm là bằng chứng đã ghé; draft không tính. Dùng cùng định nghĩa này ở danh sách và API vào trạm.
- Muốn áp dụng giới hạn và chơi lại ngay trên trạm tự do có form, cần một lượt có định danh riêng: đề xuất tái dùng `StationSession`, tạo lượt qua thao tác “Bắt đầu/Chơi lại” không cần QR, gắn bài nộp vào lượt và đóng lượt theo quy tắc nộp bài. Mọi đường mở/nộp form phải kiểm tra lượt này. Không đếm số request nộp bài.
- Trạm tự do không có form và không có thao tác ghi nhận hoàn thành không được trở thành điều kiện bất khả thi của “đi hết”. Đề xuất loại khỏi tập trạm bắt buộc và ghi rõ trong phần tiến độ/cấu hình.

## 4. Thiết kế triển khai

### A. Backend và dữ liệu

1. Thêm `Station.max_attempts` nullable cùng validation ở API và ràng buộc DB. Migration mặc định `null` để không tự gán giới hạn cho trạm cũ.
2. Gom cách xác định tập trạm bắt buộc, đã ghé, kết quả đạt, lượt đã dùng và quyền chơi lại vào một service dùng chung. Loại cancelled nhất quán khỏi lượt, kết quả và tiến độ.
3. Tách điều kiện đã đạt/giới hạn lượt khỏi `replay_after_all`. Công tắc chỉ kiểm soát điều kiện đi hết.
4. Dùng cùng service tại `enter_station`, đường bắt đầu lượt tự do, `/my-team/stations` và `/my-team/station-state`. Trả dữ liệu theo lô khi dựng danh sách để tránh query lặp theo từng trạm.
5. Kiểm tra quyền và số lượt trong transaction, dưới cùng cơ chế khóa dùng để tạo lượt; giữ constraint một phiên active. Quy định thứ tự khóa thống nhất với checkout/chấm/hủy để hai máy quét không vượt giới hạn hoặc đọc kết quả lỗi thời.
6. Mỗi lượt mới có session/bài nộp riêng; không ghi đè lịch sử lượt cũ. Giữ cơ chế điểm tốt nhất mỗi trạm, không cộng dồn khi chơi lại.
7. Kiểm tra việc đồng bộ chấm tự động, CTV chấm bài, chấm phiên và checkout; trạng thái chờ chấm phải được phân biệt với sai.

### B. Hợp đồng API

Danh sách và trạng thái chi tiết luôn trả quyền chơi lại, kể cả khi `replay_after_all=false`:

```text
attempts_used: integer
max_attempts: integer | null
attempts_remaining: integer | null
can_replay: boolean
replay_reason: null | passed | attempts_exhausted | pending_result | incomplete
```

`can_replay` nói về quyền tạo lượt tiếp theo; các rào cản tạm thời như đang ở trạm khác, hết sức chứa hoặc event đóng vẫn có trạng thái riêng và luôn kiểm tra lại khi bắt đầu lượt. Lần đầu dùng luồng bắt đầu thông thường.

- Summary giữ `all_visited`, số trạm đã ghé/tổng trạm; thêm/đọc rõ `replay_after_all`, tránh hiểu `replay_enabled=false` là tắt mọi hình thức chơi lại.
- Giữ field cũ `replay_locked`/`replay_reason` trong giai đoạn chuyển đổi, thống nhất giá trị giữa hai endpoint.
- Giữ lỗi `replay_locked_passed`, `replay_locked_incomplete`; thêm `replay_locked_attempts_exhausted`, `replay_locked_pending_result`, ánh xạ HTTP 409 ở mọi đường bắt đầu lượt.
- Khi có nhiều lý do khóa, ưu tiên: đã đạt → hết lượt → chờ chấm → chưa đi hết.

### C. Frontend

- `StationsPage`: thêm ô giới hạn theo trạm, chọn không giới hạn, mô tả tổng số lượt và liên hệ chế độ đạt/không đạt.
- `EventManagementPage`: giữ nguyên nhãn “Cho phép chơi lại trạm sau khi đã đi hết”; chỉ bổ sung giải thích nếu cần làm rõ quan hệ với giới hạn lượt. Cập nhật các bước đọc, sửa, lưu ở `AdminDashboard`/`api.js` khi cần.
- `StationRunPage`: dùng quyền từ API, hiển thị “Đã chơi 1/3 lượt”, “Còn 2 lượt”; màn kết thúc phân biệt chưa đạt, đã đạt, chờ chấm và hết lượt.
- Hiển thị nút “Chơi lại” khi đủ điều kiện. Đội chủ động bấm rồi mới hiện QR vào hoặc mở lượt tự do. Không tự hiện QR vào ngay sau checkout.
- Polling chi tiết cập nhật cả quyền chơi lại; danh sách cập nhật khi trở lại, checkout/chấm xong và khi cấu hình thay đổi. Chặn response cũ cập nhật nhầm trạm/event đang chọn.
- Đã đi đủ trạm thì các trạm sai/còn lượt có thể mở lại mà không tải lại trang. Trạm đang có phiên ở nơi khác vẫn báo đang bận trước khi hiện QR vào.
- `CoopDashboard`: thông báo rõ đã đạt, hết lượt, chờ chấm hoặc chưa đi hết; phản hồi có số lượt để CTV giải thích được cho đội.

## 5. Dữ liệu cũ và chuyển đổi

- Đếm các phiên hợp lệ đã có; không reset lịch sử khi triển khai hoặc khi sửa giới hạn. Đội đã dùng 4 lượt mà admin đặt giới hạn 3 vẫn giữ lịch sử, còn 0 lượt và bị chặn lượt mới.
- Phiên đang chơi được hoàn tất ngay cả khi admin hạ giới hạn; chỉ chặn lượt tiếp theo.
- `max_attempts=null` giữ không giới hạn về số lượng. Tuy nhiên, việc luôn khóa trạm đã đạt khi tắt `replay_after_all` là thay đổi hành vi có chủ đích theo yêu cầu mới; phải ghi trong hướng dẫn phát hành.
- Bài nộp tự do cũ không có session: quy đổi mỗi trạm/đội đã nộp thành một lượt lịch sử để khớp hành vi một bài hiện tại. Kiểm tra khả năng truy vết trước khi backfill; không đoán số lần nộp đã bị ghi đè. Chỉ tính điểm một lần khi gắn lại session.
- Trạm `score_only` cũ có thể đã được ghi `passed` ngay cả khi trả lời sai. Không tự sửa lịch sử từ điểm 0; cần rà cấu hình/kết quả ở event gặp lỗi và đưa danh sách cần admin chấm lại nếu có.

## 6. Kiểm thử và nghiệm thu

1. A giới hạn 3, tắt đi hết: sai lượt 1 → chơi lượt 2 ngay; sai tiếp → lượt 3; sai lượt 3 → chặn lượt 4.
2. A đạt ở lượt 1 hoặc 2 → khóa ngay, dù còn lượt và bất kể công tắc đi hết.
3. Bật đi hết: sai A, chưa ghé B → khóa; ghé B và kết thúc lượt → mở A nếu còn lượt. Lặp cho event nhiều trạm.
4. Event trộn quét QR và trạm tự do: tiến độ trên UI và kết quả quét thống nhất; draft/cancelled không làm sai tiến độ.
5. Giới hạn 1, không giới hạn, dữ liệu giới hạn không hợp lệ, hạ/nâng giới hạn khi đang chơi.
6. Chờ CTV chấm, chấm lại sai thành đạt/đạt thành sai; quyền và số lượt phản ánh kết quả hợp lệ hiện tại.
7. Hai request bắt đầu cùng lúc ở lượt cuối: chỉ một lượt được tạo; quét lại QR hoặc tải lại trang không tốn thêm lượt. Kiểm thử transaction trên PostgreSQL.
8. Lượt mới mở đúng form mới, không mang bài nộp/QR/kết quả cũ; lưu nháp và nộp lại trong lượt không tạo lượt mới.
9. Chuyển trạm/event, checkout trạm cuối, đổi cấu hình và chấm xong: UI cập nhật quyền; màn hoàn tất vẫn cần bấm chơi lại chủ động.
10. Điểm trạm vẫn lấy kết quả tốt nhất; lịch sử câu hỏi, quyền xem đáp án, sức chứa, QR, đội/event và khóa kết quả không bị hồi quy.

Mở rộng các test hiện có: `test_station_journey_replay`, `test_participant_station_state_api`, `test_station_scan_api`, `test_station_session_api`, `test_station_session_score_api`, `test_station_answer_review` và các test form liên quan. Thêm test trạng thái UI có kiểm tra hành vi, rồi chạy build/lint phần frontend thay đổi và kiểm tra luồng thực tế.

## 7. Thứ tự thực hiện

1. Tái hiện lỗi báo cáo bằng test, chốt nguồn kết quả đạt/sai và quy tắc tiến độ dùng chung.
2. Sửa lệch tiến độ/quyền chơi lại, bổ sung cập nhật UI và test hồi quy lỗi hiện tại.
3. Thêm giới hạn, transaction, API thống nhất, lượt tự do và chuyển đổi dữ liệu cần thiết.
4. Hoàn thiện cấu hình admin, thông báo thí sinh/CTV và kiểm thử toàn bộ các tình huống nghiệm thu.

Điểm cần rà kỹ nhất là kết quả `score_only`, lượt tự do và lịch sử điểm. Chỉ hoàn tất triển khai khi cả API quét và UI đồng ý về quyền chơi lại cho cùng một đội/trạm.
