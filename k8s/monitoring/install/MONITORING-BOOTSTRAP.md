# Prometheus và Grafana trên VPS k3s

Monitoring được triển khai qua workflow [Bootstrap VPS Baseline](../../../.github/workflows/bootstrap-baseline.yml). Pipeline kiểm tra công cụ trên runner, gửi payload qua SSH đã xác minh host key, rồi chạy [install.sh](install.sh) trên VPS. ArgoCD UI và monitoring ở chung một workflow nhưng dùng step và script độc lập để có log, retry và phạm vi lỗi rõ ràng.

## Cấu hình GitHub Actions

Vào **Settings → Secrets and variables → Actions**:

| Tên                      | Loại               | Mục đích                                                 |
| ------------------------ | ------------------ | -------------------------------------------------------- |
| `GRAFANA_ADMIN_PASSWORD` | Secret             | Mật khẩu Grafana ban đầu, 16–128 ký tự, không xuống dòng |
| `VPS_SSH_HOST`           | Secret             | IP/hostname VPS                                          |
| `VPS_SSH_PASSWORD`       | Secret             | Mật khẩu SSH                                             |
| `VPS_SSH_KNOWN_HOSTS`    | Secret             | Host key đã xác minh của VPS                             |
| `VPS_SSH_USER`           | Variable           | `root` hoặc user có `sudo -n`                            |
| `VPS_SSH_PORT`           | Variable, tùy chọn | Mặc định`22`                                             |

Workflow tự chạy trên `main` và chỉ reconcile dịch vụ có file thay đổi; nếu chính workflow chung thay đổi thì chạy cả hai. Khi chạy thủ công, hai input `deploy_argocd` và `deploy_monitoring` cho phép chọn riêng từng dịch vụ. Khi cả hai được chọn, ArgoCD chạy trước để xác nhận ingress-nginx và cert-manager; monitoring hiện vẫn là ClusterIP và chưa phụ thuộc ingress.

## Cài đặt và kiểm tra

1. VPS cần có k3s đang chạy, kubeconfig `/etc/rancher/k3s/k3s.yaml`, `root` hoặc `sudo -n`, và Internet tới Helm OCI registry/image registries. Script giữ công cụ đã có; nếu thiếu curl, jq, tar, gzip hoặc coreutils thì cài đúng package còn thiếu bằng apt. Nếu thiếu Helm, script cài Helm 4.3.0 AMD64 đã cố định và kiểm tra SHA-256. Script không tự cài hoặc nâng k3s. Chart yêu cầu Kubernetes >= 1.25.
2. Clone/cập nhật repo trên VPS, vào thư mục repo và kiểm tra đúng cụm, tài nguyên:

   ```bash
   sudo k3s kubectl get nodes -o wide
   sudo k3s kubectl get storageclass
   sudo k3s kubectl top nodes
   free -h
   df -h /var/lib/rancher/k3s
   ```

   `top` cần metrics-server. Cấu hình khởi điểm dành cho cụm nhỏ: Prometheus request 512Mi, limit 1536Mi; Grafana request 128Mi, limit 384Mi; PVC 10Gi + 1Gi; lưu tối đa 7 ngày hoặc 6GB blocks, điều kiện nào đến trước. WAL/head còn dùng đĩa ngoài 6GB. Cần chừa RAM cho k3s, ứng dụng, các exporter/sidecar và dung lượng cho OS/image/log. Đây không phải cam kết VPS 2GB chạy đủ stack. Chỉnh [values.yaml](values.yaml) theo dung lượng thực tế trước khi cài.

