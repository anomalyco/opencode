# OpenCode 伺服器 Docker 文檔

本指南說明如何在 Docker 容器中以伺服器模式執行 OpenCode。

## 簡介

OpenCode 伺服器是 OpenCode 的無頭部署版本，作為背景服務執行，可透過 HTTP API 存取。Docker 映像檔提供了完整的執行環境，預先安裝了所有必要的工具，非常適合：

- 遠端開發環境
- CI/CD 整合
- 團隊共用編碼執行個體
- 在沒有 GUI 的伺服器上執行 OpenCode

## 快速開始

使用安全密碼執行 OpenCode 伺服器：

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

在 `http://localhost:3000` 存取伺服器。

## 映像檔變體

提供兩個基礎映像檔變體：

| 變體     | 基礎映像檔         | 大小   | 使用場景             |
| -------- | ------------------ | ------ | -------------------- |
| `debian` | Debian Trixie Slim | ~500MB | 推薦給大多數使用者   |
| `alpine` | Alpine Edge        | ~200MB | 最小化佔用，更快下載 |

### 下載特定變體

```bash
# Debian（推薦）
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine（最小化）
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## 環境變數

| 變數                       | 預設值                        | 描述                           |
| -------------------------- | ----------------------------- | ------------------------------ |
| `OPENCODE_SERVER_PASSWORD` | (無)                          | **必要。** HTTP Basic 認證密碼 |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | HTTP Basic 認證使用者名稱      |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | 設定目錄                       |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | 快取目錄                       |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | 資料目錄                       |

### 伺服器選項（CLI 旗標）

覆寫預設命令時，伺服器接受以下額外選項：

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| 旗標            | 預設值           | 描述                 |
| --------------- | ---------------- | -------------------- |
| `--port`        | `0`（隨機）      | 監聽連接埠           |
| `--hostname`    | `127.0.0.1`      | 綁定主機名稱         |
| `--mdns`        | `false`          | 啟用 mDNS 服務發現   |
| `--mdns-domain` | `opencode.local` | 自訂 mDNS 網域       |
| `--cors`        | `[]`             | 額外的 CORS 允許網域 |

## 磁碟區掛載

掛載這些磁碟區以持久化資料並共用資源：

### 工作區（必要）

```bash
-v /path/to/workspace:/workspace
```

這是 OpenCode 操作專案檔案的位置。將您的程式碼儲存庫掛載到這裡。

### SSH 金鑰

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

用於複製私人儲存庫的 SSH 金鑰唯讀存取權限。

### Git 設定

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

從主機繼承 Git 使用者身份。

### OpenCode 設定

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

在容器重啟之間保持 OpenCode 設定。

### 快取

```bash
-v opencode_cache:/home/opencode/.cache
```

快取 npm 套件、語言伺服器和其他下載的工具。

## 連接埠

| 連接埠 | 通訊協定 | 描述                 |
| ------ | -------- | -------------------- |
| `3000` | HTTP     | 主伺服器 API（預設） |

可以透過 Docker 的 `-p` 旗標重新對應連接埠：

```bash
-p 8080:3000  # 在 http://localhost:8080 存取伺服器
```

## 使用者和權限

容器以非 root 使用者（`opencode`，UID 1000）執行以確保安全。該使用者擁有免密 `sudo` 權限用於管理任務：

```bash
# 以 opencode 使用者執行命令
docker exec -it opencode-server sudo -u opencode <command>

# 取得 opencode 使用者的 shell
docker exec -it opencode-server sudo -u opencode /bin/bash
```

如果需要 root 存取權限：

```bash
docker exec -it opencode-server /bin/bash
```

## 已安裝工具

映像檔預先安裝了以下工具：

| 工具              | 描述                                 |
| ----------------- | ------------------------------------ |
| `opencode`        | OpenCode CLI                         |
| `bun`             | JavaScript 執行環境和套件管理工具    |
| `bunx`            | Bun 的 npx 等價命令（執行 npm 套件） |
| `uv`              | Python 套件管理工具                  |
| `git`             | 版本控制                             |
| `git-lfs`         | Git 的大檔案儲存擴展                 |
| `build-essential` | GCC、make 和建構庫                   |
| `curl`            | HTTP 用戶端                          |
| `wget`            | 檔案下載工具                         |
| `openssh-client`  | SSH 用戶端和金鑰工具                 |
| `xz-utils`        | 壓縮工具                             |

### 使用 bun

```bash
# 執行 Node.js 套件
docker exec -it opencode-server bunx create-next-app

# 安裝相依套件
docker exec -it opencode-server bun install
```

### 使用 uv

```bash
# 安裝 Python 套件
docker exec -it opencode-server uv pip install pandas

# 執行 Python 腳本
docker exec -it opencode-server uv run script.py
```

### 使用 git

```bash
# 將儲存庫複製到工作區
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## 健康檢查

容器內建了健康檢查，驗證伺服器是否正常回應：

```bash
# 檢查容器健康狀態
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

健康端點在服務正常時回傳 HTTP 200：

```bash
# 手動健康檢查
curl -f http://localhost:3000/health
```

健康檢查設定：

- 間隔：30 秒
- 逾時：10 秒
- 啟動週期：10 秒
- 重試次數：3

## Docker Compose 範例

建立 `docker-compose.yml` 檔案：

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

啟動堆疊：

```bash
docker-compose up -d
```

## 從原始碼建構

從原始碼建構伺服器映像檔：

### 複製儲存庫

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### 建構 Debian 變體

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### 建構 Alpine 變體

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### 執行本機建構

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## 疑難排解

### 伺服器無法啟動

檢查日誌：

```bash
docker logs opencode-server
```

常見問題：

- 缺少 `OPENCODE_SERVER_PASSWORD` - 伺服器在沒有認證的情況下拒絕啟動
- 連接埠已被佔用 - 變更主機連接埠對應

### 認證失敗

確保密碼完全相符。伺服器使用 HTTP Basic Auth：

```bash
# 測試認證
curl -u opencode:your_password http://localhost:3000/health
```

### 工作區權限錯誤

確保掛載的目錄對 UID 1000 可寫入：

```bash
# 修復所有權
sudo chown -R 1000:1000 /path/to/workspace
```

### 啟動緩慢

首次執行會下載語言伺服器和工具。查看進度：

```bash
docker logs -f opencode-server
```

### 容器無法存取網際網路

檢查 DNS 設定：

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### 健康檢查失敗

驗證伺服器是否實際執行中：

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH 金鑰無法運作

確保容器內的金鑰權限正確：

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
