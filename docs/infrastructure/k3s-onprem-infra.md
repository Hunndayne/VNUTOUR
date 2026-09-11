# Hạ tầng K3s on-premises - VNU Tour

> ![NOTE]
> Hạ tầng gồm ba zone: homelab trên Proxmox là khu vực chính, Linode là khu vực dự phòng có một node K3s, và RackNerd là nơi đặt máy backup cơ sở dữ liệu. Các zone kết nối với nhau qua WireGuard.

## 1. Tổng quan các zone

![Kiến trúc k3s on-prem cho trang web VNU Tour](/assets/image/vnutour-k3s-infra.jpg)

| Zone   | Nền tảng / vị trí | Vai trò theo sơ đồ   | Thành phần                                                |
| ------ | ----------------- | -------------------- | --------------------------------------------------------- |
| Zone 1 | Homelab - Proxmox | Primary              | 1 K3s controller, 2 K3s worker; tên miền `vpn.hunn.io.vn` |
| Zone 2 | Cloud - Linode    | Backup               | 1 K3s node                                                |
| Zone 3 | RackNerd          | Backup cơ sở dữ liệu | 1 máy DB backup                                           |

### Zone 1 - Homelab (Proxmox)

- Zone 1 là khu vực chính, được gắn nhãn `vpn.hunn.io.vn (primary)` trong sơ đồ. Các máy K3s có địa chỉ LAN như sau:

| Thành phần     | Địa chỉ IP      | Vai trò theo sơ đồ                 |
| -------------- | --------------- | ---------------------------------- |
| K3s controller | `192.168.1.110` | Controller của cụm K3s tại homelab |
| K3s worker 1   | `192.168.1.111` | Worker 1                           |
| K3s worker 2   | `192.168.1.112` | Worker 2                           |

### Zone 2 - Linode (backup)

| Thành phần | Địa chỉ IP trong sơ đồ | Vai trò theo sơ đồ         |
| ---------- | ---------------------- | -------------------------- |
| K3s node   | `172.104.186.118`      | Node K3s tại zone dự phòng |

- Zone 2 là một VPS ở ngoài homelab và có kết nối WireGuard với Zone 1 và Zone 3.

### Zone 3 - RackNerd

| Thành phần | Địa chỉ IP trong sơ đồ | Vai trò theo sơ đồ       |
| ---------- | ---------------------- | ------------------------ |
| DB backup  | `107.175.69.19`        | Máy backup cơ sở dữ liệu |

- Zone 3 tương tư là một VPS bên ngoài và có kết nối WireGuard với Zone 1 và Zone 2.

## 2. Phạm vi dự phòng được thể hiện

- **Khu vực chính:** Zone 1 chứa một controller và hai worker K3s trên hạ tầng Proxmox.
- **Khu vực dự phòng:** Zone 2 được gắn nhãn backup và có một node K3s.
- **Backup cơ sở dữ liệu:** Zone 3 có máy được gắn nhãn DB backup.
