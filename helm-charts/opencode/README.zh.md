# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

用于在 Kubernetes 上部署 OpenCode AI 助手服务器的 Helm Chart。

## 描述

此 Chart 在 Kubernetes 集群中安装 OpenCode AI 助手服务器。OpenCode 是一个软件开发 AI 助手，可以通过语言服务器协议（LSP）与代码编辑器集成。

## 前置条件

- Kubernetes 1.19+
- Helm 3+
- Ingress 控制器（nginx 或 traefik）

## 安装

### 添加仓库

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### 基本安装

```bash
helm install opencode opencode/opencode
```

### 自定义值安装

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### 使用 values 文件安装

```bash
helm install opencode opencode/opencode -f values.yaml
```

## 配置

请参阅 `values.yaml` 文件以查看所有可配置参数。

### 主要参数

| 参数                 | 描述                | 默认值                       |
| -------------------- | ------------------- | ---------------------------- |
| `image.repository`   | Docker 镜像         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | 镜像标签            | `dev-alpine`                 |
| `replicaCount`       | 副本数量            | `1`                          |
| `service.type`       | Service 类型        | `ClusterIP`                  |
| `service.port`       | Service 端口        | `80`                         |
| `service.targetPort` | 容器端口            | `4096`                       |
| `server.port`        | opencode 服务器端口 | `4096`                       |

### 认证

| 参数                  | 描述        | 默认值     |
| --------------------- | ----------- | ---------- |
| `auth.enabled`        | 启用认证    | `false`    |
| `auth.username`       | 用户名      | `opencode` |
| `auth.password`       | 密码        | `""`       |
| `auth.existingSecret` | 已有 Secret | `""`       |

### 会话亲和性

| 参数                  | 描述                        | 默认值             |
| --------------------- | --------------------------- | ------------------ |
| `affinity.enabled`    | 启用粘性会话                | `true`             |
| `affinity.cookieName` | Cookie 名称                 | `OPENCODEAFFINITY` |
| `affinity.mode`       | 模式（balanced/persistent） | `balanced`         |
| `affinity.type`       | 类型（cookie）              | `cookie`           |

### 持久化

| 参数                            | 描述     | 默认值          |
| ------------------------------- | -------- | --------------- |
| `persistence.data.enabled`      | 数据 PVC | `false`         |
| `persistence.data.storageClass` | 存储类   | `""`            |
| `persistence.data.accessMode`   | 访问模式 | `ReadWriteOnce` |
| `persistence.data.size`         | 大小     | `1Gi`           |
| `persistence.cache.enabled`     | 缓存 PVC | `false`         |
| `persistence.config.enabled`    | 配置 PVC | `false`         |

### ConfigMaps

| 参数                         | 描述           | 默认值  |
| ---------------------------- | -------------- | ------- |
| `configMaps.agents.enabled`  | 挂载 AGENTS.md | `false` |
| `configMaps.agents.data`     | ConfigMap 内容 | `{}`    |
| `configMaps.docs.enabled`    | 挂载文档       | `false` |
| `configMaps.docs.data`       | ConfigMap 内容 | `{}`    |
| `configMaps.plugins.enabled` | 挂载插件       | `false` |
| `configMaps.plugins.data`    | ConfigMap 内容 | `{}`    |

### 资源

| 参数                        | 描述     | 默认值  |
| --------------------------- | -------- | ------- |
| `resources.requests.cpu`    | CPU 请求 | `100m`  |
| `resources.requests.memory` | 内存请求 | `128Mi` |
| `resources.limits.cpu`      | CPU 限制 | `2000m` |
| `resources.limits.memory`   | 内存限制 | `2Gi`   |

## 配置示例

### 基本示例

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### 带认证的示例

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### 带持久化的示例

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

### 禁用会话亲和性的示例

```yaml
affinity:
  enabled: false
```

### 带 Ingress 的完整示例

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

## 会话亲和性

当存在多个副本时，OpenCode 需要粘性会话（会话亲和性）才能正常工作。这是因为服务器维护着与客户端的连接状态。

### Nginx Ingress

对于 Nginx Ingress，当 `affinity.enabled: true` 时，粘性会话配置会自动完成。Chart 会自动配置必要的注解：

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # 或 persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

对于 Traefik，请确保配置粘性会话中间件：

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### 亲和性模式

- **balanced**：请求均匀分配到可用的后端
- **persistent**：请求尽可能始终定向到同一后端

## 卷

Chart 挂载以下卷：

| 路径                          | 描述          |
| ----------------------------- | ------------- |
| `/root/.config/opencode`      | 配置目录      |
| `/root/.cache/opencode`       | Opencode 缓存 |
| `/root/.local/share/opencode` | Opencode 数据 |

## 环境变量

可以通过 `env` 配置以下环境变量：

| 变量                    | 描述       | 默认值                   |
| ----------------------- | ---------- | ------------------------ |
| `PORT`                  | 服务器端口 | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | 配置目录   | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS 域    | `local`                  |
| `OPENCODE_MDNS_ENABLED` | 启用 mDNS  | `false`                  |

环境变量配置示例：

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## 附加功能

### 自动扩缩容

可以启用 HPA（水平 Pod 自动扩缩容）：

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### 安全上下文

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### 额外卷

要挂载额外卷：

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## 路线图

- [ ] 支持使用 cert-manager 自动配置 TLS
- [ ] 云服务商配置示例
- [ ] 与 Prometheus/Grafana 集成以获取指标
- [ ] 部署 PostgreSQL 的模板
- [ ] 支持 Helm 测试

## 贡献

欢迎贡献！请在 [GitHub](https://github.com/anomalyco/opencode) 上提交 PR 或创建 issue。

## 许可证

Apache License 2.0 - 详见 [LICENSE](LICENSE) 文件。
