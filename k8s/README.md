# Triển khai Kubernetes

> **Kustomize / GitOps:** Xem [hướng dẫn tiếng Việt](KUSTOMIZE_GUIDE.vi.md) về base, components, ba overlay, Argo CD, ví dụ chỉnh sửa và vận hành. Tài liệu đó được đối chiếu với bản render ngày 09/09/2026. Các phần triển khai trực tiếp bên dưới mô tả luồng manifest đánh số; một số mô tả kiến trúc/CD đã cũ so với `kustomize/`. Không dùng lệnh triển khai cũ cho tài nguyên Argo CD quản lý mà chưa đối chiếu phạm vi trong hướng dẫn.

Cùng stack với `backend/DOCKER.md` — PostgreSQL, một migration job chạy một lần, Gunicorn, frontend React/Nginx, Discord bot và email worker — cộng thêm namespace Prometheus/Grafana và một backup CronJob chạy hằng đêm. Đây là những gì production đang chạy: stack Compose đã bị thay thế hoàn toàn, và Cloudflare Tunnel trước đây dùng để đứng trước nó cũng đã bị gỡ bỏ.

Các file được đánh số theo thứ tự apply. `00`–`10` là ứng dụng, `11`–`15` là monitoring, `16` là backup CronJob. `cert-manager-issuer.yaml` là tàn dư từ lần thử ACME và không còn được apply — xem phần **TLS** bên dưới.

---

## Bố cục Cluster

| Node | Địa chỉ | vCPU | RAM | Chạy gì |
|---|---|---|---|---|
| `vnutour-cp` | 192.168.1.110 | 2 | 3 GB | k3s server, ingress-nginx, Prometheus, CI runner |
| `vnutour-w1` | 192.168.1.111 | 2 | 3 GB | postgres, backend, frontend, bot, email-worker, Grafana |
| `vnutour-w2` | — | 2 | 6 GB | chưa dựng; dự phòng, tắt nguồn qua đêm khi có |

Ubuntu 24.04, k3s v1.36.3. `w1` một mình chạy toàn bộ ứng dụng — đó là lý do `w2` là tuỳ chọn, và vì sao có thể tắt `w2` qua đêm để giải phóng bộ nhớ trên Proxmox host cho RL cluster.

`w1` phải mang label mà các stateful pod chọn, nếu không postgres, backend và backup Job sẽ ở trạng thái Pending mãi mãi:

```bash
kubectl label node vnutour-w1 vnutour/storage=true
```

Control plane từng chạy với `CriticalAddonsOnly=true:NoExecute` khi còn là VM 2 GB, để tránh các pod ứng dụng bị lên đó. Taint đó **đã bị xoá** bây giờ khi cp có 3 GB và đang chạy Prometheus. Không có gì trong các manifest này tolerate nó, nên nếu đặt lại sẽ khiến mọi pod được schedule lên cp bị kẹt.

Resource limits được định cỡ cho các node này. Tổng của chúng vượt quá bộ nhớ của một node — limits là trần để ngăn một pod chạy vượt mức, không phải reservation — nhưng điều này có nghĩa là các con số không thể tăng đơn giản mà không kiểm tra tổng với node.

---

## Yêu cầu tiên quyết của Cluster

### Ingress controller

`10.ingress.yaml` đặt `ingressClassName: nginx`, trong khi k3s mặc định đi kèm Traefik — nó sẽ chấp nhận object nhưng không bao giờ route đến nó. Cài server với Traefik bị vô hiệu hoá:

```bash
curl -sfL https://get.k3s.io | sh -s - server --disable=traefik --node-ip 192.168.1.110
```

Trên cluster đang chạy, thay vào đó hãy xoá nó:

```bash
kubectl -n kube-system delete helmchart traefik traefik-crd
```

