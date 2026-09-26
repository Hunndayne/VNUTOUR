# Quy trình khởi động lại môi trường staging

**VNU Tour 2026 · Zone 1 homelab · Namespace `vnutour-staging`**

> SOP vận hành trên k3s controller `CONTROLLER_IP_ADDRESS`  
> Cập nhật: 21/09/2026

Tài liệu này hướng dẫn dựng lại staging sau khi namespace bị xóa, từ source Kustomize trên nhánh `staging`. Quy trình chạy trực tiếp trên `vnutour-cp` bằng `sudo k3s kubectl`, tạo lại các Secret ngoài Git, khởi động PostgreSQL trước, sau đó để Kustomize và Argo CD reconcile phần ứng dụng.

Không dùng lại bộ manifest legacy trong thư mục `~/k8s/staging`.

> **Kết luận vận hành:** Sau khi namespace bị xóa, cần chờ deletion hoàn tất, tạo lại namespace và ba Secret, xác nhận node storage, dựng PostgreSQL, rồi mới apply overlay hoàn chỉnh. Không xóa PVC để xử lý Pod `Pending`.

## Phạm vi và trạng thái mong đợi

| Hạng mục            | Giá trị vận hành                           |
| ------------------- | ------------------------------------------ |
| Cluster             | Zone 1 homelab trên Proxmox                |
| Controller          | `vnutour-cp` tại `CONTROLLER_IP_ADDRESS`   |
| Namespace           | `vnutour-staging`                          |
| Git                 | Repository VNUTOUR, nhánh `staging`        |
| Điểm triển khai     | `k8s/kustomize/overlays/staging`           |
| Workload            | PostgreSQL, migration, backend và frontend |
| Không thuộc staging | Bot, email worker, monitoring và backup    |

## Nguyên tắc an toàn

- Chạy lệnh trên `vnutour-cp` bằng `sudo k3s kubectl`; không dùng context Kubernetes trên máy Windows.
- Không chạy `kubectl apply -f ~/k8s/staging` hoặc `kubectl apply -R -f k8s`.
- Không apply `k8s/staging/02.secret.yaml` vì file này chỉ chứa placeholder.
- Không in, decode hoặc gửi nội dung Secret. Chỉ kiểm tra tên và type của Secret.
- Không xóa namespace hoặc PVC để chữa Pod `Pending`. Namespace deletion có thể xóa dữ liệu `local-path`.
- Nếu Argo CD đang auto-sync, Job migration có thể chạy lại và tự bị xóa sau khi thành công.

## Trình tự bắt buộc

1. Cập nhật repository (`git pull origin <branch_name>`) và kiểm tra cluster.
2. Chờ namespace cũ xóa hoàn toàn rồi tạo lại namespace.
3. Tạo `backend-secret`, `ghcr` và `vnutour-tls`.
4. Xác nhận node mang label `vnutour/storage=true`.
5. Apply ConfigMap, storage và PostgreSQL; chờ database `Ready`.
6. Dry-run rồi apply overlay staging.
7. Xác nhận migration hoàn thành, backend/frontend `Ready` và Ingress hoạt động.

## 1. Cập nhật repository staging

Nếu repository đã có tại `~/VNUTOUR`:

```bash
cd ~/VNUTOUR
git switch staging
git pull --ff-only origin staging
git status --short --branch
test -f k8s/kustomize/overlays/staging/kustomization.yaml && \
  echo "Staging overlay OK"
```

Nếu controller chưa có repository, clone vào thư mục mới:

```bash
cd ~
git clone --branch staging --single-branch \
  <REPO_GITHUB_URL> VNUTOUR
cd ~/VNUTOUR
```

Không dùng source legacy. Các file `00.namespace.yaml` đến `10.ingress.yaml` từng nằm trong `~/k8s/staging` đã bị xóa khỏi repository hiện tại. Source đúng là `k8s/kustomize/overlays/staging`.

## 2. Kiểm tra cluster và node storage

```bash
sudo k3s kubectl get nodes -o wide
sudo k3s kubectl get storageclass
sudo k3s kubectl get ingressclass
sudo k3s kubectl get nodes -L vnutour/storage
```

- Tất cả node dùng cho workload phải ở trạng thái `Ready`.
- StorageClass `local-path` phải tồn tại.
- IngressClass `nginx` phải tồn tại.
- Ít nhất một worker ổn định phải có label `vnutour/storage=true`.

