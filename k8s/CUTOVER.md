# Checklist chuyển production sang k3s

Đi từ trên xuống. Ba mốc **DỪNG** là điểm quyết định đi tiếp hay huỷ — đừng bỏ qua.

Kèm theo: `README.md` (điều kiện cụm + thứ tự apply), `backend/DOCKER.md` (stack Compose hiện tại).

---

## A. Trước ngày cutover — không ảnh hưởng production

### A1. Bịt rò rỉ

- [ ] Reset `DISCORD_TOKEN` trong Discord Developer Portal
- [ ] Cập nhật token mới vào `/srv/vnutour/.env.docker` trên homelab
- [ ] Restart bot trên Compose, xác nhận bot online trở lại
- [ ] Kiểm tra repo `Hunndayne/VNUTOUR` là public hay private
- [ ] Nếu public: rà audit log của bot xem có hành vi lạ trong thời gian token bị lộ

> Token cũ nằm trong git từ commit đầu tiên. Xoá file khỏi tracking không thu hồi được nó.

### A2. Image

- [ ] Chốt registry (GHCR: `ghcr.io/hunndayne/vnutour-backend` và `-frontend`)
- [ ] Thay `yourdockerhub/` ở **5 chỗ**: `05.migrate-job`, `06.backend`, `07.bot`, `08.email-worker`, `09.frontend`
- [ ] Đổi tag `1.0.0` sang git SHA — tag cố định thì node không kéo image mới
- [ ] Build và push cả hai image
- [ ] Frontend build phải truyền `VITE_GOOGLE_CLIENT_ID` làm build-arg (Vite nhúng lúc build, đặt trong ConfigMap không có tác dụng)
- [ ] `docker pull` thử từ một máy khác để chắc registry cho phép kéo

### A3. Đường vào tài khoản quản trị

- [ ] Đăng nhập production hiện tại bằng tài khoản `hunn`
- [ ] Nếu mật khẩu vẫn là mặc định cũ → **đổi ngay trên Compose, trước khi dump**

> Migration 0024 vô hiệu hoá `hunn` nếu mật khẩu còn là mặc định. `Account` không phải `AUTH_USER_MODEL` nên `createsuperuser` không dùng được — mất đường vào là phải mở `manage.py shell`.

### A4. Khoảng trống backup

- [ ] Viết CronJob backup cho k8s (`backup_db.sh` dùng `docker compose exec`, không chạy trên k8s)
- [ ] Test restore thử từ một dump vào DB rác — bản backup chưa từng restore không phải backup

> Từ lúc cutover tới lúc có CronJob là khoảng thời gian **không có bản sao lưu nào**.

### A5. Dựng cụm

Ba VM, IP tĩnh **ngoài dải DHCP** (`.110`/`.111`/`.112`) — đừng lặp lại vụ trùng IP đã ngốn một đêm truy vết.

| VM | vCPU | RAM | Disk |
|---|---|---|---|
| `vnutour-cp` | 2 | 3 GB | 40 GB |
| `vnutour-w1` | 2 | 4 GB | 80 GB |
| `vnutour-w2` | 2 | 6 GB | 40 GB |

- [ ] Tạo `vnutour-cp` và `vnutour-w1`. **Chưa tạo/chưa bật `w2`**
- [ ] `curl -sfL https://get.k3s.io | sh -s - server --disable=traefik --disable=servicelb --node-ip 192.168.1.110`
- [ ] Lưu `/var/lib/rancher/k3s/server/node-token` ra chỗ an toàn
- [ ] Join `w1`, `kubectl get nodes` thấy 2 node `Ready`
- [ ] `kubectl label node vnutour-w1 vnutour/storage=true` — thiếu label là postgres và backend nằm `Pending` mãi
- [ ] Cài ingress-nginx kèm `--set controller.config.use-forwarded-headers=true`
- [ ] `kubectl get ingressclass` thấy `nginx`, không thấy `traefik`

> `w2` chỉ dựng **sau khi** phần B chạy xong. PVC bám vào node mà pod lần đầu được xếp lên — `w2` bật lúc apply lần đầu là database có thể bám vào đúng cái node bị tắt mỗi đêm.

### A6. DNS và tunnel

- [ ] `vnutour.hunn.io.vn` và `vnutour.suctremmt.com` đều trỏ đúng
- [ ] Tạo Cloudflare Tunnel mới cho k8s, **chưa gắn hostname** — chỉ dựng sẵn

---

## B. Dựng app, chưa nhận traffic

> Chạy toàn bộ phần này khi **`w2` chưa tồn tại**. Đây là lúc PVC chọn node ở lại vĩnh viễn.

- [ ] `kubectl apply -f k8s/00.namespace.yaml`
- [ ] Tạo secret từ file ngoài repo — **không apply `02.secret.yaml`**:
      `kubectl -n vnutour create secret generic backend-secret --from-env-file=/srv/vnutour/.env.docker`
- [ ] `kubectl apply -f k8s/01.configmap.yaml -f k8s/03.storage.yaml`
- [ ] `kubectl apply -f k8s/04.postgres.yaml`
- [ ] `kubectl -n vnutour rollout status statefulset/postgres`
- [ ] Dump từ Compose: `bash backend/scripts/backup_db.sh`
- [ ] Restore vào k8s **trước khi migrate**:
      `kubectl -n vnutour exec -i statefulset/postgres -- pg_restore --username vnutour --dbname vnutour --no-owner --clean --if-exists < backups/vnutour-XXXX.dump`