Sau đó cài ingress-nginx **với forwarded headers được bật**:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.config.use-forwarded-headers=true
```

Cài đặt này ngược với những gì file này nói khi cluster còn là edge của chính nó, và lý do là Cloudflare. Cloudflare kết thúc TLS của trình duyệt và gửi `X-Forwarded-Proto: https`; nếu không có `use-forwarded-headers`, controller sẽ ghi đè header đó từ hop nó chấp nhận, Django kết luận request là plaintext, và `SECURE_SSL_REDIRECT` trả lời mọi lời gọi `/api` bằng 301 vòng lặp.

Hệ quả là ingress-nginx bây giờ tin bất kỳ `X-Forwarded-Proto` nào đến, vì vậy bất cứ thứ gì có thể nói chuyện trực tiếp với 443 của origin đều có thể tự nhận request plaintext của mình đến qua HTTPS. Điều đóng cửa điều đó là allowlist Cloudflare trong `host-firewall.nft` bên dưới: nếu nguồn duy nhất có thể đến 443 là Cloudflare, thì header chỉ có thể đến từ Cloudflare. Authenticated Origin Pulls sẽ thêm kiểm tra thứ hai ở lớp TLS nhưng chưa được thiết lập.

`TRUST_PROXY_HEADERS=1` trong ConfigMap là một switch riêng: nó báo Django tin header mà ingress-nginx chuyển tiếp, vì mọi hop bên trong cluster là HTTP thuần.

### Phơi bày ra ngoài

Router không thể forward một port riêng lẻ, nên control plane nằm trong DMZ của nó: mọi port trên 192.168.1.110 đều đến từ internet — SSH, Kubernetes API trên 6443, kubelet trên 10250, toàn bộ dải NodePort. Không có gì upstream lọc bất kỳ thứ gì. Điều đó khiến `host-firewall.nft` là thứ duy nhất đứng giữa cluster và internet thay vì là lớp thứ hai, đó là lý do nó nằm trong repository này thay vì chỉ sống trên host.

Đây là một bảng nftables riêng (`inet vnutour_fw`) ở priority -10, không phải ufw: k3s viết rules của nó qua iptables-nft, `DEFAULT_FORWARD_POLICY=DROP` của ufw phá vỡ pod networking, và ufw reload ghi đè lên các chain của kube-proxy. Một bảng riêng chạy trước bảng của k3s và tồn tại qua k3s restart mà không bị ảnh hưởng.

Nó lọc **cả hai** `input` và `forward`. Traffic đến 443 và mọi NodePort được DNAT trong `PREROUTING` rồi route đến một pod, vì vậy nó đi qua FORWARD và không bao giờ đến INPUT — ruleset chỉ INPUT để nguyên toàn bộ dải NodePort mở trong khi trông có vẻ đã đóng.

Chính sách: từ internet chỉ có 80 và 443, và chỉ từ các dải được publish của Cloudflare, nên origin không thể bị scan hay hit trực tiếp và không request nào có thể bỏ qua edge. Port 80 có ở đó chỉ vì zone đang chạy Flexible và Cloudflare vì vậy đến origin qua HTTP — xem TLS bên dưới. Mọi thứ đến trên bất kỳ interface nào khác đều được tin tưởng — `enp6s19` (10.10.10.11, mạng quản lý Proxmox SDN) và các `cni0`, `flannel.1`, `veth*` của k3s. Các source trong `192.168.1.0/24` vẫn mở trên eth0 vì w1 đến apiserver, kubelet và VXLAN của flannel qua nó; đóng điều đó đã làm w1 rời khỏi cluster.

`update-cloudflare-ips.sh` điền các set `cloudflare_v4`/`cloudflare_v6` từ cloudflare.com và chạy hàng tuần từ một timer, giữ bản sao tốt nhất trong `/var/lib/vnutour-fw/cloudflare.nft` để boot không có mạng không để lại các set rỗng. Hai hệ quả đáng nhớ: tắt orange cloud cho một hostname sẽ đưa nó offline ngay lập tức, vì traffic khi đó đến thẳng từ client; và Grafana trên `:30300` chỉ có thể truy cập từ LAN và SDN.

### TLS

Trình duyệt nhận HTTPS từ Cloudflare, nhưng hop từ Cloudflare đến origin này là **HTTP thuần trên port 80** — chế độ SSL/TLS của zone là **Flexible**. Điều đó được đo vào ngày 10/08/2026 khi debug firewall: mọi kết nối đến từ dải Cloudflare đều đến với `DPT=80`. File này tuyên bố Full (strict) trong nhiều tháng và đã sai.

**Cloudflare Origin Certificate** đã được load và được tham chiếu bởi Ingress, nên origin có thể phục vụ HTTPS ngay hôm nay — edge đơn giản là không yêu cầu nó. Chuyển zone sang Full (strict) là điều làm cho nó thực, và đó là điều cho phép đóng port 80 trên host firewall. Kiểm tra trước rằng certificate bao gồm cả hai hostname, nếu không zone còn thiếu sẽ trả lời 526:

```bash
kubectl -n vnutour get secret vnutour-tls -o jsonpath='{.data.tls\.crt}' \
  | base64 -d | openssl x509 -noout -subject -dates -ext subjectAltName
