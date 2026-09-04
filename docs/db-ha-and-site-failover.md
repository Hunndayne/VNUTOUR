# DB HA & Site-Failover — Kiến trúc & Runbook

Tài liệu vận hành cho tầng database HA (Patroni) và tự động failover toàn site
(homelab ⇄ Linode) của VNUTour prod. Viết 04/09/2026 sau khi triển khai + drill
thực tế. Prod chính thức: **https://vnutour.suctremmt.com**.

> Liên quan mã nguồn: `k8s/kustomize/components/{db-patroni,site-failover,failover-workloads}`,
> `k8s/kustomize/base/05.migrate-job.yaml`, `k8s/argocd/{prod-app,prod-standby-app}.yaml`.

---

## 1. Topology

Hai cụm **k3s độc lập** nối bằng **WireGuard mesh** (`10.88.0.0/24`), một **ArgoCD hub
trên Linode** quản cả hai (mọi Application `targetRevision: main`).

| Zone | Vai trò | Địa chỉ |
|---|---|---|
| **Homelab** (Proxmox) | Primary. cp `192.168.1.110` (= API server ArgoCD reach), w1 `192.168.1.111` (label `vnutour/storage=true`, chạy DB + workload) | IP public động, DDNS `vpn.hunn.io.vn` |
| **Linode** | Warm standby + ArgoCD hub | `172.104.186.118` (public tĩnh), mesh `10.88.0.2` |
| **RackNerd** | etcd **vote-only** (không giữ data) | mesh `10.88.0.3` |

Pod CIDR 2 cụm **trùng** `10.42.0.0/16` → **không route pod-network xuyên mesh**
(điểm này quyết định nhiều lựa chọn thiết kế bên dưới).

**Truy cập vận hành:**
- Điểm điều khiển: `ssh root@172.104.186.118` (Linode hub).
- Từ Linode: `kubectl …` = cụm Linode; `KUBECONFIG=/root/zone1.yaml kubectl …` = cụm homelab (qua mesh).
- Đứng trên node homelab (`vnutour-cp`/`w1`): `sudo k3s kubectl …` (dùng `/etc/rancher/k3s/k3s.yaml`; **không** có `zone1.yaml` ở đây).

---

## 2. Database HA — Patroni-in-k8s

**Kiến trúc:** Patroni (image Spilo `ghcr.io/zalando/spilo-16:3.3-p1`) chạy dạng
`StatefulSet postgres-ha` **hostNetwork** ghim node (advertise IP node để né pod-CIDR
trùng), 1 member mỗi cụm. Primary = homelab (`vnutour-w1`), replica = Linode
(`localhost`). DCS = **etcd 3-site** (homelab + Linode + RackNerd), quorum 2/3.

- **App → DB qua Service `pg-primary`** (HAProxy bám-primary, health-check Patroni REST
  `/primary`). `DB_HOST=pg-primary` ở prod (base để `postgres` cho staging; prod flip qua
  `components/prod-config`).
- **Replication ASYNC** (`synchronous_mode: false`): primary commit không chờ replica.
  - Ghi: **0ms** phụ thêm (sync sẽ +~35ms/commit = RTT mesh).
  - Lag bình thường ~**0** (streaming realtime).
  - **Mất dữ liệu tối đa < 1s**, và **chỉ khi primary crash đột ngột** (WAL chưa stream,
    bị `pg_rewind` bỏ khi rejoin). **Switchover có kế hoạch = 0 mất mát** (chờ replica bắt kịp).
- **Failover:** mất 1 site → etcd còn 2/3 → Patroni tự promote. Timeline (TL) tăng mỗi lần.

**Kiểm tra nhanh:**
```bash
# leader/replica/lag (chạy trong pod Patroni bất kỳ — nói chuyện etcd)
kubectl -n vnutour exec postgres-ha-0 -- patronictl list
# lag theo thời gian
kubectl -n vnutour exec postgres-ha-0 -- psql -U postgres -c \
  "SELECT application_name,state,sync_state,replay_lag FROM pg_stat_replication;"
```

**Switchover thủ công** (0 mất mát; chạy từ TRONG pod Patroni vì nó reach cả 2 member qua etcd):
```bash
kubectl -n vnutour exec postgres-ha-0 -- patronictl switchover --candidate vnutour-w1 --force
```

---

## 3. Site-Failover Automation

Mục tiêu: **site active = site đang giữ DB-leader**. Cụm nào là leader thì chạy singleton
workloads (bot Discord, email-worker) và sở hữu record DNS; cụm kia scale 0, không đụng DNS.

