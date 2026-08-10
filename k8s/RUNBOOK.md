# Runbook vận hành k3s

Cutover từ Compose sang k3s xong ngày 09/08/2026; Compose và Cloudflare Tunnel
đã bỏ. File này là việc hằng ngày sau đó. Kiến trúc và lý do từng lựa chọn nằm
ở `README.md` cùng thư mục.

Mọi lệnh `kubectl` chạy trên `vnutour-cp` (192.168.1.110), nơi có sẵn
`/etc/rancher/k3s/k3s.yaml`.

---

## Nhìn trạng thái trong 30 giây

```bash
kubectl get nodes -o wide
kubectl -n vnutour get pods -o wide
kubectl -n vnutour get deploy,sts,cronjob
kubectl -n vnutour get ingress,secret
```

Bình thường: 2 node `Ready`, postgres + backend + frontend + email-worker
`Running` trên `w1`, bot `Running` nếu đã có token. Ảnh đang chạy thật:

```bash
kubectl -n vnutour get deploy -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image
```

Tag trong manifest chỉ là giá trị khởi tạo — bản đang chạy do `kubectl set image`
quyết định, nên manifest cũ hơn cụm là chuyện bình thường.

---

## Ra bản mới

**Đường chính thức:** merge vào `main`. CI chạy test + lint, build hai ảnh đẩy
lên GHCR theo short SHA, rồi workflow Deploy tự chạy trên runner self-hosted:
migrate + `seed_phases` → `set image` bốn Deployment → chờ backend và frontend
Ready → gọi `/healthz`.

Theo dõi từ phía cụm trong lúc nó chạy:

```bash
kubectl -n vnutour get pods -w
kubectl -n vnutour logs job/vnutour-migrate -f
```

**Deploy tay** (khi CI hỏng hoặc cần bản không qua CI). `T` là short SHA đã có
ảnh trên GHCR:

```bash
T=abc1234
kubectl -n vnutour delete job vnutour-migrate --ignore-not-found
sed "s#\(image: ghcr.io/hunndayne/vnutour-backend:\).*#\1$T#" k8s/05.migrate-job.yaml | kubectl apply -f -
kubectl -n vnutour wait --for=condition=complete job/vnutour-migrate --timeout=300s
kubectl -n vnutour set image deploy/backend backend=ghcr.io/hunndayne/vnutour-backend:$T
kubectl -n vnutour set image deploy/bot bot=ghcr.io/hunndayne/vnutour-backend:$T
kubectl -n vnutour set image deploy/email-worker email-worker=ghcr.io/hunndayne/vnutour-backend:$T
kubectl -n vnutour set image deploy/frontend frontend=ghcr.io/hunndayne/vnutour-frontend:$T
kubectl -n vnutour rollout status deploy/backend --timeout=180s
```

**Rollback:** chạy workflow Deploy bằng `Run workflow` và điền `image_tag` là
short SHA cũ. Không có GitHub thì `kubectl -n vnutour rollout undo deploy/backend`
(và các deployment khác) — nhưng migration đã chạy thì không lùi theo, nên chỉ
an toàn khi bản mới không đổi schema.

Đừng deploy `:latest`: mất khả năng biết bản nào đang chạy và lùi về đâu.

---

## Đổi cấu hình và secret

Giá trị không bí mật nằm ở `01.configmap.yaml` (sửa file, apply, restart). Giá
trị bí mật nằm trong `backend-secret`, tạo từ file ngoài repo:

```bash
kubectl -n vnutour create secret generic backend-secret \
  --from-env-file=/srv/vnutour/.env --dry-run=client -o yaml | kubectl apply -f -
kubectl -n vnutour rollout restart deploy/backend deploy/bot deploy/email-worker
```

File env phải **tối giản**, chỉ chứa key thật sự bí mật. Pod nạp ConfigMap trước
rồi Secret sau, nên key trùng tên ở cả hai chỗ sẽ lấy giá trị trong Secret —
một dòng `DJANGO_ALLOWED_HOSTS` sót lại từ thời Compose là đủ để ghi đè cấu hình
đúng mà không báo lỗi gì.

Sửa Deployment/Service thì `kubectl apply -f` file tương ứng. Nhớ rằng apply
`06.backend.yaml` sẽ kéo image trong file đè lên image đang chạy — sau đó phải
`set image` lại tag hiện hành, hoặc chạy lại Deploy.

---

## Backup và restore

CronJob `vnutour-backup` chạy 03:00 giờ Việt Nam, giữ 14 bản trên volume của
`w1` và đẩy một bản lên R2 (`vnutour`, prefix `db-backups/`).

```bash
kubectl -n vnutour get cronjob vnutour-backup
kubectl -n vnutour get jobs -l app=vnutour-backup
kubectl -n vnutour logs job/<tên-job-gần-nhất>
```

Chạy ngay một bản, không chờ tới 03:00:

```bash
kubectl -n vnutour create job --from=cronjob/vnutour-backup backup-manual-$(date +%m%d%H%M)
```

Liệt kê và lấy bản backup về máy:

```bash
kubectl -n vnutour exec deploy/backend -- ls -lh /app/backups
kubectl -n vnutour cp vnutour/<pod-backend>:/app/backups/<tên>.zip ./<tên>.zip
```

> Diễn tập restore chỉ làm trên database rác. `restore_backup()` xoá sạch dữ liệu
> đích rồi mới nạp lại — trỏ nó vào production để "kiểm tra backup" là cách
> backup xoá mất đúng thứ nó bảo vệ.