Nếu worker 1 tại `CONTROLLER_IP_ADDRESS` chưa có label:

```bash
sudo k3s kubectl label node vnutour-w1 \
  vnutour/storage=true --overwrite
```

> Không chuyển label tùy tiện. PVC `local-path` gắn dữ liệu vào một node cụ thể. Nếu PVC cũ còn tồn tại, node affinity của PV quyết định nơi Pod có thể chạy.

## 3. Tạo lại namespace

Nếu namespace vừa bị xóa, chờ đến khi Kubernetes trả về `NotFound`:

```bash
sudo k3s kubectl wait \
  --for=delete namespace/vnutour-staging \
  --timeout=300s
sudo k3s kubectl get namespace vnutour-staging
```

Tạo namespace từ source hiện tại:

```bash
cd ~/VNUTOUR
sudo k3s kubectl apply \
  -f k8s/kustomize/base/00.namespace.yaml

sudo k3s kubectl wait \
  --for=jsonpath='{.status.phase}'=Active \
  namespace/vnutour-staging --timeout=60s
```

> **Hệ quả của namespace deletion:** Tất cả Secret và PVC namespaced được yêu cầu xóa. Với `local-path` có reclaim policy `Delete`, dữ liệu PostgreSQL staging cũ có thể không còn. Quy trình này dựng database mới; restore dữ liệu là thao tác riêng.

## 4. Tạo backend secret

Tạo file credential ngoài Git với quyền chỉ root đọc được:

```bash
sudo install -d -m 700 /srv/vnutour

sudo bash -c '
umask 077
DB_PASSWORD=$(openssl rand -hex 32)
DJANGO_SECRET_KEY=$(openssl rand -hex 64)
printf "%s\n" \
  "DB_NAME=<DBNAME>" \
  "DB_USER=<DBUSER>" \
  "DB_PASSWORD=<DBPASS>" \
  "DJANGO_SECRET_KEY=<DJANGOSECRETKEY>" \
  > /srv/vnutour/.env.staging
'
```

Kiểm tra quyền và chỉ xem tên biến:

```bash
sudo ls -l /srv/vnutour/.env.staging
sudo cut -d= -f1 /srv/vnutour/.env.staging
```

Tạo Kubernetes Secret:

```bash
sudo k3s kubectl -n vnutour-staging \
  create secret generic backend-secret \
  --from-env-file=/srv/vnutour/.env.staging \
  --dry-run=client -o yaml |
sudo k3s kubectl apply -f -

sudo k3s kubectl -n vnutour-staging \
  get secret backend-secret
```

## 5. Lấy GHCR pull secret

Lấy Docker registry Secret từ namespace `vnutour` sang `vnutour-staging`.

```bash
sudo k3s kubectl -n vnutour get secret ghcr \
  -o 'custom-columns=NAME:.metadata.name,TYPE:.type'

sudo k3s kubectl -n vnutour get secret ghcr \
  -o jsonpath='{.data.\.dockerconfigjson}' |
base64 -d |
sudo k3s kubectl -n vnutour-staging \
  create secret generic ghcr \
  --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson=/dev/stdin \
  --dry-run=client -o yaml |
sudo k3s kubectl apply -f -
```

Gắn Secret vào ServiceAccount mặc định:

```bash
sudo k3s kubectl -n vnutour-staging \
  patch serviceaccount default --type=merge \
  -p '{"imagePullSecrets":[{"name":"ghcr"}]}'

sudo k3s kubectl -n vnutour-staging \
  get serviceaccount default \
  -o jsonpath='{.imagePullSecrets[*].name}{"\n"}'
```

## 6. Kiểm tra và copy TLS secret

Kiểm tra SAN của certificate production mà không đọc private key:

```bash
sudo k3s kubectl -n vnutour get secret vnutour-tls \
  -o jsonpath='{.data.tls\.crt}' |
base64 -d |
openssl x509 -noout -subject -dates -ext subjectAltName
```

Certificate đã kiểm tra có `DNS:*.<YOUR_DOMAIN>` và `DNS:<YOUR_DOMAIN>`, vì vậy bao phủ hostname `<APP_SUBDOMAIN>.<YOUR_DOMAIN>`. Copy Secret mà không in private key:

```bash
sudo k3s kubectl -n vnutour get secret vnutour-tls -o json |
jq '
  del(
    .metadata.creationTimestamp,
    .metadata.resourceVersion,
    .metadata.uid,
    .metadata.managedFields,
    .metadata.ownerReferences
  )
  | .metadata.namespace = "vnutour-staging"
' |
sudo k3s kubectl apply -f -
```

