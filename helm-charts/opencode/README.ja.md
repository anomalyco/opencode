# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

KubernetesにOpenCode AIアシスタントサーバーをデプロイするためのHelmチャートです。

## 説明

このHelmチャートは、OpenCode AIアシスタントサーバーをKubernetesクラスターにインストールします。OpenCodeは、Language Server Protocol（LSP）を通じてコードエディターと統合できるソフトウェア開発用のAIアシスタントです。

## 前提条件

- Kubernetes 1.19+
- Helm 3+
- Ingressコントローラー（nginxまたはtraefik）

## インストール

### リポジトリの追加

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### 基本的なインストール

```bash
helm install opencode opencode/opencode
```

### カスタム値でのインストール

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### valuesファイルでのインストール

```bash
helm install opencode opencode/opencode -f values.yaml
```

## 設定

設定可能なすべてのパラメータについては、`values.yaml`ファイルを参照してください。

### 主なパラメータ

| パラメータ           | 説明                   | デフォルト値                 |
| -------------------- | ---------------------- | ---------------------------- |
| `image.repository`   | Dockerイメージ         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | イメージタグ           | `dev-alpine`                 |
| `replicaCount`       | レプリカ数             | `1`                          |
| `service.type`       | サービスタイプ         | `ClusterIP`                  |
| `service.port`       | サービスポート         | `80`                         |
| `service.targetPort` | コンテナポート         | `4096`                       |
| `server.port`        | opencodeサーバーポート | `4096`                       |

### 認証

| パラメータ            | 説明               | デフォルト値 |
| --------------------- | ------------------ | ------------ |
| `auth.enabled`        | 認証を有効にする   | `false`      |
| `auth.username`       | ユーザー名         | `opencode`   |
| `auth.password`       | パスワード         | `""`         |
| `auth.existingSecret` | 既存のシークレット | `""`         |

### セッションアfinity

| パラメータ            | 説明                               | デフォルト値       |
| --------------------- | ---------------------------------- | ------------------ |
| `affinity.enabled`    | スティッキーセッションを有効にする | `true`             |
| `affinity.cookieName` | Cookie名                           | `OPENCODEAFFINITY` |
| `affinity.mode`       | モード（balanced/persistent）      | `balanced`         |
| `affinity.type`       | タイプ（cookie）                   | `cookie`           |

### 永続化

| パラメータ                      | 説明            | デフォルト値    |
| ------------------------------- | --------------- | --------------- |
| `persistence.data.enabled`      | データ用PVC     | `false`         |
| `persistence.data.storageClass` | StorageClass    | `""`            |
| `persistence.data.accessMode`   | アクセスモード  | `ReadWriteOnce` |
| `persistence.data.size`         | サイズ          | `1Gi`           |
| `persistence.cache.enabled`     | キャッシュ用PVC | `false`         |
| `persistence.config.enabled`    | 設定用PVC       | `false`         |

### ConfigMaps

| パラメータ                   | 説明                   | デフォルト値 |
| ---------------------------- | ---------------------- | ------------ |
| `configMaps.agents.enabled`  | AGENTS.mdをマウント    | `false`      |
| `configMaps.agents.data`     | ConfigMapの内容        | `{}`         |
| `configMaps.docs.enabled`    | ドキュメントをマウント | `false`      |
| `configMaps.docs.data`       | ConfigMapの内容        | `{}`         |
| `configMaps.plugins.enabled` | プラグインをマウント   | `false`      |
| `configMaps.plugins.data`    | ConfigMapの内容        | `{}`         |

### リソース

| パラメータ                  | 説明             | デフォルト値 |
| --------------------------- | ---------------- | ------------ |
| `resources.requests.cpu`    | CPUリクエスト    | `100m`       |
| `resources.requests.memory` | メモリリクエスト | `128Mi`      |
| `resources.limits.cpu`      | CPU制限          | `2000m`      |
| `resources.limits.memory`   | メモリ制限       | `2Gi`        |

## 設定例

### 基本的な例

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### 認証付きの例

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### 永続化付きの例

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

### セッションアfinityを無効にした例

```yaml
affinity:
  enabled: false
```

### Ingress付きの完全な例

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

## セッションアfinity

OpenCodeは、複数のレプリカがある場合に正しく動作するためにスティッキーセッション（セッションアfinity）が必要です。これはサーバーがクライアントとの接続状態を保持しているためです。

### Nginx Ingress

Nginx Ingressの場合、`affinity.enabled: true`に設定するとスティッキーセッションの構成は自動で行われます。チャートが必要なアノテーションを自動的に設定します：

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # またはpersistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Traefikの場合、スティッキーセッションのミドルウェアを構成してください：

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### アfinityモード

- **balanced**: リクエストは利用可能なバックエンドに均等に分散されます
- **persistent**: リクエストは可能な限り同じバックエンドにルーティングされます

## ボリューム

チャートは次のボリュームをマウントします：

| Path                          | 説明               |
| ----------------------------- | ------------------ |
| `/root/.config/opencode`      | 設定ディレクトリ   |
| `/root/.cache/opencode`       | opencodeキャッシュ |
| `/root/.local/share/opencode` | opencodeデータ     |

## 環境変数

次の環境変数は`env`で構成できます：

| 変数                    | 説明             | デフォルト値             |
| ----------------------- | ---------------- | ------------------------ |
| `PORT`                  | サーバーポート   | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | 設定ディレクトリ | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNSドメイン     | `local`                  |
| `OPENCODE_MDNS_ENABLED` | mDNSを有効にする | `false`                  |

環境変数の設定例：

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## 追加機能

### Autoscaling

HPA（Horizontal Pod Autoscaler）を有効にできます：

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### セキュリティコンテキスト

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### 追加ボリューム

追加ボリュームをマウントする場合：

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## ロードマップ

- [ ] cert-managerによる自動TLSサポート
- [ ] クラウドプロバイダー向けの設定例
- [ ] Prometheus/Grafanaとのメトリクス統合
- [ ] PostgreSQLを使用したデプロイメントテンプレート
- [ ] Helmテストのサポート

## コントリビューション

コントリビューションは大歓迎です！[GitHub](https://github.com/anomalyco/opencode)でPRを送信するか、issueを開いてください。

## ライセンス

Apache License 2.0 - 詳細は[LICENSE](LICENSE)を参照してください。
