# Quy trình làm việc với Git (Git Workflow)

## 1. Tại sao lại là GitHub Flow?

- **Khớp với CI/CD hiện hành:** File `.github/workflows/deploy.yml` đã được cấu hình để tự động build image và triển khai thẳng lên cụm k3s (homelab) mỗi khi có push hoặc merge vào nhánh `main`. Do đó, nhánh `main` luôn đại diện cho môi trường production.
- **Đơn giản, tốc độ:** Không cần phải duy trì nhánh `develop` hay các nhánh release phức tạp như Gitflow.
- **An toàn:** Bài test và linting được chạy trên Pull Request (PR) qua file `ci.yml`, đảm bảo code không làm hỏng `main`.

## 2. Quy trình làm việc đề xuất (đề xuất áp dụng)

### Bước 1: Tạo nhánh tính năng (Feature branch)

Luôn tách nhánh mới từ nhánh `main`. Không commit trực tiếp lên `main`.

```bash
git checkout main
git pull origin main
# Đặt tên nhánh theo cú pháp: <loại>/<issue-id>-<tên-ngắn-gọn>
git checkout -b feat/123-add-checkin-export
```

Quy ước đặt tên nhánh:

- `feat/...`: Tính năng mới
- `fix/...`: Sửa lỗi (bug)
- `docs/...`: Viết tài liệu
- `refactor/...`: Tái cấu trúc code (không đổi logic)
- `chore/...`: Cập nhật cấu hình, tool (không liên quan code chạy)

### Bước 2: Commit mã nguồn

- Commit thường xuyên, các thay đổi nên nhỏ và có ý nghĩa.
- Nên dùng Conventional Commits để viết thông điệp (log) dễ đọc, khuyến khích viết bằng tiếng Anh:
  - `feat(api): add check-in export feature`
  - `fix(frontend): fix page overflow issue in check-in page`

### Bước 3: Tạo Pull Request (PR)

- Push nhánh tính năng lên GitHub: `git push origin feat/123-add-checkin-export`
- Mở Pull Request vào nhánh `staging`. Nếu kiểm thử ở môi trường staging thành công thì push vào nhánh `main` để được đưa lên môi trường production.
- Khi tạo PR, điền đầy đủ thông tin theo mẫu **Pull Request Template** đã có trong `.github/pull_request_template.md`.
- Gắn thẻ issue liên quan (ví dụ: `Closes #123`) để GitHub tự động đóng issue khi PR được merge.

### Bước 4: CI và review

- Ngay khi tạo PR, GitHub Actions (`ci.yml`) sẽ tự động chạy: kiểm tra Unit test (`pytest`), kiểm tra mã nguồn frontend (`npm run lint`).
- Các Reviewer (hoặc AI Agent) đọc code, góp ý và phê duyệt (Approve).
- **BẮT BUỘC** CI phải vượt qua (pass màu xanh) mới được phép merge.

### Bước 5: Merge vào `main`

- Khuyến nghị sử dụng **Squash and Merge**. Tính năng này sẽ gộp tất cả các commit nháp trong nhánh của bạn thành 1 commit duy nhất gọn gàng khi đưa vào `main`.
- Ngay sau khi merge, file `deploy.yml` sẽ được trigger:
  1. Build Docker image frontend & backend.
  2. Gắn tag bằng mã SHA (7 ký tự).
  3. Đẩy lên GHCR (GitHub Container Registry).
  4. Triển khai lệnh cập nhật tới Kubernetes (k3s).

### Bước 6: Dọn dẹp

- Xóa nhánh tính năng sau khi merge thành công (GitHub có tùy chọn tự động xóa nhánh).
- Ở local, chạy:

```bash
git checkout main
git pull origin main
git branch -d feat/123-add-checkin-export
```

## 3. Xử lý lỗi khẩn cấp (Hotfix)

Khi có lỗi nghiêm trọng trên production:

1. Tạo nhánh hotfix trực tiếp từ `main`: `git checkout -b hotfix/login-crash`
2. Sửa lỗi, test cẩn thận.
3. Tạo PR và ưu tiên review.
4. Merge vào `main`, CD sẽ tự động đẩy bản sửa lỗi lên hệ thống.

## 4. Xử lý rollback (Hạ bản)

Hệ thống Deploy qua Kubernetes đã có chức năng phục hồi bản cũ rất nhanh (chỉ đổi Image Tag):

- Nếu bản `main` vừa deploy gây sập, đừng vội revert code nếu không cần thiết.
- Truy cập vào GitHub Actions -> Workflow **Deploy to k3s** -> Chọn _Run workflow_.
- Nhập short SHA (7 ký tự của lần commit trước đó) vào ô `image_tag` để k3s lấy lại bản cũ.
- Sau khi cụm ổn định lại, thong thả tạo nhánh fix lỗi, đưa qua PR và merge lại vào `main` bình thường.