Xác nhận đủ ba Secret:

```bash
sudo k3s kubectl -n vnutour-staging get secret \
  backend-secret ghcr vnutour-tls
```

## 7. Khởi động ConfigMap, storage và PostgreSQL

Apply dependency trước khi chạy migration:

```bash
cd ~/VNUTOUR

sudo k3s kubectl apply \
  -f k8s/kustomize/base/01.configmap.yaml

sudo k3s kubectl apply \
  -f k8s/kustomize/base/03.storage.yaml

sudo k3s kubectl apply \
  -f k8s/kustomize/components/db-simple/postgres.yaml
```

Chờ PostgreSQL `Ready`:

```bash
sudo k3s kubectl -n vnutour-staging \
  rollout status statefulset/postgres \
  --timeout=300s

sudo k3s kubectl -n vnutour-staging \
  get pods,pvc -o wide
```

- `postgres-0` phải đạt `1/1 Running`.
- `postgres-data` phải đạt `Bound`.
- `media-data` có thể còn `Pending` do `local-path` dùng `WaitForFirstConsumer`; PVC sẽ bind khi backend được scheduler đặt lên node.

## 8. Dry-run và apply overlay staging

Render và kiểm tra phía API server:

```bash
cd ~/VNUTOUR

sudo k3s kubectl kustomize \
  k8s/kustomize/overlays/staging \
  > /tmp/vnutour-staging.yaml

grep 'image:' /tmp/vnutour-staging.yaml

sudo k3s kubectl apply --dry-run=server \
  -k k8s/kustomize/overlays/staging
```

Nếu dry-run không có `Error`, apply thật:

```bash
sudo k3s kubectl -n vnutour-staging \
  delete job vnutour-migrate --ignore-not-found

sudo k3s kubectl apply \
  -k k8s/kustomize/overlays/staging
```

Theo dõi Pod:

```bash
sudo k3s kubectl -n vnutour-staging get pods -w
```

### Migration và Argo CD

Khi apply trực tiếp, Kubernetes tạo Job cùng backend/frontend. Nếu Application `vnutour-staging` đang auto-sync, Argo CD có thể xóa Job đầu và tạo lại PreSync hook. Việc thấy hai migration Pod hoàn thành một lần trong quá trình reconcile là có thể xảy ra.

Hook policy `HookSucceeded` tự xóa Job và Pod sau khi thành công. Vì vậy lệnh `logs job/vnutour-migrate` có thể trả `NotFound` sau khi đã thấy trạng thái `Completed`; đây không phải lỗi.

## 9. Kiểm tra rollout

```bash
sudo k3s kubectl -n vnutour-staging \
  rollout status deployment/frontend --timeout=300s

sudo k3s kubectl -n vnutour-staging \
  rollout status deployment/backend --timeout=300s

sudo k3s kubectl -n vnutour-staging \
  get pods,pvc,svc,ingress -o wide
```

## 10. Xử lý backend Pending do thiếu memory

Sự cố đã quan sát: scheduler báo `0/3 nodes are available`, trong đó một node `Insufficient memory` và hai node không khớp node selector. `media-data` tiếp tục `Pending` vì đang chờ backend được schedule.

Thu thập bằng chứng:

```bash
BACKEND_POD=$(sudo k3s kubectl -n vnutour-staging \
  get pod -l app=backend \
  -o jsonpath='{.items[0].metadata.name}')

sudo k3s kubectl -n vnutour-staging \
  describe pod "$BACKEND_POD" |
sed -n '/Events:/,$p'

sudo k3s kubectl -n vnutour-staging \
  describe pvc media-data
```

### 10.1. Phương án dùng worker 2

Chỉ dùng khi `vnutour-w2` đang `Ready`, còn đủ RAM và sẽ được bật ổn định. Label này cho phép backend staging và PVC `media-data` mới được đặt tại worker 2.

```bash
sudo k3s kubectl get nodes -o wide \
  -L vnutour/storage
sudo k3s kubectl top nodes

sudo k3s kubectl label node vnutour-w2 \
  vnutour/storage=true --overwrite

sudo k3s kubectl -n vnutour-staging \
  get pods,pvc -w
```

