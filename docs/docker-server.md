# OpenCode Server Docker Documentation

This guide covers running OpenCode in server mode inside Docker containers.

## Introduction

OpenCode Server is a headless deployment of OpenCode that runs as a background service, accessible via HTTP API. The Docker image provides a complete runtime environment with all necessary tools pre-installed, making it ideal for:

- Remote development environments
- CI/CD integration
- Team shared coding instances
- Running OpenCode on servers without a GUI

## Quick Start

Run OpenCode Server with a secure password:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Access the server at `http://localhost:3000`.

## Image Variants

Two base image variants are available:

| Variant  | Base Image         | Size   | Use Case                       |
| -------- | ------------------ | ------ | ------------------------------ |
| `debian` | Debian Trixie Slim | ~500MB | Recommended for most users     |
| `alpine` | Alpine Edge        | ~200MB | Minimal footprint, faster pull |

### Pulling Specific Variants

```bash
# Debian (recommended)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimal)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Environment Variables

| Variable                   | Default                       | Description                                          |
| -------------------------- | ----------------------------- | ---------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (none)                        | **Required.** Password for HTTP Basic authentication |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Username for HTTP Basic authentication               |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Configuration directory                              |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Cache directory                                      |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Data directory                                       |

### Server Options (CLI Flags)

The server accepts these additional options when overriding the default command:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Default          | Description                     |
| --------------- | ---------------- | ------------------------------- |
| `--port`        | `0` (random)     | Port to listen on               |
| `--hostname`    | `127.0.0.1`      | Hostname to bind to             |
| `--mdns`        | `false`          | Enable mDNS service discovery   |
| `--mdns-domain` | `opencode.local` | Custom mDNS domain name         |
| `--cors`        | `[]`             | Additional CORS-allowed domains |

## Volume Mounts

Mount these volumes to persist data and share resources:

### Workspace (Required)

```bash
-v /path/to/workspace:/workspace
```

This is where OpenCode operates on your project files. Mount your code repository here.

### SSH Keys

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Read-only access to SSH keys for cloning private repositories.

### Git Configuration

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Inherit Git user identity from host.

### OpenCode Configuration

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Persist OpenCode settings between container restarts.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache npm packages, language servers, and other downloaded tools.

## Ports

| Port   | Protocol | Description               |
| ------ | -------- | ------------------------- |
| `3000` | HTTP     | Main server API (default) |

The port can be remapped via Docker's `-p` flag:

```bash
-p 8080:3000  # Access server at http://localhost:8080
```

## User and Permissions

The container runs as a non-root user (`opencode`, UID 1000) for security. This user has `sudo` access without password for administrative tasks:

```bash
# Execute commands as opencode user
docker exec -it opencode-server sudo -u opencode <command>

# Get shell as opencode user
docker exec -it opencode-server sudo -u opencode /bin/bash
```

If you need root access:

```bash
docker exec -it opencode-server /bin/bash
```

## Installed Tools

The image includes these tools out of the box:

| Tool              | Description                                |
| ----------------- | ------------------------------------------ |
| `opencode`        | OpenCode CLI                               |
| `bun`             | JavaScript runtime and package manager     |
| `bunx`            | Bun's equivalent to npx (run npm packages) |
| `uv`              | Python package manager                     |
| `git`             | Version control                            |
| `git-lfs`         | Large file storage extension for Git       |
| `build-essential` | GCC, make, and build libraries             |
| `curl`            | HTTP client                                |
| `wget`            | File download utility                      |
| `openssh-client`  | SSH client and key tools                   |
| `xz-utils`        | Compression utilities                      |

### Using bun

```bash
# Run a Node.js package
docker exec -it opencode-server bunx create-next-app

# Install dependencies
docker exec -it opencode-server bun install
```

### Using uv

```bash
# Install a Python package
docker exec -it opencode-server uv pip install pandas

# Run a Python script
docker exec -it opencode-server uv run script.py
```

### Using git

```bash
# Clone a repository into the workspace
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Health Check

The container includes a built-in health check that verifies the server is responding:

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

The health endpoint returns HTTP 200 when healthy:

```bash
# Manual health check
curl -f http://localhost:3000/health
```

Health check configuration:

- Interval: 30 seconds
- Timeout: 10 seconds
- Start period: 10 seconds
- Retries: 3

## Docker Compose Example

Create a `docker-compose.yml` file:

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

Start the stack:

```bash
docker-compose up -d
```

## Building from Source

To build the server image from source:

### Clone the repository

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Build Debian variant

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Build Alpine variant

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Run your local build

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Troubleshooting

### Server not starting

Check the logs:

```bash
docker logs opencode-server
```

Common issues:

- Missing `OPENCODE_SERVER_PASSWORD` - the server refuses to start without authentication
- Port already in use - change the host port mapping

### Authentication failing

Ensure the password matches exactly. The server uses HTTP Basic Auth:

```bash
# Test authentication
curl -u opencode:your_password http://localhost:3000/health
```

### Workspace permission errors

Ensure the mounted directory is writable by UID 1000:

```bash
# Fix ownership
sudo chown -R 1000:1000 /path/to/workspace
```

### Slow startup

The first run downloads language servers and tools. Check progress:

```bash
docker logs -f opencode-server
```

### Container can't reach internet

Check DNS configuration:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Health check failing

Verify the server is actually running:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH key not working

Ensure proper key permissions inside the container:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
