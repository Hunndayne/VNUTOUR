# Kết quả, lịch sử câu hỏi và checkout tại trạm

## Hành vi

- Màn hoàn thành hiển thị số câu đúng trên số câu có đáp án chấm tự động, cùng điểm đã được ghi nhận. Câu tự luận không có đáp án mẫu cần coop chấm.
- Tab **Lịch sử câu hỏi** ở màn chạy trạm giữ riêng từng lượt nộp của đội, kể cả khi chuyển sự kiện. Chỉ thành viên đội đọc được lịch sử của đội mình.
- Câu hỏi, câu trả lời, đáp án và giải thích được chụp lại ở server khi nộp bài. Sửa hoặc gỡ bộ câu hỏi về sau không sửa bản lưu này. Bài nộp trước tính năng này vẫn có tổng kết nếu đã lưu `quiz_result`, nhưng không có bản đối chiếu chi tiết.
- Đáp án/giải thích không nằm trong cấu hình form gửi cho thí sinh. Với trạm có giờ đóng hoặc thời lượng, lịch sử chỉ mở sau hạn làm bài (lấy mốc sớm hơn) cộng 15 giây nhận bài tự động, ngay cả khi checkout sớm. Mốc này được lưu cùng bài nộp.
- Trạm không có hạn giờ mở giải thích khi checkout; trạm tự do hoặc không yêu cầu checkout mở sau khi nộp. Khi đã mở đáp án, lượt đó không nhận nộp lại (`attempt_finished`). Lượt chơi lại có phiên mới và bài nộp riêng. Trước hạn giờ, cơ chế nộp lại và cập nhật điểm tự động vẫn hoạt động.
- Coop quét QR checkout hoặc cho đội ra trạm thủ công sẽ nhận đúng bài nộp thuộc phiên vừa đóng. Màn hình chuyển sang đối chiếu đáp án, giải thích và chấm điểm; máy quét tạm bỏ qua mã mới đến khi bấm **Quét đội tiếp theo**.
- Một trạm vẫn nhận nhiều đội đồng thời theo sức chứa cấu hình. Checkout/chấm điểm chỉ tác động một phiên của một đội. Tạm dừng quét là trạng thái của thiết bị coop đang chấm, không khóa trạm và không dừng các đội hay thiết bị coop khác; checkout giải phóng một chỗ cho đội tiếp theo.
- Chế độ điểm số cho nhập điểm, dùng điểm tự chấm, cho đủ điểm hoặc 0 điểm. Chế độ đạt/không đạt dùng số điểm cấu hình của trạm. Điểm lưu từ coop đồng bộ về phiên, bài nộp và cơ chế tổng hợp điểm tốt nhất hiện có.

## Nhập câu hỏi

- Ngân hàng chung và câu hỏi của trạm có lựa chọn **Thay bộ hiện tại** hoặc **Thêm vào bộ hiện tại**, cùng nút **Gỡ bộ câu hỏi**. Thao tác gỡ/thay có xác nhận trong giao diện.
- Excel hỗ trợ cột `Explanation` hoặc `Giải thích`; JSON dùng `explanation`. Xuất Excel/JSON và file mẫu đều hỗ trợ trường này.
- Trạm giữ mục tải tệp khi thay/gỡ các câu hỏi trực tiếp; cấu hình lấy câu hỏi từ ngân hàng chung vẫn giữ nguyên. Phải **Lưu trạm** để áp dụng chỉnh sửa tại trang trạm.
- Thay ngân hàng chung được thực hiện trong transaction sau khi kiểm tra đầu vào. Những trạm dùng toàn ngân hàng tự lấy bộ mới; những trạm chọn ID câu riêng cần chọn lại sau khi gỡ/thay ngân hàng.

## API và triển khai

- `GET /api/my-team/question-history`: tổng kết các lượt nộp và `review` với `available`, `available_at`, `items` (rỗng khi chưa mở).
- `GET /api/my-team/station-state`: thêm `submission.quiz_result`, `submission.score`, không trả bản đối chiếu chi tiết.
- `POST /api/station-scan` khi checkout và `POST /api/station-sessions/exit`: thêm `submission`, chỉ thuộc phiên vừa đóng.
- `POST /api/program/sub-events/:id/question-bank`: nhận `mode: append | replace`, mặc định `append` cho client cũ.
- `DELETE /api/program/sub-events/:id/question-bank`: gỡ bộ câu hỏi và dọn các ID tham chiếu trong cấu hình trạm của sự kiện.
- Cần chạy `python webapi/manage.py migrate` từ thư mục backend để áp dụng migration `0050_questionbankitem_explanation`, rồi cập nhật backend và frontend cùng nhau.

## Kiểm tra

Kiểm thử API nằm trong `backend/webapi/api/tests/test_station_answer_review.py`: không lộ đáp án sớm, hạn thời gian, bản lưu chống sửa giả, lịch sử riêng từng đội, phân quyền coop, đồng bộ điểm và thay ngân hàng hợp lệ/không hợp lệ. Bộ kiểm thử các luồng form, chơi lại, quét và chấm điểm hiện có cũng được chạy cùng.
