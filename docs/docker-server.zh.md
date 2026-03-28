# OpenCode 服务器 Docker 文档

本指南介绍如何在 Docker 容器中以服务器模式运行 OpenCode。

## 简介

OpenCode 服务器是 OpenCode 的无头部署版本，作为后台服务运行，可通过 HTTP API 访问。Docker 镜像提供了完整的运行时环境，预装了所有必要的工具，非常适合：

- 远程开发环境
- CI/CD 集成
- 团队共享编码实例
- 在无 GUI 的服务器上运行 OpenCode

## 快速开始

使用安全密码运行 OpenCode 服务器：

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

在 `http://localhost:3000` 访问服务器。

## 镜像变体

提供两个基础镜像变体：

| 变体     | 基础镜像           | 大小   | 使用场景             |
| -------- | ------------------ | ------ | -------------------- |
| `debian` | Debian Trixie Slim | ~500MB | 推荐给大多数用户     |
| `alpine` | Alpine Edge        | ~200MB | 最小化占用，更快拉取 |

### 拉取特定变体

```bash
# Debian（推荐）
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine（最小化）
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## 环境变量

| 变量                       | 默认值                        | 描述                           |
| -------------------------- | ----------------------------- | ------------------------------ |
| `OPENCODE_SERVER_PASSWORD` | (无)                          | **必需。** HTTP Basic 认证密码 |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | HTTP Basic 认证用户名          |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | 配置目录                       |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | 缓存目录                       |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | 数据目录                       |

### 服务器选项（CLI 标志）

覆盖默认命令时，服务器接受以下额外选项：

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| 标志            | 默认值           | 描述                 |
| --------------- | ---------------- | -------------------- |
| `--port`        | `0`（随机）      | 监听端口             |
| `--hostname`    | `127.0.0.1`      | 绑定主机名           |
| `--mdns`        | `false`          | 启用 mDNS 服务发现   |
| `--mdns-domain` | `opencode.local` | 自定义 mDNS 域名     |
| `--cors`        | `[]`             | 额外的 CORS 允许域名 |

## 卷挂载

挂载这些卷以持久化数据并共享资源：

### 工作区（必需）

```bash
-v /path/to/workspace:/workspace
```

这是 OpenCode 操作项目文件的位置。将您的代码仓库挂载到这里。

### SSH 密钥

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

用于克隆私有仓库的 SSH 密钥只读访问权限。

### Git 配置

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

从主机继承 Git 用户身份。

### OpenCode 配置

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

在容器重启之间保持 OpenCode 设置。

### 缓存

```bash
-v opencode_cache:/home/opencode/.cache
```

缓存 npm 包、语言服务器和其他下载的工具。

## 端口

| 端口   | 协议 | 描述                 |
| ------ | ---- | -------------------- |
| `3000` | HTTP | 主服务器 API（默认） |

可以通过 Docker 的 `-p` 标志重映射端口：

```bash
-p 8080:3000  # 在 http://localhost:8080 访问服务器
```

## 用户和权限

容器以非root用户（`opencode`，UID 1000）运行以确保安全。该用户拥有免密 `sudo` 权限用于管理任务：

```bash
# 以 opencode 用户执行命令
docker exec -it opencode-server sudo -u opencode <command>

# 获取 opencode 用户的 shell
docker exec -it opencode-server sudo -u opencode /bin/bash
```

如果需要 root 访问权限：

```bash
docker exec -it opencode-server /bin/bash
```

## 已安装工具

镜像预装了以下工具：

| 工具              | 描述                               |
| ----------------- | ---------------------------------- |
| `opencode`        | OpenCode CLI                       |
| `bun`             | JavaScript 运行时和包管理器        |
| `bunx`            | Bun 的 npx 等效命令（运行 npm 包） |
| `uv`              | Python 包管理器                    |
| `git`             | 版本控制                           |
| `git-lfs`         | Git 的大文件存储扩展               |
| `build-essential` | GCC、make 和构建库                 |
| `curl`            | HTTP 客户端                        |
| `wget`            | 文件下载工具                       |
| `openssh-client`  | SSH 客户端和密钥工具               |
| `xz-utils`        | 压缩工具                           |

### 使用 bun

```bash
# 运行 Node.js 包
docker exec -it opencode-server bunx create-next-app

# 安装依赖
docker exec -it opencode-server bun install
```

### 使用 uv

```bash
# 安装 Python 包
docker exec -it opencode-server uv pip install pandas

# 运行 Python 脚本
docker exec -it opencode-server uv run script.py
```

### 使用 git

```bash
# 将仓库克隆到工作区
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## 健康检查

容器内置了健康检查，验证服务器是否正常响应：

```bash
# 检查容器健康状态
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

健康端点在服务正常时返回 HTTP 200：

```bash
# 手动健康检查
curl -f http://localhost:3000/health
```

健康检查配置：

- 间隔：30 秒
- 超时：10 秒
- 启动周期：10 秒
- 重试次数：3

## Docker Compose 示例

创建 `docker-compose.yml` 文件：

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

启动栈：

```bash
docker-compose up -d
```

## 从源码构建

从源码构建服务器镜像：

### 克隆仓库

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### 构建 Debian 变体

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### 构建 Alpine 变体

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### 运行本地构建

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## 故障排除

### 服务器无法启动

检查日志：

```bash
docker logs opencode-server
```

常见问题：

- 缺少 `OPENCODE_SERVER_PASSWORD` - 服务器在没有认证的情况下拒绝启动
- 端口已被占用 - 更改主机端口映射

### 认证失败

确保密码完全匹配。服务器使用 HTTP Basic Auth：

```bash
# 测试认证
curl -u opencode:your_password http://localhost:3000/health
```

### 工作区权限错误

确保挂载的目录对 UID 1000 可写：

```bash
# 修复所有权
sudo chown -R 1000:1000 /path/to/workspace
```

### 启动缓慢

首次运行会下载语言服务器和工具。查看进度：

```bash
docker logs -f opencode-server
```

### 容器无法访问互联网

检查 DNS 配置：

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### 健康检查失败

验证服务器是否实际运行：

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH 密钥不工作

确保容器内的密钥权限正确：

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
