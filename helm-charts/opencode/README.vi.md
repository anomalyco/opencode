# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart để triển khai máy chủ AI assistant OpenCode trên Kubernetes.

## Mô tả

Helm chart này cài đặt máy chủ OpenCode AI Assistant trên cluster Kubernetes. OpenCode là một trợ lý AI cho phát triển phần mềm có thể được tích hợp với trình soạn thảo mã qua Language Server Protocol (LSP).

## Điều kiện tiên quyết

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx hoặc traefik)

## Cài đặt

### Thêm repository

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Cài đặt cơ bản

```bash
helm install opencode opencode/opencode
```

### Cài đặt với giá trị tùy chỉnh

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Cài đặt với values file

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Cấu hình

Tham khảo file `values.yaml` để xem tất cả các tham số có thể cấu hình.

### Các tham số chính

| Tham số              | Mô tả                 | Giá trị mặc định             |
| -------------------- | --------------------- | ---------------------------- |
| `image.repository`   | Docker image          | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Image tag             | `dev-alpine`                 |
| `replicaCount`       | Số lượng replica      | `1`                          |
| `service.type`       | Loại service          | `ClusterIP`                  |
| `service.port`       | Cổng service          | `80`                         |
| `service.targetPort` | Cổng container        | `4096`                       |
| `server.port`        | Cổng máy chủ opencode | `4096`                       |

### Xác thực

| Tham số               | Mô tả          | Giá trị mặc định |
| --------------------- | -------------- | ---------------- |
| `auth.enabled`        | Bật xác thực   | `false`          |
| `auth.username`       | Username       | `opencode`       |
| `auth.password`       | Password       | `""`             |
| `auth.existingSecret` | Secret hiện có | `""`             |

### Session Affinity

| Tham số               | Mô tả                        | Giá trị mặc định   |
| --------------------- | ---------------------------- | ------------------ |
| `affinity.enabled`    | Bật sticky sessions          | `true`             |
| `affinity.cookieName` | Tên cookie                   | `OPENCODEAFFINITY` |
| `affinity.mode`       | Chế độ (balanced/persistent) | `balanced`         |
| `affinity.type`       | Loại (cookie)                | `cookie`           |

### Persistence

| Tham số                         | Mô tả           | Giá trị mặc định |
| ------------------------------- | --------------- | ---------------- |
| `persistence.data.enabled`      | PVC cho dữ liệu | `false`          |
| `persistence.data.storageClass` | StorageClass    | `""`             |
| `persistence.data.accessMode`   | Chế độ truy cập | `ReadWriteOnce`  |
| `persistence.data.size`         | Kích thước      | `1Gi`            |
| `persistence.cache.enabled`     | PVC cho cache   | `false`          |
| `persistence.config.enabled`    | PVC cho config  | `false`          |

### ConfigMaps

| Tham số                      | Mô tả              | Giá trị mặc định |
| ---------------------------- | ------------------ | ---------------- |
| `configMaps.agents.enabled`  | Mount AGENTS.md    | `false`          |
| `configMaps.agents.data`     | Nội dung ConfigMap | `{}`             |
| `configMaps.docs.enabled`    | Mount tài liệu     | `false`          |
| `configMaps.docs.data`       | Nội dung ConfigMap | `{}`             |
| `configMaps.plugins.enabled` | Mount plugins      | `false`          |
| `configMaps.plugins.data`    | Nội dung ConfigMap | `{}`             |

### Tài nguyên

| Tham số                     | Mô tả          | Giá trị mặc định |
| --------------------------- | -------------- | ---------------- |
| `resources.requests.cpu`    | CPU request    | `100m`           |
| `resources.requests.memory` | Memory request | `128Mi`          |
| `resources.limits.cpu`      | CPU limit      | `2000m`          |
| `resources.limits.memory`   | Memory limit   | `2Gi`            |

## Ví dụ cấu hình

### Ví dụ cơ bản

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Ví dụ với xác thực

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Ví dụ với persistence

```yaml
persistence:
  data:
    enabled: true
    storageClass: "standard"
    size: 5Gi
  cache:
    enabled: true
    storageClass: "standard"
    size: 2Gi
```

### Ví dụ với session affinity bị tắt

```yaml
affinity:
  enabled: false
```

### Ví dụ đầy đủ với Ingress

```yaml
replicaCount: 2

image:
  tag: latest

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: opencode.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: opencode-tls
      hosts:
        - opencode.example.com

auth:
  enabled: true
  username: admin
  password: securepassword

affinity:
  enabled: true
  cookieName: OPENCODEAFFINITY
  mode: balanced

persistence:
  data:
    enabled: true
    size: 5Gi
```

## Session Affinity

OpenCode yêu cầu sticky sessions (session affinity) để hoạt động đúng khi có nhiều replica. Điều này cần thiết vì máy chủ duy trì trạng thái kết nối với client.

### Nginx Ingress

Với Nginx Ingress, cấu hình sticky sessions được tự động khi `affinity.enabled: true`. Chart tự động cấu hình các annotations cần thiết:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # hoặc persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Với Traefik, đảm bảo cấu hình middleware sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Các chế độ Affinity

- **balanced**: Các request được phân bổ đều giữa các backend có sẵn
- **persistent**: Các request luôn được chuyển đến cùng một backend khi có thể

## Volumes

Chart mount các volume sau:

| Path                          | Mô tả                |
| ----------------------------- | -------------------- |
| `/root/.config/opencode`      | Thư mục cấu hình     |
| `/root/.cache/opencode`       | Cache của opencode   |
| `/root/.local/share/opencode` | Dữ liệu của opencode |

## Biến môi trường

Các biến môi trường sau có thể được cấu hình qua `env`:

| Biến                    | Mô tả            | Giá trị mặc định         |
| ----------------------- | ---------------- | ------------------------ |
| `PORT`                  | Cổng máy chủ     | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Thư mục cấu hình | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Domain mDNS      | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Bật mDNS         | `false`                  |

Ví dụ cấu hình biến môi trường:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Tài nguyên bổ sung

### Autoscaling

HPA (Horizontal Pod Autoscaler) có thể được bật:

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### Security Context

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### Extra Volumes

Để mount thêm volumes:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Lộ trình

- [ ] Hỗ trợ TLS tự động với cert-manager
- [ ] Ví dụ cấu hình cho các nhà cung cấp cloud
- [ ] Tích hợp Prometheus/Grafana cho metrics
- [ ] Templates cho deployment với PostgreSQL
- [ ] Hỗ trợ Helm tests

## Đóng góp

Đóng góp luôn được chào đón! Vui lòng gửi PR hoặc tạo issue tại [GitHub](https://github.com/anomalyco/opencode).

## Giấy phép

Apache License 2.0 - xem [LICENSE](LICENSE) để biết chi tiết.