**Thành phần:**
- `components/site-failover`: Deployment **`site-activator`** (image `alpine/k8s`: có
  `kubectl`+`curl`+`jq`), RBAC (`deployments`+`deployments/scale`, `pods`+`pods/exec`),
  ConfigMap script (`run.sh`).
- `components/failover-workloads`: `bot` + `email-worker`, baseline **`replicas: 0`**
  (controller kéo lên 1 khi cụm là leader).

**Vòng lặp controller** (mỗi `INTERVAL=10s`):
1. `curl $PATRONI_URL/primary` (Patroni local). **200 = cụm này là leader** →
   `scale 1` bot/email + `cf_set` (ghi DNS về target của site này).
2. Ngược lại (standby) → `scale 0`; **chỉ homelab** đếm `stable` khi là replica khoẻ
   (`running`/`streaming`), đủ `FAILBACK_STABILIZE=300s` → **failback**:
   `kubectl exec $PATRONI_POD -- patronictl switchover --candidate $MEMBER_NAME --force`.

**DNS (điểm chuyển):** record **`ddns.hunn.io.vn`** (zone `hunn.io.vn`, user quản).
- Homelab leader → **`CNAME → vpn.hunn.io.vn`** (vpn DDNS lo IP động homelab).
- Linode leader → **`A → 172.104.186.118`** (IP tĩnh).
- **`proxied: false` BẮT BUỘC** (xem Gotcha #3).
- `vnutour.suctremmt.com` → CNAME → `ddns.hunn.io.vn`. **Proxy/WAF/TLS nằm ở hop
  `suctremmt.com`**; `ddns` chỉ cần resolve ra IP origin.

**Env per-overlay (`site-activator`):**

| Env | prod (homelab) | prod-standby (Linode) |
|---|---|---|
| `SITE` | `homelab` | `linode` |
| `MEMBER_NAME` | `vnutour-w1` | `localhost` |
| `DNS_TARGET_TYPE` | `CNAME` | `A` |
| `DNS_TARGET_CONTENT` | `vpn.hunn.io.vn` | `172.104.186.118` |
| `FAILBACK_STABILIZE` | `300` | (không set — chỉ homelab failback) |
| `CF_RECORD_NAME` | `ddns.hunn.io.vn` | `ddns.hunn.io.vn` |

---

## 4. Prerequisites (out-of-band, KHÔNG trong git)

1. **Secret `cf-dns-secret`** ns `vnutour` trên **CẢ 2 cụm**:
   - `CF_API_TOKEN`: Cloudflare token scope **Zone.DNS:Edit** trên zone `hunn.io.vn`
     (không lọc IP — homelab IP động).
   - `CF_ZONE_ID`.
   ```bash
   kubectl -n vnutour create secret generic cf-dns-secret \
     --from-literal=CF_API_TOKEN="$TOKEN" --from-literal=CF_ZONE_ID="$ZONE"
   KUBECONFIG=/root/zone1.yaml kubectl -n vnutour create secret generic cf-dns-secret \
     --from-literal=CF_API_TOKEN="$TOKEN" --from-literal=CF_ZONE_ID="$ZONE"
   ```
   ⚠️ **Đừng merge `feat/site-failover` khi chưa có secret trên cả 2 cụm** — `envFrom`
   thiếu secret → controller không start → bot homelab scale 0 mà không ai bật = rớt bot.
2. **`backend-secret.DB_PASSWORD` phải GIỐNG nhau 2 cụm** (dùng chung Patroni DB — password
   = của homelab primary). Copy chỉ 1 key, đừng đè cả secret (Linode có key riêng khác).
3. **ArgoCD Application `ignoreDifferences`** (đã trong `k8s/argocd/*.yaml`, nhưng nhớ nếu
   tạo lại): `StatefulSet/postgres-ha` → `/spec/volumeClaimTemplates`; `Deployment/bot` và
   `/email-worker` → `/spec/replicas`. **Application CR apply THỦ CÔNG** (không có app-of-apps)
   → sửa git xong phải `kubectl apply -f -` (hoặc `kubectl patch application`) lên argocd ns Linode.

---

## 5. Runbook — kiểm tra trạng thái

```bash
# (trên Linode hub)
# 1. ArgoCD apps
kubectl -n argocd get applications
# 2. DB leader/replica/lag
kubectl -n vnutour exec postgres-ha-0 -- patronictl list
# 3. Controller 2 cụm
kubectl -n vnutour get pods -l app=site-activator
KUBECONFIG=/root/zone1.yaml kubectl -n vnutour get pods -l app=site-activator
# 4. Bot đang ở đâu (đúng: 1 ở site leader, 0 ở site kia)
kubectl -n vnutour get deploy bot -o jsonpath='{.spec.replicas}'
KUBECONFIG=/root/zone1.yaml kubectl -n vnutour get deploy bot -o jsonpath='{.spec.replicas}'
# 5. DNS record hiện tại
TOKEN=$(kubectl -n vnutour get secret cf-dns-secret -o jsonpath='{.data.CF_API_TOKEN}' | base64 -d)
ZONE=$(kubectl -n vnutour get secret cf-dns-secret -o jsonpath='{.data.CF_ZONE_ID}' | base64 -d)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?name=ddns.hunn.io.vn" \
  | python3 -c "import sys,json;r=json.load(sys.stdin)['result'][0];print(r['type'],r['content'],'proxied='+str(r['proxied']))"
# 6. Site end-to-end
curl -s -o /dev/null -w "%{http_code}\n" https://vnutour.suctremmt.com/api/health
```

**Kéo primary về homelab thủ công** (nếu auto-failback chưa/không chạy):
```bash
kubectl -n vnutour exec postgres-ha-0 -- patronictl switchover --candidate vnutour-w1 --force
```

---

## 6. Gotchas / bài học (đã gặp thật)

1. **migrate PreSync hook**: `wait-for-postgres` từng hardcode `pg_isready -h postgres` →
   treo trên prod (không còn Service `postgres` sau cutover Patroni). **Phải đọc `$DB_HOST`**
   từ `backend-config` (base/staging = `postgres`, prod = `pg-primary`).
2. **DB_PASSWORD lệch giữa 2 cụm** → backend Linode `password authentication failed` / CrashLoop.
   Đồng bộ về password homelab (chỉ patch key `DB_PASSWORD`).
3. **Cloudflare Error 1014 (CNAME Cross-User Banned)** → site 403: `ddns.hunn.io.vn` bị
   **proxied:true** trong khi `vnutour.suctremmt.com` (proxied) là CNAME trỏ tới nó, mà
   `suctremmt.com` + `hunn.io.vn` là **2 tài khoản Cloudflare khác nhau** → CNAME proxied
   xuyên tài khoản = 1014. **Fix: `ddns` phải `proxied:false`** (script controller PUT proxied:false).
4. **bot/email flap**: controller scale 0↔1 nhưng git baseline `replicas:0` + `selfHeal:true`
   → ArgoCD revert. **Fix: `ignoreDifferences /spec/replicas`** cho 2 Deployment.
5. **postgres-ha OutOfSync giả** dù `kubectl diff` rỗng: ArgoCD không normalize
   `volumeClaimTemplates` (server-defaulted). **Fix: `ignoreDifferences /spec/volumeClaimTemplates`**.
6. **Auto-failback đừng POST REST chéo**: controller (pod-network) không route tới Patroni
   REST của leader cụm kia qua mesh (`10.88.0.2`) → `switchover failed`. **Dùng
   `kubectl exec` vào pod Patroni LOCAL chạy `patronictl switchover`** (drive qua etcd chung).
7. **`kubectl auth can-i`**: kiểm tra quyền exec phải dùng `--subresource=exec`
   (`can-i create pods/exec` báo "no" giả).
8. **Nhét lệnh `kubectl create secret … \` có dòng trống sau `\`** → shell chạy thiếu
   `--from-literal` → **tạo secret rỗng**. Dán mỗi lệnh 1 dòng.

---

## 7. Hạn chế & lưu ý còn lại

- **Mesh-blip đơn thuần kích full failover**: chỉ cần VPN/mesh chập, homelab mất quorum etcd
  (2/3 phiếu ở bên kia mesh) → tự demote → failover sang Linode, rồi mesh về thì auto-failback.
  Đúng và an toàn (tránh split-brain), hysteresis 300s chống flap, site 200 suốt. Nếu mesh
  hay chập → cân nhắc tune etcd heartbeat / failover grace cho "lì" hơn.
- **Storage chưa HA**: data chỉ ở homelab + Linode (local-path PVC `pgdata-postgres-ha-0`);
  RackNerd chỉ vote. Mất cả 2 site data = restore từ backup R2.
- **OAuth**: redirect + JS origin của Google/Discord phải phủ `vnutour.suctremmt.com`.

---

## 8. Trạng thái đã validate (drill 04/09/2026)

Drill (giả lập mesh/VPN partition — homelab cụm vẫn sống): **toàn bộ round-trip PASS**.
Mesh rớt → Linode promote (TL↑) + DNS `A→Linode` + bot→Linode → **site vẫn 200 (Linode
serve được)**; mesh về → homelab rejoin `streaming lag 0` → sau 300s **auto-failback qua
patronictl** → homelab leader + DNS `CNAME→vpn` + bot→homelab → site 200. Không split-brain
(2 Patroni đồng thuận cùng TL).
