# Plan: Môi trường Staging (`vnutour.hunn.io.vn`)

## Mục tiêu
Biến `vnutour.hunn.io.vn` từ alias của prod thành **môi trường staging độc lập**, deploy tự động từ một nhánh riêng (`staging`), để test tính năng trước khi merge vào `main` (prod = `vnutour.suctremmt.com`).

## Hiện trạng
- `k8s/10.ingress.yaml`: cả `hunn.io.vn` và `suctremmt.com` cùng route về namespace `vnutour` (frontend service). → hunn.io.vn hiện chỉ là alias prod.
- CI/CD: GHCR + self-hosted runner trên node `cp`, k3s.
  - `ci.yml`: push `main` → test + lint + build → push image `ghcr.io/hunndayne/vnutour-{backend,frontend}:<sha7>` + `:latest`.
  - `deploy.yml`: sau CI success trên `main` → migrate + `kubectl set image` vào namespace `vnutour`.
- Frontend serve **same-origin** (nginx proxy `/api`, `/media`). → **1 image frontend dùng chung được cả prod và staging** (không cần build riêng theo domain).
- `VITE_GOOGLE_CLIENT_ID` bake lúc build; `VITE_API_BASE_URL` relative → không phụ thuộc domain.

## Quyết định (chốt)
- **Tách hoàn toàn** state giữa prod và staging, không chia sẻ gì (Postgres riêng, PVC riêng, secret riêng).
- Staging **tối giản**: chỉ `postgres + backend + frontend + ingress`. **Bỏ Discord bot, email-worker, monitoring, backup** — chỉ test phần core (đăng ký, đăng nhập, check-in, chấm điểm, form...).
- Staging chạy **cùng cluster k3s**, **namespace riêng `vnutour-staging`**.

| Hạng mục | Prod (`vnutour`) | Staging (`vnutour-staging`) |
|---|---|---|
| Domain | vnutour.suctremmt.com | vnutour.hunn.io.vn |
| Postgres | pod `postgres` + PVC prod | **pod postgres + PVC riêng** |
| Backend / Frontend | có | có (replicas=1) |
| Discord bot | có | **KHÔNG** |
| email-worker | có | **KHÔNG** (đăng ký/mail: tắt gửi hoặc để lỗi im lặng) |
| monitoring / backup | có | **KHÔNG** |
| R2 | bucket prod | **prefix/bucket riêng** (nếu core cần upload); nếu không thì để trống |
| Google OAuth | client id prod | thêm `hunn.io.vn` vào Authorized origins (dùng chung client id) |

### Ảnh hưởng của việc bỏ email-worker
`register`/mời thành viên có thể enqueue email. Không có worker thì mail chỉ tồn trong queue (không gửi) — chấp nhận được cho staging. Cần đảm bảo backend **không block** khi enqueue thất bại (kiểm tra `email_service.py`).

## Việc cần làm

### 1. Gỡ hunn.io.vn khỏi ingress prod
`k8s/10.ingress.yaml`: bỏ host + tls entry `vnutour.hunn.io.vn`, chỉ giữ `suctremmt.com`.
`k8s/01.configmap.yaml`: bỏ `vnutour.hunn.io.vn` khỏi `DJANGO_ALLOWED_HOSTS` của prod.

### 2. Tạo bộ manifest staging (`k8s/staging/`)
Chỉ gồm các file core (bỏ bot 07, email-worker 08, monitoring 11–15, backup 16):
- `00.namespace`: `vnutour-staging`.
- `01.configmap`: `DJANGO_ALLOWED_HOSTS=vnutour.hunn.io.vn,localhost,127.0.0.1`; `WEB_BASE_URL=https://vnutour.hunn.io.vn`; Discord fields để trống.
- `02.secret`: DB password riêng, SECRET_KEY riêng, R2 riêng (nếu cần). **Không commit** — tạo bằng `kubectl create secret`.
- `03.storage` + `04.postgres`: PVC + pod postgres **riêng** cho staging.
- `05.migrate-job`: migrate + seed_phases cho DB staging.
- `06.backend` (replicas=1), `09.frontend` (replicas=1).
- `10.ingress`: chỉ host `vnutour.hunn.io.vn`; secret `vnutour-tls` (dùng chung Origin Cert nếu SAN đã phủ, xem mục Rủi ro #2).
- **Tài nguyên** (cp ~2GB): requests/limits nhỏ; không có bot/monitoring nên tải thêm chủ yếu là 1 postgres + 1 backend + 1 frontend.

### 3. CI: build image cho nhánh staging
Sửa `ci.yml`:
- `build-push` hiện chỉ chạy khi `push` + `main`. Mở rộng cho nhánh `staging` (tag `:<sha7>` + `:staging` thay vì `:latest`).
- Test/lint vẫn chạy cho mọi nhánh/PR như cũ.

### 4. Deploy workflow cho staging
Thêm `deploy-staging.yml` (hoặc mở rộng `deploy.yml`):
- Trigger: `workflow_run` CI hoàn tất trên nhánh `staging`.
- `NS=vnutour-staging`, apply `k8s/staging/05.migrate-job` rồi `set image` cho backend/bot/email-worker/frontend.
- Concurrency group riêng (`deploy-k3s-staging`) để không đụng deploy prod.

### 5. Luồng làm việc
```
feature/*  ──PR──►  staging  ──auto-deploy──►  vnutour.hunn.io.vn  (QA)
                       │
                    QA ổn
                       │
                       └──merge──►  main  ──auto-deploy──►  vnutour.suctremmt.com (prod)
```

## Rủi ro / cần xác nhận trước khi build
1. **RAM node cp (~2GB)**: staging thêm 1 Postgres + 1 backend + 1 frontend (không bot/monitoring). Đặt requests/limits nhỏ; theo dõi `kubectl top nodes`.
2. **Origin Certificate**: kiểm tra SAN của cert hiện tại:
   ```bash
   kubectl -n vnutour get secret vnutour-tls -o jsonpath='{.data.tls\.crt}' \
     | base64 -d | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
   ```
   Có `DNS:vnutour.hunn.io.vn` → dùng chung cert (tạo secret `vnutour-tls` giống hệt trong ns staging). Không có → tạo Origin Cert mới ở Cloudflare phủ hunn.io.vn/`*.hunn.io.vn`.

## Thứ tự triển khai đề xuất
1. Xác nhận 4 điểm rủi ro ở trên (đặc biệt RAM + Origin Cert + Discord).
2. Manifest `k8s/staging/` + gỡ hunn.io.vn khỏi prod ingress/configmap.
3. Tạo secret staging trên cluster (thủ công, không commit).
4. Sửa `ci.yml` build cho nhánh `staging` + thêm `deploy-staging.yml`.
5. Tạo nhánh `staging` từ `main`, push thử, verify `https://vnutour.hunn.io.vn`.
