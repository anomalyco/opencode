# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart for deploying OpenCode AI assistant server on Kubernetes.

## 描述

此 Helm Chart 在 Kubernetes 叢集上安裝 OpenCode AI 助手伺服器。OpenCode 是一款軟體開發 AI 助手，可透過 Language Server Protocol (LSP) 與程式碼編輯器整合。

## 前置需求

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx 或 traefik)

## 安裝

### 新增儲存庫

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### 基本安裝

```bash
helm install opencode opencode/opencode
```

### 自訂值安裝

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### 使用 values file 安裝

```bash
helm install opencode opencode/opencode -f values.yaml
```

## 配置

請參考 `values.yaml` 檔案了解所有可設定參數。

### 主要參數

| 參數                 | 說明                  | 預設值                       |
| -------------------- | --------------------- | ---------------------------- |
| `image.repository`   | Docker 映像檔         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | 映像檔標籤            | `dev-alpine`                 |
| `replicaCount`       | 副本數量              | `1`                          |
| `service.type`       | Service 類型          | `ClusterIP`                  |
| `service.port`       | Service 連接埠        | `80`                         |
| `service.targetPort` | 容器的連接埠          | `4096`                       |
| `server.port`        | Opencode 伺服器連接埠 | `4096`                       |

### 驗證

| 參數                  | 說明          | 預設值     |
| --------------------- | ------------- | ---------- |
| `auth.enabled`        | 啟用驗證      | `false`    |
| `auth.username`       | 使用者名稱    | `opencode` |
| `auth.password`       | 密碼          | `""`       |
| `auth.existingSecret` | 現有的 Secret | `""`       |

### Session Affinity

| 參數                  | 說明                       | 預設值             |
| --------------------- | -------------------------- | ------------------ |
| `affinity.enabled`    | 啟用 sticky sessions       | `true`             |
| `affinity.cookieName` | Cookie 名稱                | `OPENCODEAFFINITY` |
| `affinity.mode`       | 模式 (balanced/persistent) | `balanced`         |
| `affinity.type`       | 類型 (cookie)              | `cookie`           |

### 持久化

| 參數                            | 說明         | 預設值          |
| ------------------------------- | ------------ | --------------- |
| `persistence.data.enabled`      | 資料 PVC     | `false`         |
| `persistence.data.storageClass` | StorageClass | `""`            |
| `persistence.data.accessMode`   | 存取模式     | `ReadWriteOnce` |
| `persistence.data.size`         | 大小         | `1Gi`           |
| `persistence.cache.enabled`     | 快取 PVC     | `false`         |
| `persistence.config.enabled`    | 設定 PVC     | `false`         |

### ConfigMaps

| 參數                         | 說明           | 預設值  |
| ---------------------------- | -------------- | ------- |
| `configMaps.agents.enabled`  | 掛載 AGENTS.md | `false` |
| `configMaps.agents.data`     | ConfigMap 內容 | `{}`    |
| `configMaps.docs.enabled`    | 掛載文件       | `false` |
| `configMaps.docs.data`       | ConfigMap 內容 | `{}`    |
| `configMaps.plugins.enabled` | 掛載外掛       | `false` |
| `configMaps.plugins.data`    | ConfigMap 內容 | `{}`    |

### 資源

| 參數                        | 說明       | 預設值  |
| --------------------------- | ---------- | ------- |
| `resources.requests.cpu`    | CPU 請求   | `100m`  |
| `resources.requests.memory` | 記憶體請求 | `128Mi` |
| `resources.limits.cpu`      | CPU 限制   | `2000m` |
| `resources.limits.memory`   | 記憶體限制 | `2Gi`   |

## 配置範例

### 基本範例

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### 驗證範例

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### 持久化範例

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

### 停用 session affinity 範例

```yaml
affinity:
  enabled: false
```

### 完整 Ingress 範例

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

當有多個副本時，OpenCode 需要 sticky sessions (session affinity) 才能正常運作。這是因為伺服器會維護與客戶端的連線狀態。

### Nginx Ingress

對於 Nginx Ingress，當 `affinity.enabled: true` 時，sticky sessions 會自動設定。Chart 會自動設定必要的 annotations：

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # 或 persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

對於 Traefik，請確保設定 sticky sessions middleware：

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Affinity 模式

- **balanced**: 請求均勻分配到可用的後端
- **persistent**: 請求盡可能導向同一個後端

## 掛載磁碟

Chart 會掛載以下磁碟：

| 路徑                          | 說明          |
| ----------------------------- | ------------- |
| `/root/.config/opencode`      | 設定目錄      |
| `/root/.cache/opencode`       | Opencode 快取 |
| `/root/.local/share/opencode` | Opencode 資料 |

## 環境變數

可透過 `env` 設定以下環境變數：

| 變數                    | 說明         | 預設值                   |
| ----------------------- | ------------ | ------------------------ |
| `PORT`                  | 伺服器連接埠 | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | 設定目錄     | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS 網域    | `local`                  |
| `OPENCODE_MDNS_ENABLED` | 啟用 mDNS    | `false`                  |

環境變數設定範例：

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## 附加功能

### Autoscaling

可以啟用 HPA (Horizontal Pod Autoscaler)：

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

### 額外磁碟

若要掛載額外磁碟：

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## 規劃

- [ ] 支援 cert-manager 自動 TLS
- [ ] 雲端供應商配置範例
- [ ] 整合 Prometheus/Grafana 監控
- [ ] PostgreSQL 部署模板
- [ ] 支援 Helm tests

## 貢獻

歡迎貢獻！請在 [GitHub](https://github.com/anomalyco/opencode) 提交 PR 或開啟 issue。

## 授權

Apache License 2.0 - 詳情請參考 [LICENSE](LICENSE) 檔案。