---

## Sự cố hay gặp

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
|---|---|---|
| Pod `Pending` mãi | `w1` mất nhãn `vnutour/storage=true`, hoặc node hết RAM | `kubectl label node vnutour-w1 vnutour/storage=true`; `kubectl describe pod` xem dòng Events |
| `ImagePullBackOff` | secret `ghcr` thiếu/hết hạn, hoặc ServiceAccount chưa được patch | tạo lại secret rồi patch `serviceaccount default` (README, mục Images) |
| Django trả 400 trống | Host không nằm trong `DJANGO_ALLOWED_HOSTS` | thêm host vào `01.configmap.yaml`, apply, restart backend |
| `/api` lặp 301 vô hạn | ingress-nginx mất `use-forwarded-headers=true`, hoặc `TRUST_PROXY_HEADERS` bị secret ghi đè | `helm upgrade` bật lại cờ; kiểm tra key trùng trong `backend-secret` |
| Cloudflare 526 | cert trong `vnutour-tls` sai/hết hạn, hoặc Full (strict) bật mà origin dùng self-signed | nạp lại Origin Certificate vào secret `vnutour-tls` |
| Cloudflare 521/522 | 443 không tới được cụm: router mất port-forward, IP nhà đổi, ingress-nginx chết | `kubectl -n ingress-nginx get pods`; kiểm tra forward 443 → 192.168.1.110 |
| 502 qua ingress | backend chưa Ready hoặc đang rollout Recreate | `kubectl -n vnutour rollout status deploy/backend`; xem log backend |
| Slash command chạy hai lần | hai phiên gateway cùng token: bot scale >1, hoặc còn một bản chạy ngoài cụm | `kubectl -n vnutour get pods -l app=bot` phải đúng 1 pod; tắt bản chạy ở nơi khác |
| Bot `CrashLoopBackOff` | thiếu `DISCORD_TOKEN` trong `backend-secret` | nạp token rồi restart; deploy không chờ bot nên việc này không chặn CD |
| k3s server trên cp lịm đi | Prometheus phình vượt RAM cp | kiểm tra `kubectl -n monitoring top pod`; giữ nguyên retention/limit trong `14.prometheus.yaml` trừ khi đã nâng RAM VM |
| Không đăng nhập được admin | mật khẩu `hunn` bị migration 0024 vô hiệu hoá | đặt lại qua `manage.py shell`, đăng nhập bằng **username** chứ không phải email |

Xem log nhanh:

```bash
kubectl -n vnutour logs deploy/backend --tail=200
kubectl -n vnutour logs deploy/bot --tail=200
kubectl -n vnutour describe pod <pod>
```

---

## Bảo trì node

Khởi động lại `w1` là dừng dịch vụ: database, media và backup đều nằm trên đĩa
của nó và không đi theo pod. Chọn giờ vắng, và biết trước là app sẽ tắt trong
lúc đó.

`cp` reboot thì API và ingress mất theo — site tắt, nhưng dữ liệu không sao.

`w2` (khi dựng) thì `drain` trước rồi mới tắt VM, `uncordon` sau khi bật lại.

Nâng RAM VM trên Proxmox cần tắt máy; nâng cp là điều kiện để nới retention của
Prometheus.

---

## Khôi phục khi mất cụm

Thứ tự, giả định `w1` mất trắng và chỉ còn bản backup trên R2:

1. Dựng lại node theo `README.md` (k3s `--disable=traefik`, nhãn `vnutour/storage`,
   ingress-nginx với `use-forwarded-headers=true`).
2. Tạo lại bốn secret: `backend-secret`, `vnutour-tls`, `ghcr`, `grafana-admin`.
3. Apply `00`–`10` rồi `16`. Migration Job tự chạy `seed_phases`.
4. Tải bản backup mới nhất từ R2, đưa vào pod backend, restore qua trang admin
   hoặc `restore_backup()` — database lúc này còn trống nên xoá-rồi-nạp là đúng
   mong muốn.
5. Đặt lại mật khẩu `hunn` (migration 0024 vô hiệu hoá mật khẩu seed).
6. Media đã nằm trên R2 nên không cần khôi phục kèm.

Nếu mất cả homelab (điện, mạng, phần cứng), các bước trên chạy được trên một VPS
bất kỳ; phần đổi là trỏ DNS Cloudflare sang IP mới và mở 443. Chưa diễn tập lần
nào — đó là rủi ro đã biết, không phải quy trình đã kiểm chứng.

---

## Còn treo

- [ ] Đổi mật khẩu admin Grafana khỏi `change-me` trong `15.grafana.yaml`
- [ ] Nạp `DISCORD_TOKEN` cho bot và `SMTP_*` cho email-worker
- [ ] Hạn chế 443 chỉ nhận từ dải IP Cloudflare (hoặc bật Authenticated Origin
      Pulls) — đang là mặt hở của `use-forwarded-headers`
- [ ] Dựng `vnutour-w2`, chạy thử một chu kỳ `drain`/`uncordon`
- [ ] Diễn tập restore từ R2 trên database rác
- [ ] Bump tag ảnh trong `16.backup-cronjob.yaml` khi `backup_service` đổi — CD
      không đụng tới file này
- [ ] UPS cho máy và modem; chốt phương án chạy tạm trên VPS trong ngày event