3. Cách vận hành chính là chạy **Actions → Bootstrap VPS Baseline**, chọn `deploy_monitoring=true`. Để chạy thủ công ngay trên VPS trong tình huống khôi phục, tạo file mật khẩu chỉ root đọc rồi gọi script:

   ```bash
   sudo bash -c 'umask 077; read -r -s -p "Grafana password: " password; echo; printf "%s" "$password" > /tmp/grafana-admin-password'
   sudo GRAFANA_ADMIN_PASSWORD_FILE=/tmp/grafana-admin-password \
     bash k8s/monitoring/install/install.sh
   sudo rm -f /tmp/grafana-admin-password
   ```

   Xóa file tạm sau khi hoàn tất. Script in context/node, kiểm tra `local-path`, namespace, Helm release, đủ 10 Prometheus Operator CRD, Secret và dashboard ConfigMap. Namespace/Secret thiếu sẽ được tạo; tài nguyên đã có được giữ hoặc reconcile. Helm `upgrade --install` tạo resource chart còn thiếu và cập nhật values mà không tạo trùng. Nếu gặp legacy workload, CRD dở dang, CRD không có release sở hữu hoặc chart khác phiên bản, script dừng để tránh ghi đè. Có lỗi thì không tự rollback hoặc xóa PVC.

   Pipeline truyền `GRAFANA_ADMIN_PASSWORD_FILE` bằng payload tạm có quyền hạn chế và xóa cả runner/VPS payload khi kết thúc. Không commit file mật khẩu. Lần chạy sau giữ Secret hiện có. Mật khẩu chỉ khởi tạo DB Grafana lần đầu: đổi GitHub Secret hoặc restart không tự đổi mật khẩu trong DB đã có. Đổi mật khẩu qua UI/CLI Grafana rồi đồng bộ Secret bằng quy trình rotation riêng.

4. Trên VPS, mở hai terminal SSH và giữ các lệnh sau chạy:

   ```bash
   # Terminal 1: Grafana
   sudo k3s kubectl -n monitoring port-forward --address 127.0.0.1 svc/monitoring-grafana 3000:80
   ```

   ```bash
   # Terminal 2: Prometheus
   sudo k3s kubectl -n monitoring port-forward --address 127.0.0.1 svc/monitoring-prometheus 9090:9090
   ```

