# Hạ tầng vận hành và DevOps (VNUTOUR)

Tài liệu để phân tích kiến trúc hạ tầng, quy trình triển khai (DevOps) và các thành phần hệ thống của dự án VNUTOUR.

## 1. Mục tiêu (Goal)

- "Hiểu rõ cách ứng dụng VNUTOUR được đóng gói, triển khai, vận hành và giám sát trên cụm Kubernetes (k3s) tự quản lý (homelab), cũng như luồng CI/CD từ GitHub xuống Server."

## 2. Bản đồ kiến trúc (C4 Model - Level 2 và 3)

### Level 2: Containers và môi trường triển khai

Hệ thống không chạy trên Cloud công cộng (như AWS, GCP) mà chạy trên một cụm máy chủ tự quản lý (Homelab Proxmox) với k3s.
Cloudflare đóng vai trò làm Edge Gateway bảo vệ hệ thống.

### Level 3: Các thành phần (Components)

- **Control Plane (`cp`)**: Chạy ingress-nginx, Prometheus, Github Runner. Đặc biệt chứa `host-firewall.nft` để chặn mọi traffic không đến từ Cloudflare.
- **Worker 1 (`w1`)**: Gắn nhãn `vnutour/storage=true`. Chứa toàn bộ khối lượng công việc stateful: Postgres, Backend (chứa media/backups volume), Frontend, Bot, Worker, Grafana.
- **Lưu trữ**: `local-path` provisioner ghim chặt dữ liệu DB vào `w1`.
- **Database**: PostgreSQL dạng StatefulSet (đơn node).

## 3. Phân tích luồng thực thi và vận hành

### 3.1 Luồng CI/CD (GitHub Actions)

Thay vì pull tự động (GitOps), dự án dùng mô hình Push qua Self-hosted Runner.

1. **CI (`.github/workflows/ci.yml`)**: Chạy test/lint khi có PR. Nếu push vào `main`, tự động build image (Backend/Frontend) và push lên **GHCR** (GitHub Container Registry) với tag là short SHA commit.
2. **CD (`.github/workflows/deploy.yml`)**:
   - Runner (chạy trực tiếp trên node `cp` trong LAN) nhận trigger.
   - Kéo manifest `05.migrate-job.yaml`, thay đổi tag image và chạy job migration (`migrate` + `seed_phases`). Đợi job hoàn thành.
   - Thực thi `kubectl set image` cập nhật image mới cho 4 thành phần: Backend, Frontend, Bot, Email Worker.
   - `rollout status` đợi Backend và Frontend Ready.
   - _Lưu ý:_ Bot không có readiness probe, nếu `DISCORD_TOKEN` sai bot sẽ CrashLoopBackOff nhưng không làm tịt pipeline CD.

### 3.2 Luồng request (Ingress và TLS)

1. User gọi `https://vnutour...`
2. **Cloudflare** nhận request, lo phần SSL/TLS phía người dùng. Do cấu hình **Flexible**, nó chuyển tiếp request gốc đến IP public của Router qua port 80 (chữ thường).
3. Router trỏ thẳng 192.168.1.110 (DMZ).
4. Cấu hình **nftables** (`host-firewall.nft`) trên `cp` kiểm tra IP nguồn. Chỉ cho phép các dải IP của Cloudflare được qua. Nếu hợp lệ, chuyển tiếp vào `ingress-nginx`.
5. `ingress-nginx` (với cấu hình `use-forwarded-headers=true`) nhận trust header từ CF, hiểu rằng request gốc là HTTPS và chuyển tới Frontend hoặc Backend qua Service k8s.

### 3.3 Luồng sao lưu và phục hồi (Backup)

1. **CronJob** `16.backup-cronjob.yaml` kích hoạt lúc 03:00 hàng ngày.
2. Gọi thẳng hàm `create_backup(prefix='cron')` của Django (thay vì `pg_dump` thuần).
3. Zip file được tạo, giữ lại 14 bản nội bộ trên ổ đĩa của `w1`.
4. Gọi script `scripts/upload_backup.py` đưa bản zip này lên **Cloudflare R2** bucket `vnutour` prefix `db-backups/`.
5. Khi có sự cố, Admin dùng chức năng khôi phục hoặc admin script tải zip từ R2 về và chạy hàm `restore_backup()` (xóa DB cũ, nạp DB mới).

## 4. Thuật ngữ và cấu hình đặc thù (Terminology)

- **k3s**: Bản phân phối Kubernetes nhẹ từ Rancher, dùng cho homelab. Mặc định k3s cài Traefik, nhưng dự án đã `--disable-traefik` để dùng `ingress-nginx`.
- **`host-firewall.nft`**: Tường lửa tầng host. Chặn mọi thứ không đến từ Cloudflare. Chạy tách biệt bảng (`inet vnutour_fw`) so với k3s iptables để tránh conflict mạng container.
- **Flexible TLS (Cloudflare)**: Chế độ SSL mà CF giao tiếp với Origin (homelab) qua HTTP (cổng 80) không mã hóa. Hiện trạng hệ thống đang dùng tạm, dự kiến chuyển sang **Full (strict)** với cert `vnutour-tls`.
- **`ghcr` Secret**: Secret k8s chứa token kéo image từ Github, được gán thẳng vào `default` ServiceAccount để tự động inject vào mọi pod (`imagePullSecrets`).
- **`local-path` Storage**: Hạn chế lớn nhất. Vì dùng ổ cứng local trên `w1`, backend bị ghim vào `w1` và không thể scale vượt quá 1 replica. Nếu update, phải dùng `Recreate` strategy gây downtime vài giây.

## 5. Những bài học và lưu ý thiết kế (Git Archaeology / Code Reasons)

- **Tách Control Plane và Worker**: Control plane (`cp`) nhỏ gọn gọn 3GB RAM nhưng chứa Prometheus. Worker (`w1`) chứa mọi data. Điều này có chủ đích để sau này có thể dựng `w2`, cho phép tắt `w2` ban đêm trả RAM cho máy chủ chơi Reinforcement Learning (RL) mà không ảnh hưởng data.
- **`TRUST_PROXY_HEADERS`**: Trong `01.configmap.yaml`, cờ này ép Django tin header từ CF qua Ingress, ngăn vòng lặp redirect 301 vô hạn.
- **Bảo mật File `.env`**: k8s đọc `.env` qua lệnh `create secret`. File này phải siêu mỏng. Nếu `.env` vô tình dính biến môi trường rác (thừa từ thời Docker Compose), nó sẽ override các giá trị đúng trong ConfigMap.

## 6. Điểm yếu đã biết (Known Limitations)

1. **SPOF (Single Point of Failure)**: Homelab nằm tại một địa điểm vật lý, một đường mạng, không UPS. Mất mạng/điện = Tắt site.
2. **Không scale ngang Backend**: Volume `media-data` và `backup-data` nằm cứng ở node `w1`.
3. **Chỉ được chạy 1 bản Discord Bot**: Nếu chạy >=2 replicas, sẽ có hai kết nối Gateway, làm nhân đôi kết quả mỗi khi gõ slash command.
