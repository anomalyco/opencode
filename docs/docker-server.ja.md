# OpenCode Server Docker ドキュメント

このガイドでは、Dockerコンテナ内でサーバーモードでOpenCodeを実行する方法について説明します。

## はじめに

OpenCode Serverは、バックグラウンドサービスとして実行され、HTTP APIでアクセスできるOpenCodeのヘッドレス展開です。Dockerイメージには必要なツールがすべて事前にインストールされた完全なランタイム環境が含まれており、以下に最適です：

- リモート開発環境
- CI/CD統合
- チームで共有するコーディングインスタンス
- GUIなしのサーバーでのOpenCodeの実行

## クイックスタート

安全なパスワードでOpenCode Serverを実行します：

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

サーバーにアクセスするには `http://localhost:3000` にアクセスしてください。

## イメージバリアント

2つのベースイメージバリアントが利用可能です：

| バリアント | ベースイメージ     | サイズ | ユースケース             |
| ---------- | ------------------ | ------ | ------------------------ |
| `debian`   | Debian Trixie Slim | ~500MB | ほとんどのユーザーに推奨 |
| `alpine`   | Alpine Edge        | ~200MB | 最小構成、より速いプル   |

### 特定のバリアントをプル

```bash
# Debian（推奨）
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine（最小構成）
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## 環境変数

| 変数                       | デフォルト                    | 説明                                  |
| -------------------------- | ----------------------------- | ------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | （なし）                      | **必須。** HTTP Basic認証のパスワード |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | HTTP Basic認証のユーザー名            |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | 設定ディレクトリ                      |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | キャッシュディレクトリ                |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | データディレクトリ                    |

### サーバーオプション（CLIフラグ）

デフォルトコマンドをオーバーライドする場合、サーバーはこれらの追加オプションを受け入れます：

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| フラグ          | デフォルト       | 説明                         |
| --------------- | ---------------- | ---------------------------- |
| `--port`        | `0`（ランダム）  | リスンするポート             |
| `--hostname`    | `127.0.0.1`      | バインドするホスト名         |
| `--mdns`        | `false`          | mDNSサービス検出を有効にする |
| `--mdns-domain` | `opencode.local` | カスタムmDNSドメイン名       |
| `--cors`        | `[]`             | 追加のCORS許可ドメイン       |

## ボリュームマウント

データを永続化し、リソースを共有するためにこれらのボリュームをマウントします：

### ワークスペース（必須）

```bash
-v /path/to/workspace:/workspace
```

ここにOpenCodeがプロジェクトファイルを操作します。コードリポジトリをここにマウントしてください。

### SSHキー

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

秘密リポジトリをクローンするためのSSHキーへの読み取り専用アクセス。

### Git設定

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

ホストからGitユーザーIDを継承します。

### OpenCode設定

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

コンテナの再起動間でOpenCode設定を保持します。

### キャッシュ

```bash
-v opencode_cache:/home/opencode/.cache
```

npmパッケージ、言語サーバー、およびその他のダウンロードしたツールをキャッシュします。

## ポート

| ポート | プロトコル | 説明                            |
| ------ | ---------- | ------------------------------- |
| `3000` | HTTP       | メインサーバーAPI（デフォルト） |

ポートはDockerの `-p` フラグで再マッピングできます：

```bash
-p 8080:3000  # http://localhost:8080でサーバーにアクセス
```

## ユーザーと権限

セキュリティのため、コンテナは非rootユーザー（`opencode`、UID 1000）で実行されます。このユーザーには管理タスク用のパスワードなしsudoアクセスがあります：

```bash
# opencodeユーザーとしてコマンドを実行
docker exec -it opencode-server sudo -u opencode <command>

# opencodeユーザーとしてシェルを取得
docker exec -it opencode-server sudo -u opencode /bin/bash
```

rootアクセスが必要な場合：

```bash
docker exec -it opencode-server /bin/bash
```

## インストール済みツール

イメージには以下のツールが標準で含まれています：

| ツール            | 説明                                         |
| ----------------- | -------------------------------------------- |
| `opencode`        | OpenCode CLI                                 |
| `bun`             | JavaScriptランタイムとパッケージマネージャー |
| `bunx`            | npx相当のBun（npmパッケージを実行）          |
| `uv`              | Pythonパッケージマネージャー                 |
| `git`             | バージョン管理                               |
| `git-lfs`         | Git用の大容量ファイルストレージ拡張          |
| `build-essential` | GCC、make、およびビルドライブラリ            |
| `curl`            | HTTPクライアント                             |
| `wget`            | ファイルダウンロードユーティリティ           |
| `openssh-client`  | SSHクライアントと鍵ツール                    |
| `xz-utils`        | 圧縮ユーティリティ                           |

### bunの使用

```bash
# Node.jsパッケージを実行
docker exec -it opencode-server bunx create-next-app

# 依存関係をインストール
docker exec -it opencode-server bun install
```

### uvの使用

```bash
# Pythonパッケージをインストール
docker exec -it opencode-server uv pip install pandas

# Pythonスクリプトを実行
docker exec -it opencode-server uv run script.py
```

### gitの使用

```bash
# リポジトリをワークスペースにクローン
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## ヘルスチェック

コンテナには、サーバーが応答していることを確認する組み込みのヘルスチェックが含まれています：

```bash
# コンテナのヘルス状態を確認
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

ヘルスエンドポイントは正常時にHTTP 200を返します：

```bash
# 手動ヘルスチェック
curl -f http://localhost:3000/health
```

ヘルスチェック設定：

- 間隔：30秒
- タイムアウト：10秒
- 開始期間：10秒
- リトライ：3回

## Docker Composeの例

`docker-compose.yml` ファイルを作成します：

```yaml
services:
  opencode:
    image: ghcr.io/anomalyco/opencode/server:debian
    container_name: opencode-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - OPENCODE_SERVER_PASSWORD=your_secure_password
      - OPENCODE_SERVER_USERNAME=opencode
    volumes:
      - ./workspace:/workspace
      - opencode_config:/home/opencode/.config
      - opencode_cache:/home/opencode/.cache
      - ~/.ssh:/home/opencode/.ssh:ro
      - ~/.gitconfig:/home/opencode/.gitconfig:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  opencode_config:
  opencode_cache:
```

スタックを起動します：

```bash
docker-compose up -d
```

## ソースからのビルド

ソースからサーバーイメージをビルドするには：

### リポジトリをクローン

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Debianバリアントをビルド

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Alpineバリアントをビルド

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### ローカルビルドを実行

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## トラブルシューティング

### サーバーが起動しない

ログを確認します：

```bash
docker logs opencode-server
```

一般的な問題：

- `OPENCODE_SERVER_PASSWORD` が不足 - 認証がないとサーバーが起動を拒否
- ポートが既に使用中 - ホストポートのマッピングを変更

### 認証が失敗する

パスワードが正確一致していることを確認してください。サーバーはHTTP Basic Authを使用します：

```bash
# 認証をテスト
curl -u opencode:your_password http://localhost:3000/health
```

### ワークスペースの権限エラー

マウントされたディレクトリがUID 1000で書き込み可能であることを確認します：

```bash
# 所有者を修正
sudo chown -R 1000:1000 /path/to/workspace
```

### 起動が遅い

初回実行では言語サーバーとツールがダウンロードされます。進捗を確認します：

```bash
docker logs -f opencode-server
```

### コンテナがインターネットに接続できない

DNS設定を確認します：

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### ヘルスチェックが失敗する

サーバーが実際に実行されていることを確認します：

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSHキーが機能しない

コンテナ内で適切な鍵の権限を確認します：

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