5. Trên máy cá nhân, mở SSH tunnel (thay user/IP bằng thông tin VPS):

   ```bash
   ssh -N -o ExitOnForwardFailure=yes -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 <SSH_USER>@<VPS_IP>
   ```

   Mở [Grafana](http://localhost:3000), đăng nhập `admin` cùng mật khẩu bước 3; mở [Prometheus](http://localhost:9090). `localhost` của VPS và máy cá nhân khác nhau, vì vậy cần cả port-forward và SSH tunnel. Nếu máy cá nhân đã có kubeconfig truy cập API server, có thể chạy hai lệnh `kubectl port-forward` trực tiếp trên máy cá nhân và bỏ SSH tunnel. Không cần mở cổng public 3000/9090.

6. Xác minh sau 2–3 phút:
   - Pod Ready, PVC Bound: `sudo k3s kubectl -n monitoring get pods,pvc`.
   - Prometheus → **Status → Target health**: kubelet/cAdvisor, node-exporter, kube-state-metrics có trạng thái UP.
   - Query `up`, `count(container_cpu_usage_seconds_total)`, `count(container_memory_working_set_bytes)`, `count(node_memory_MemTotal_bytes)`, `count(kube_pod_info)` trả dữ liệu.
   - Grafana datasource **Prometheus** kết nối thành công; dashboard **K3S cluster monitoring** có dữ liệu CPU/RAM khi chọn Node/Namespace, khoảng thời gian 15 phút.
   - Nếu pod Pending: `sudo k3s kubectl -n monitoring describe pod <POD>`; nếu PVC Pending, kiểm tra provisioner local-path/node scheduling. Nếu target DOWN, xem lỗi target và đường mạng/TLS tới kubelet; Pod Ready chưa chứng minh scrape thành công.

## Dashboard 15282 và phạm vi metrics

[Dashboard 15282](https://grafana.com/grafana/dashboards/15282-k8s-rke-cluster-monitoring/) có tên **K3S cluster monitoring**, dù slug URL còn `k8s-rke`. Script cố định revision **1**, xác minh checksum và thay `${DS_PROMETHEUS}` bằng datasource UID `prometheus`. Grafana sidecar tự nạp ConfigMap `monitoring-dashboard-15282`, không cần import thủ công. Các dashboard mặc định của chart vẫn được giữ.

Dashboard dùng cAdvisor, có cả query root/system cgroups và `container_spec_*`. Vì chart mặc định lọc bỏ một phần metrics đó, values đặt `cAdvisorMetricRelabelings: []`. Việc này tăng lượng series; theo dõi RAM/disk Prometheus. Kubelet/cAdvisor mới có thể không xuất một số metrics cũ: panel systemd/filesystem trống cần kiểm tra query và metric thật, không thể đảm bảo mọi panel của revision 1 đều tương thích chỉ nhờ cài chart. Nếu sửa hoặc thay revision JSON trong repo, script dừng do checksum thay đổi; review file mới rồi cập nhật checksum cùng thay đổi đó.

Stack gồm Prometheus Operator, Prometheus, Grafana, kube-state-metrics và node-exporter. Node-exporter dùng Pod IP, không bind 9100 vào host network. Các scrape target scheduler/controller-manager/proxy/etcd kiểu Kubernetes tiêu chuẩn được tắt trong profile này vì k3s tích hợp các thành phần đó và chưa cấu hình endpoint riêng. Kubelet/cAdvisor/API server vẫn được theo dõi. Chưa có Alertmanager/receiver gửi thông báo.

Đây là monitoring cấp cluster. Script không chuyển các rule riêng Django/Postgres hay annotation-based discovery trong `14.prometheus.yaml` sang ServiceMonitor/PrometheusRule. Các file cũ ghim node homelab và dùng tài nguyên riêng; nếu đã chạy chúng trên VPS, cần kiểm kê/backup và lập kế hoạch migration trước. Script không xóa hoặc chuyển dữ liệu cũ.

## Vận hành lâu dài và bước ingress sau

- Chạy lại script để reconcile cùng phiên bản/config. `--reset-values` lấy cấu hình Git làm nguồn chính; không giữ thay đổi `helm --set` ngoài repo. Sau này ingress/root_url phải được lưu trong values hoặc bổ sung overlay vào chính script, nếu không lần chạy lại sẽ tắt ingress.
- PVC `local-path` giữ dữ liệu qua pod restart nhưng gắn với node/đĩa VPS; không phải HA hoặc backup. Đặt lịch backup dữ liệu cần giữ, nhất là Grafana DB và cấu hình. Không xóa PVC/namespace để sửa lỗi đăng nhập.
- Nâng chart là một thay đổi có kiểm tra [upgrade notes và CRDs](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack#upgrading-chart). Helm không tự nâng CRDs theo chart. Script chặn phiên bản release khác; cần quy trình nâng cấp riêng, không chỉ sửa version rồi chạy lại.
- Sau khi port-forward và login/data đã thành công, triển khai theo [ArgoCD bootstrap](../../argocd/ui/ARGOCD-BOOTSTRAP.md): IngressClass `nginx`, dùng lại `ClusterIssuer letsencrypt-prod`, tạo Certificate/TLS Secret riêng **trong namespace monitoring**, backend `monitoring-grafana:80` qua **HTTP**, TLS kết thúc ở NGINX. Không sao chép `backend-protocol: HTTPS` của ArgoCD vì backend Grafana hiện phục vụ HTTP.
- Dùng hostname Grafana đã chuẩn bị để đặt `grafana.ini.server.domain`, `root_url=https://<GRAFANA_HOSTNAME>/`, bật cookie secure cùng ingress/TLS. Giữ anonymous và sign-up tắt; giữ Secret admin đã tạo. Không public Prometheus. Hostname cụ thể chưa xuất hiện trong yêu cầu này; nhập chính xác khi triển khai bước ingress.

Nguồn: [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack), [k3s metrics](https://docs.k3s.io/reference/metrics).
