# Tài liệu Docker OpenCode Server

Hướng dẫn này trình bày cách chạy OpenCode ở chế độ server trong các container Docker.

## Giới thiệu

OpenCode Server là một triển khai headless của OpenCode chạy như một dịch vụ nền, có thể truy cập qua HTTP API. Image Docker cung cấp môi trường runtime đầy đủ với tất cả các công cụ cần thiết được cài sẵn, lý tưởng cho:

- Môi trường phát triển từ xa
- Tích hợp CI/CD
- Phiên bản chia sẻ cho nhóm
- Chạy OpenCode trên server không có GUI

## Bắt đầu nhanh

Chạy OpenCode Server với mật khẩu bảo mật:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Truy cập server tại `http://localhost:3000`.

## Các Biến thể Image

Có hai biến thể image cơ sở:

| Biến thể | Image cơ sở        | Kích thước | Trường hợp sử dụng                      |
| -------- | ------------------ | ---------- | --------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB     | Được khuyến nghị cho hầu hết người dùng |
| `alpine` | Alpine Edge        | ~200MB     | Dấu chân tối thiểu, tải nhanh hơn       |

### Pull Các Biến thể Cụ thể

```bash
# Debian (được khuyến nghị)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (tối thiểu)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Biến Môi trường

| Biến                       | Mặc định                      | Mô tả                                                |
| -------------------------- | ----------------------------- | ---------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (không có)                    | **Bắt buộc.** Mật khẩu cho HTTP Basic authentication |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Tên người dùng cho HTTP Basic authentication         |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Thư mục cấu hình                                     |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Thư mục cache                                        |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Thư mục dữ liệu                                      |

### Tùy chọn Server (CLI Flags)

Server chấp nhận các tùy chọn bổ sung này khi ghi đè lệnh mặc định:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Mặc định         | Mô tả                             |
| --------------- | ---------------- | --------------------------------- |
| `--port`        | `0` (ngẫu nhiên) | Cổng để lắng nghe                 |
| `--hostname`    | `127.0.0.1`      | Hostname để bind                  |
| `--mdns`        | `false`          | Bật dịch vụ khám phá mDNS         |
| `--mdns-domain` | `opencode.local` | Tên domain mDNS tùy chỉnh         |
| `--cors`        | `[]`             | Các domain được phép CORS bổ sung |

## Mount Volumes

Mount các volumes này để duy trì dữ liệu và chia sẻ tài nguyên:

### Workspace (Bắt buộc)

```bash
-v /path/to/workspace:/workspace
```

Đây là nơi OpenCode vận hành các file project của bạn. Mount repository code của bạn tại đây.

### SSH Keys

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Quyền truy cập chỉ đọc SSH keys để clone các repository riêng.

### Cấu hình Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Kế thừa danh tính người dùng Git từ host.

### Cấu hình OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Duy trì cài đặt OpenCode giữa các lần khởi động lại container.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache các gói npm, language servers và các công cụ đã tải xuống khác.

## Các Cổng

| Cổng   | Giao thức | Mô tả                       |
| ------ | --------- | --------------------------- |
| `3000` | HTTP      | API server chính (mặc định) |

Cổng có thể được ánh xạ lại qua cờ `-p` của Docker:

```bash
-p 8080:3000  # Truy cập server tại http://localhost:8080
```

## Người dùng và Quyền

Container chạy như người dùng không phải root (`opencode`, UID 1000) để bảo mật. Người dùng này có quyền truy cập `sudo` không cần mật khẩu cho các tác vụ quản trị:

```bash
# Thực thi lệnh với người dùng opencode
docker exec -it opencode-server sudo -u opencode <command>

# Lấy shell với người dùng opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Nếu bạn cần quyền truy cập root:

```bash
docker exec -it opencode-server /bin/bash
```

## Các Công cụ Đã Cài đặt

Image bao gồm sẵn các công cụ này:

| Công cụ           | Mô tả                                 |
| ----------------- | ------------------------------------- |
| `opencode`        | OpenCode CLI                          |
| `bun`             | JavaScript runtime và package manager |
| `bunx`            | Phiên bản npx của Bun (chạy gói npm)  |
| `uv`              | Python package manager                |
| `git`             | Quản lý phiên bản                     |
| `git-lfs`         | Phần mở rộng lưu trữ file lớn cho Git |
| `build-essential` | GCC, make và thư viện build           |
| `curl`            | HTTP client                           |
| `wget`            | Công cụ tải file                      |
| `openssh-client`  | SSH client và công cụ key             |
| `xz-utils`        | Công cụ nén                           |

### Sử dụng bun

```bash
# Chạy gói Node.js
docker exec -it opencode-server bunx create-next-app

# Cài đặt dependencies
docker exec -it opencode-server bun install
```

### Sử dụng uv

```bash
# Cài đặt gói Python
docker exec -it opencode-server uv pip install pandas

# Chạy script Python
docker exec -it opencode-server uv run script.py
```

### Sử dụng git

```bash
# Clone repository vào workspace
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Health Check

Container bao gồm health check tích hợp xác minh server đang phản hồi:

```bash
# Kiểm tra health của container
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Endpoint health trả về HTTP 200 khi khỏe mạnh:

```bash
# Health check thủ công
curl -f http://localhost:3000/health
```

Cấu hình health check:

- Interval: 30 giây
- Timeout: 10 giây
- Start period: 10 giây
- Retries: 3

## Ví dụ Docker Compose

Tạo file `docker-compose.yml`:

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

Khởi động stack:

```bash
docker-compose up -d
```

## Build từ Source

Để build image server từ source:

### Clone repository

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Build biến thể Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Build biến thể Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Chạy bản build local

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Xử lý sự cố

### Server không khởi động

Kiểm tra logs:

```bash
docker logs opencode-server
```

Các vấn đề phổ biến:

- Thiếu `OPENCODE_SERVER_PASSWORD` - server từ chối khởi động không có authentication
- Cổng đã được sử dụng - thay đổi ánh xạ cổng host

### Authentication thất bại

Đảm bảo mật khẩu khớp chính xác. Server sử dụng HTTP Basic Auth:

```bash
# Test authentication
curl -u opencode:your_password http://localhost:3000/health
```

### Lỗi quyền Workspace

Đảm bảo thư mục được mount có thể ghi bởi UID 1000:

```bash
# Sửa quyền sở hữu
sudo chown -R 1000:1000 /path/to/workspace
```

### Khởi động chậm

Lần chạy đầu tiên tải xuống language servers và công cụ. Kiểm tra tiến độ:

```bash
docker logs -f opencode-server
```

### Container không thể truy cập internet

Kiểm tra cấu hình DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Health check thất bại

Xác minh server đang thực sự chạy:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH key không hoạt động

Đảm bảo quyền key đúng trong container:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