PostgreSQL vẫn ở worker 1 vì `postgres-data` đã bind vào volume tại đó. Khi `media-data` bind vào worker 2, không tắt worker 2 nếu muốn staging backend tiếp tục hoạt động.

### 10.2. Phương án giữ backend trên worker 1

Giải phóng hoặc tăng RAM cho `vnutour-w1`. Scheduler xét memory request đã cấp, không chỉ lượng RAM thực tế đang dùng. Không giảm request của backend nếu chưa đo tải và kiểm tra giới hạn an toàn.

```bash
sudo k3s kubectl describe node vnutour-w1 |
sed -n '/Allocated resources:/,/Events:/p'

sudo k3s kubectl get pods -A \
  --field-selector spec.nodeName=vnutour-w1 \
  -o 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,STATUS:.status.phase'
```

## 11. Xác nhận hoàn tất

```bash
sudo k3s kubectl -n vnutour-staging \
  get pods,deploy,sts,svc,pvc,ingress -o wide

sudo k3s kubectl -n vnutour-staging get deployment \
  -o wide

sudo k3s kubectl -n vnutour-staging get events \
  --sort-by=.lastTimestamp
```

Đạt yêu cầu khi:

| Tài nguyên      | Trạng thái đạt                  | Ghi chú                                     |
| --------------- | ------------------------------- | ------------------------------------------- |
| `postgres-0`    | `1/1 Running`                   | Database staging sẵn sàng                   |
| `postgres-data` | `Bound`                         | Không xóa khi xử lý sự cố                   |
| `media-data`    | `Bound`                         | Bind theo node chạy backend                 |
| `backend`       | `Ready 1`                       | Không còn `Pending` hoặc `ImagePullBackOff` |
| `frontend`      | `Ready 1`                       | Frontend phục vụ qua Service                |
| migration       | `Completed` hoặc đã bị Argo xóa | `HookSucceeded` dọn Job thành công          |
| Ingress         | Có địa chỉ và TLS Secret        | Host `<APP_SUBDOMAIN>.<YOUR_DOMAIN>`        |

Kiểm tra public endpoint khi DNS và Cloudflare đã đúng:

```bash
curl -I https://<APP_SUBDOMAIN>.<YOUR_DOMAIN>
```

## 12. Bảng xử lý lỗi nhanh

| Triệu chứng                  | Nguyên nhân thường gặp                                | Kiểm tra hoặc xử lý                                             |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Namespace `Terminating`      | Namespace deletion chưa hoàn tất                      | Chờ `kubectl wait --for=delete`; không apply tiếp               |
| `ImagePullBackOff`           | Thiếu hoặc sai `ghcr` Secret; tag không tồn tại       | Describe Pod; kiểm tra `ghcr` và `imagePullSecrets`             |
| Backend `Pending`            | Node selector chỉ khớp node hết RAM                   | Describe Pod; kiểm tra `Allocated resources`; cân nhắc worker 2 |
| `media-data` Pending         | `WaitForFirstConsumer` đang chờ backend schedule      | Sửa scheduling backend; không xóa PVC                           |
| Migration Job `NotFound`     | Argo đã dọn `HookSucceeded`                           | Nếu trước đó đã thấy `Completed` thì không chạy lại             |
| `CreateContainerConfigError` | Thiếu `backend-secret` hoặc ConfigMap                 | Kiểm tra tên resource trong đúng namespace                      |
| TLS lỗi                      | Thiếu `vnutour-tls` hoặc hostname không nằm trong SAN | Kiểm tra Secret type và `openssl subjectAltName`                |
| Pod Pending sau relabel      | Node thiếu RAM hoặc PV node affinity                  | Describe Pod và PVC; không xóa PV/PVC                           |

## 13. Quy trình vận hành về sau

Sau khi bootstrap thành công, Git branch `staging` và Argo CD là nguồn trạng thái mong muốn. Thay đổi manifest cần được commit vào đúng source Kustomize; không duy trì bản YAML rời trên controller. Khi cập nhật image, CI ghi tag vào overlay staging và Argo CD reconcile cluster.

- Dùng `kubectl` để quan sát, bootstrap dependency và xử lý sự cố có kiểm soát.
- Dùng Git và Argo CD cho thay đổi lâu dài.
- Giữ `/srv/vnutour/.env.staging` ngoài repository và giới hạn quyền `600`.
- Theo dõi dung lượng RAM của worker 1 và worker 2 trước mỗi lần rollout.
- Không dùng namespace deletion như thao tác restart.