```

Certificate có hiệu lực 15 năm và không tự gia hạn, nên không có cert-manager, không có ACME, và không có đường solver port-80 nào cần giữ mở. Port 80 mở chỉ vì Flexible cần nó.

```bash
kubectl -n vnutour create secret tls vnutour-tls --cert=origin.pem --key=origin.key
```

`10.ingress.yaml` tham chiếu secret đó và giữ `ssl-redirect: "false"`. Ép redirect ở origin cũng gây vòng lặp, vì edge đã làm rồi.

cert-manager đã được thử và bỏ. `cert-manager-issuer.yaml` vẫn còn trong tree chỉ như một ghi chép về lần thử đó — apply nó không có ích gì trừ khi cert-manager được cài lại, và Full (strict) không cần nó.

### Images

Cả hai image đều nằm trong repository GHCR **private** dưới tên owner viết thường: `ghcr.io/hunndayne/vnutour-backend` và `-frontend`. Cluster cần một pull secret, được gắn vào ServiceAccount mặc định của namespace để mọi pod đều dùng nó mà không cần đặt tên:

```bash
kubectl -n vnutour create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=<github-user> --docker-password=<PAT with read:packages>
kubectl -n vnutour patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"ghcr"}]}'
```

Tags là short commit SHA. Các tag được ghi vào manifest chỉ là giá trị bootstrap — tag thực tế đến từ `kubectl set image`, đó là những gì CD làm, nên một manifest có thể đọc cũ hơn những gì đang chạy mà không có gì sai. Tránh deploy `:latest`: nó loại bỏ cả khả năng rollback lẫn khả năng biết build nào đang chạy.

### Storage

k3s cung cấp `local-path` là StorageClass mặc định. Các volume này sống trên disk của một node, nên bất kỳ pod nào mount một volume đều bị ghim vào node đó — xem Giới hạn đã biết.

Một claim bind với node mà pod của nó đầu tiên hạ xuống, điều này khiến lần apply đầu tiên là khoảnh khắc quyết định nơi database sống mãi mãi. Hãy làm điều đó với `w2` đã tắt nguồn, để không có gì bind volume vào node bị tắt đêm. `nodeSelector` trên postgres, backend và backup Job là lớp bảo vệ thứ hai cho cùng vấn đề đó.

---

## Secrets

Bốn secret, không có cái nào trong git:

| Secret | Namespace | Chứa gì |
|---|---|---|
| `backend-secret` | `vnutour` | DB credentials, `DJANGO_SECRET_KEY`, SMTP, Discord, R2 |
| `vnutour-tls` | `vnutour` | Cloudflare Origin Certificate |
| `ghcr` | `vnutour` | GHCR pull credentials |
| `grafana-admin` | `monitoring` | Grafana admin login |

`02.secret.yaml` chứa placeholder và không được apply nguyên bản. Tạo cái thực từ một file được giữ bên ngoài repository:

```bash
kubectl -n vnutour create secret generic backend-secret --from-env-file=/srv/vnutour/.env
```

File đó phải **tối giản** — chỉ các key thực sự bí mật. Pod load ConfigMap trước và Secret sau, nên bất kỳ key nào có mặt trong cả hai sẽ thắng từ Secret; một `DJANGO_ALLOWED_HOSTS` hay `WEB_BASE_URL` lạc lõng được copy từ env Compose cũ sẽ âm thầm ghi đè giá trị đúng trong `01.configmap.yaml`.

Tên key phải khớp chính xác với `webapi/serverapi/settings.py`. Đặc biệt Django secret là `DJANGO_SECRET_KEY`, và SMTP settings được đọc là `SMTP_*` thay vì tên `EMAIL_*` của Django.

`backend-secret` hiện mang các key `R2_*`, nghĩa là ứng dụng lưu media upload trên R2 thay vì trên volume `media-data`. Đó cũng là lý do secret tuỳ chọn `r2-backup` của backup CronJob không tồn tại: credentials nó sẽ cung cấp đã có trong environment rồi.

---

## Triển khai

Chỉ cần thiết khi dựng cluster từ đầu hoặc để dựng lại ở chỗ khác; triển khai hàng ngày là pipeline bên dưới.

```bash
kubectl apply -f k8s/00.namespace.yaml
kubectl apply -f k8s/01.configmap.yaml -f k8s/03.storage.yaml
kubectl apply -f k8s/04.postgres.yaml
kubectl -n vnutour rollout status statefulset/postgres
```

Migration job tự dọn dẹp một tiếng sau khi hoàn thành, nên các deploy thông thường có thể apply ngay. Deploy lại sớm hơn sẽ gặp vấn đề vì pod template của Job là immutable và lần apply thứ hai với image tag mới sẽ bị từ chối, nên hãy xoá trước:

```bash
kubectl -n vnutour delete job vnutour-migrate --ignore-not-found
kubectl apply -f k8s/05.migrate-job.yaml
kubectl -n vnutour wait --for=condition=complete job/vnutour-migrate --timeout=300s
```

Job chạy `migrate` rồi `seed_phases`. Cả hai đều idempotent. Không có gì khác tự sắp xếp sau nó, nên hãy đợi nó trước khi khởi động workloads: backend tự chặn qua readiness probe, nhưng bot và email worker không có probe và sẽ vui vẻ chạy trên schema chưa migrate.

```bash
kubectl apply -f k8s/06.backend.yaml -f k8s/07.bot.yaml -f k8s/08.email-worker.yaml -f k8s/09.frontend.yaml -f k8s/10.ingress.yaml
kubectl apply -f k8s/16.backup-cronjob.yaml
```

Trên database được tạo mới thay vì restore, có hai điều cần lưu ý:

- **Tài khoản `hunn` không có mật khẩu dùng được.** Migration 0021 thăng nó lên `master_admin` và 0024 vô hiệu hoá mật khẩu đã seed, và `Account` không phải `AUTH_USER_MODEL` nên `createsuperuser` không giúp được. Đặt bằng tay qua `manage.py shell`, và đăng nhập bằng **username**, không phải email — `auth_service` tra cứu `username__iexact`.
- **Các phase chương trình** đến từ `seed_phases`, không phải từ `migrate`. Nếu không có chúng, các trang admin 404 trên `/api/program/phases/registration`. Migration Job đã chạy nó; chạy tay `migrate` một mình thì không.

---

## Continuous Deployment

`.github/workflows/ci.yml` chạy tests và lint trên mọi pull request. Trên push vào `main`, nó cũng build cả hai image và push lên GHCR được tag với short SHA và `latest`, sử dụng `GITHUB_TOKEN` tích hợp sẵn — không cần lưu PAT. `VITE_GOOGLE_CLIENT_ID` phải tồn tại như một **repository variable**, vì Vite bake nó vào bundle lúc build và giá trị ConfigMap sẽ đến quá muộn.

`.github/workflows/deploy.yml` sau đó chạy trên **self-hosted runner** trong homelab — API của cluster đóng với internet, nên cloud runner không thể đến được. Nó chạy migration Job được ghim với image đang deploy, `kubectl set image` trên tất cả bốn Deployment, và đợi rollout của backend và frontend mà thôi. Bot được cố tình không đợi: nó không có readiness probe và CrashLoop khi `DISCORD_TOKEN` chưa set, điều này sẽ làm thất bại mọi deploy vì lý do không liên quan.

Rollback là `Run workflow` trên Deploy với short SHA cũ trong `image_tag`. Deploy bằng tay cũng là cùng lệnh `kubectl set image`.

Một điểm mù cần biết: deploy **không** re-tag `16.backup-cronjob.yaml`, nên backup đêm tiếp tục chạy image mà manifest đặt tên cho đến khi được bump bằng tay. Điều đó chỉ quan trọng khi chính `backup_service` thay đổi.

---

## Monitoring

Đang chạy trên cluster như mô tả ở trên.

```bash
kubectl apply -f k8s/11.monitoring-namespace.yaml -f k8s/12.kube-state-metrics.yaml -f k8s/13.node-exporter.yaml -f k8s/14.prometheus.yaml -f k8s/15.grafana.yaml
```

Prometheus được ghim vào cp với `nodeSelector` để việc tăng trưởng bộ nhớ không ảnh hưởng đến `w1`, nơi postgres và backend sống, và được trim để vừa với control plane 3 GB: retention 5 ngày, giới hạn 5GB, volume 6Gi và memory limit 768Mi. Các con số đó là ngân sách, không phải tuỳ chọn — Prometheus OOM trên control plane sẽ kéo k3s server xuống cùng, nên chỉ tăng khi tăng RAM của VM. Grafana, kube-state-metrics và node-exporter không có ràng buộc như vậy.

Prometheus khám phá target từ annotation `prometheus.io/scrape` thay vì từ ServiceMonitor object, vì k3s thường không có Prometheus Operator để đọc chúng. Ba pod mang annotation đó: backend export Django request metrics trên `:8000/metrics`, postgres pod chạy exporter sidecar trên `:9187`, và frontend pod chạy một exporter trên `:9113` đọc `stub_status` của Nginx.

Grafana là NodePort trên `30300`, có thể truy cập qua LAN và VPN tại `http://192.168.1.111:30300`, và không từ internet vì router không forward NodePort nào. Prometheus không có route external nào cả:

```bash
kubectl -n monitoring port-forward svc/prometheus 9090:9090
```

`15.grafana.yaml` vẫn đi kèm mật khẩu placeholder `change-me`. Hãy thay đổi nó.

---

## Backup

`16.backup-cronjob.yaml` chạy lúc 03:00 Asia/Ho_Chi_Minh. Nó gọi `create_backup(prefix='cron')` của chính ứng dụng thay vì `pg_dump`, nên archive là đúng file `.zip` mà trang admin restore chấp nhận, giữ 14 bản mới nhất trên volume `backup-data`, và copy mỗi bản offsite lên Cloudflare R2 (bucket `vnutour`, prefix `db-backups/`) qua `scripts/upload_backup.py`.

Bản copy local là đường restore nhanh và bảo vệ chống sai lầm logic; bản copy R2 là thứ tồn tại khi mất `w1`. Pruning chỉ áp dụng cho bản copy local — đặt lifecycle rule trên bucket cho bên R2.

Hãy thực hành restore trên database scratch. `restore_backup()` xoá target trước khi load, nên trỏ nó vào production để "kiểm tra backup" chính là cách backup phá huỷ thứ nó bảo vệ.

---

## Tắt nguồn `w2` qua đêm

Sau khi `w2` tồn tại. Drain trước, rồi tắt VM:

```bash
kubectl drain vnutour-w2 --ignore-daemonsets --delete-emptydir-data
```

Sau khi bật lại `w2`:

```bash
kubectl uncordon vnutour-w2
```

Drain di chuyển các pod sang `w1` trước khi node biến mất. Tắt VM mà không drain sẽ để node ở trạng thái NotReady khoảng năm phút trước khi controller evict bất cứ thứ gì, và bot sẽ offline trong suốt khoảng thời gian đó mà không được reschedule ở đâu cả.

Đừng bao giờ làm điều này với `w1`. Các volume của nó là database, uploads và backups, và không cái nào theo pod sang node khác — đó là một outage, không phải giảm capacity.

---

## Giới hạn đã biết

**Backend chưa thể scale quá một replica.** Nó mount các claim `media-data` và `backup-data`, và `local-path` volumes là node-local, nên mọi backend pod bị ghim vào node chứa chúng — `nodeSelector` nói thẳng điều mà volumes sẽ enforce dù sao. HPA sẽ chồng tất cả replica lên một node đó hoặc để chúng Pending. Media đã ở trên R2, nên thứ còn lại là bỏ hai mount sau khi backup Job là writer duy nhất của `/app/backups`; xoá `nodeSelector` là bước cuối cùng của thay đổi đó, không phải bước đầu. Frontend không có volume và có thể scale ngay hôm nay.

Vì lý do tương tự, backend deploy với `strategy: Recreate` và có vài giây downtime mỗi lần rollout. Rolling update sẽ phải surge thêm một pod lên node duy nhất đang giữ những volume đó, và ở chỗ khác nó không thể attach chúng — rollout sẽ dừng với pod mới Pending. Cả hai vấn đề HPA và rollout đều được giải quyết bởi cùng một thay đổi.

**Bot và email worker phải dừng ở một replica.** Hai pod bot nghĩa là hai Discord gateway session trên cùng token và mọi slash command chạy hai lần. Cả hai dùng `strategy: Recreate` để rollout không bao giờ overlap. Đừng đặt HPA cho bất kỳ cái nào.

**Postgres là StatefulSet trên một PVC tĩnh**, không phải `volumeClaimTemplates`. Scale lên 2 sẽ có hai tiến trình postgres ghi cùng một data directory.

**Homelab là single point of failure.** Một địa điểm, một đường ISP, không có UPS: mất điện hoặc sự cố trong sự kiện sẽ dừng sự kiện đó. Bản copy R2 của backup là thứ một lần dựng lại ở chỗ khác sẽ bắt đầu từ đó.