- [ ] `kubectl -n vnutour delete job vnutour-migrate --ignore-not-found`
- [ ] `kubectl apply -f k8s/05.migrate-job.yaml`
- [ ] `kubectl -n vnutour wait --for=condition=complete job/vnutour-migrate --timeout=300s`
- [ ] `kubectl apply -f k8s/06.backend.yaml -f k8s/09.frontend.yaml -f k8s/10.ingress.yaml`
- [ ] **Chưa bật `07.bot.yaml` và `08.email-worker.yaml`**

> Bot chạy song song hai nơi là mỗi lệnh xử lý hai lần. `strategy: Recreate` chỉ bảo vệ trong nội bộ k8s, nó không biết gì về Compose.

---

## DỪNG 1 — kiểm tra trước khi cắt traffic

Chưa ai bị ảnh hưởng ở bước này. Sai thì sửa thoải mái.

- [ ] Mọi pod `Running`, không cái nào `CrashLoopBackOff`
- [ ] `kubectl -n vnutour get pod -o wide` — postgres và backend đều nằm trên `w1`
- [ ] `kubectl get pv -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values` — cả 3 PV đều gắn `w1`
- [ ] `kubectl -n vnutour port-forward svc/frontend 8080:80`
- [ ] `curl localhost:8080/healthz` → `ok`
- [ ] `curl localhost:8080/api/health` → `{"status":"ok"}`, **không phải 301**
- [ ] Mở `localhost:8080`, đăng nhập được bằng tài khoản admin
- [ ] Mở một trang có dữ liệu thật (danh sách đội, điểm), đối chiếu với Compose
- [ ] `kubectl -n vnutour logs deploy/backend | grep -i error` sạch

**Không qua được mục nào → dừng, sửa xong mới đi tiếp. Chưa mất gì cả.**

---

## C. Cutover — có downtime

Thứ tự trong phần này quan trọng hơn mọi phần khác.

- [ ] Báo trước cho ban tổ chức về cửa sổ downtime
- [ ] Dừng ghi ở Compose (từ `backend/`, giữ nguyên biến môi trường như `deploy.yml`):
      `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml docker compose --env-file /srv/vnutour/.env.docker stop bot email-worker backend`
- [ ] Xác nhận bot đã offline trên Discord
- [ ] Dump lần cuối: `bash backend/scripts/backup_db.sh`
- [ ] Restore lại vào k8s (cùng lệnh `pg_restore` ở phần B)
- [ ] Chạy lại migrate job (delete → apply → wait)
- [ ] `kubectl -n vnutour rollout restart deploy/backend`, chờ Ready
- [ ] `kubectl apply -f k8s/07.bot.yaml -f k8s/08.email-worker.yaml`
- [ ] Bot online trở lại trên Discord, thử một slash command — **chạy đúng một lần**
- [ ] Chuyển route Cloudflare Tunnel sang `http://ingress-nginx-controller.ingress-nginx.svc`
- [ ] Tắt tunnel cũ của Compose

---

## DỪNG 2 — kiểm tra từ ngoài internet

- [ ] `https://vnutour.hunn.io.vn` mở được, không cảnh báo cert
- [ ] `https://vnutour.suctremmt.com` mở được
- [ ] Đăng nhập được từ máy ngoài mạng nhà
- [ ] Quét thử một QR điểm danh, ghi nhận đúng
- [ ] Gửi thử một email (đăng ký hoặc duyệt đội), nhận được
- [ ] Bot phản hồi slash command, **không lặp**
- [ ] Upload thử một file bài nộp, tải lại được

**Không qua được → rollback ngay, đừng cố sửa tại chỗ khi đang có người dùng.**

---

## Rollback

- [ ] Chuyển route Cloudflare Tunnel về Compose
- [ ] `kubectl -n vnutour scale deploy/bot deploy/email-worker deploy/backend --replicas=0`
- [ ] `docker compose start backend bot email-worker`
- [ ] Xác nhận bot online và chỉ một bản chạy

> Dữ liệu phát sinh trên k8s trong khoảng thời gian đã cắt traffic sẽ mất khi rollback. Cửa sổ càng ngắn càng ít rủi ro.

---

## D. Sau cutover

- [ ] **Giữ nguyên Compose stack vài ngày**, đừng xoá — đó là đường lui duy nhất
- [ ] Bật CronJob backup, chờ chạy một lần, **restore thử bản đầu tiên**
- [ ] Dựng `vnutour-w2` (2 vCPU / 6 GB), join vào cụm
- [ ] Xác nhận không PVC nào bám sang `w2`
- [ ] Chạy thử một chu kỳ tắt/bật `w2` bằng `drain` + `uncordon` vào giờ vắng, xem app có chịu được không
- [ ] Chạy được 1 tuần ổn định mới tính tới GitOps

**Monitoring (`11`–`15`) hoãn lại.** Không vừa control plane 3 GB: k3s server + OS + ingress + cloudflared đã ăn ~1.8 GB, riêng Prometheus xin 512Mi và phình tới 2 GB. Chỉ apply khi đã nâng control plane lên 6 GB, hoặc chấp nhận đặt Prometheus trên `w2` (mất dữ liệu quan trắc mỗi đêm). Khi apply thì nhớ:

- [ ] Đổi mật khẩu admin Grafana khỏi `change-me`
- [ ] Kiểm tra Prometheus thấy đủ target
- [ ] Xác nhận `pg_stat_activity_count` có thật trong `:9187/metrics` — tên metric đổi theo version exporter

> Khi thêm Argo CD: phải khai `ignoreDifferences` cho `/spec/replicas` trên các Deployment được autoscale, nếu không Argo sẽ giằng co với HPA/RL controller đúng như sự cố HPA trước đây.
