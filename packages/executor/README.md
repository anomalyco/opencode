# Veritly Firecracker Executor

Isolated command execution using Firecracker microVMs. Each session gets its own VM with UUIDv4 identifier.

## Architecture

```
┌─────────────────┐     HTTP      ┌──────────────────┐     SSH      ┌─────────────┐
│   opencode-api  │ ─────────────→│  executor:7777   │ ────────────→│  MicroVM    │
│   (bash tool)   │               │  (this service)  │              │ (per session)│
└─────────────────┘               └──────────────────┘              └─────────────┘
```

## Requirements

- **Linux with KVM** - Firecracker requires `/dev/kvm`
- **Docker** (for local development without KVM hardware)
- **Privileges** - Container needs `--privileged` for Firecracker

## Quick Start

```bash
# Build VM artifacts first, then build and run with Docker
(cd packages/executor && bun run build-vm)
docker compose -f docker-compose.e2e.yml up --build executor

# Test it
curl http://localhost:7777/health
```

## API Endpoints

### Health Check

```bash
GET /health
```

Response:

```json
{
  "ok": true,
  "mode": "firecracker",
  "activeSessions": 0,
  "ready": true
}
```

### Execute Command

```bash
POST /v1/sessions/:sessionId/exec
Content-Type: application/json

{
  "command": "python3 -c 'print(\"hello\")'",
  "timeout": 30000
}
```

Response:

```json
{
  "output": "hello\n",
  "exitCode": 0,
  "vmId": "uuid-v4-string"
}
```

### Get Session Status

```bash
GET /v1/sessions/:sessionId/status
```

### Close Session

```bash
POST /v1/sessions/:sessionId/close
```

## Environment Variables

| Variable                   | Default                      | Description                                     |
| -------------------------- | ---------------------------- | ----------------------------------------------- |
| `PORT`                     | `7777`                       | HTTP API port                                   |
| `VM_INACTIVITY_TIMEOUT_MS` | `300000`                     | Auto-cleanup after inactivity (5 min)           |
| `KERNEL_PATH`              | `/opt/veritly/vmlinux`       | Firecracker kernel image                        |
| `ROOTFS_PATH`              | `/opt/veritly/rootfs.ext4`   | VM root filesystem                              |
| `FIRECRACKER_BINARY`       | `/usr/local/bin/firecracker` | Firecracker binary path                         |
| `VM_DATA_DIR`              | `/tmp/veritly-vms`           | VM sockets/configs directory                    |
| `VM_SSH_KEY`               | -                            | Private key for SSH (auto-generated if not set) |

## Security Model

✅ **Secure by design:**

- Each session → dedicated microVM
- UUIDv4 identifiers (not guessable)
- VMs isolated (no shared filesystem)
- Auto-cleanup on inactivity
- No auth needed (internal network only)
- Full root access inside VM (intentional)

⚠️ **Requirements:**

- Executor runs in privileged container (for KVM/net admin)
- Backend must reach executor via internal network
- VMs have internet access (for package installation)

## Session Lifecycle

1. **First command** → VM created (~3-5s boot)
2. **Active use** → Commands execute in same VM
3. **Inactivity** → VM cleaned up after timeout
4. **New command after cleanup** → Backend gets 404, auto-creates new VM
5. **Session end** → VM destroyed

## Development on macOS

Firecracker requires Linux KVM, which isn't available on macOS. Use Docker Desktop:

```bash
# Build the VM rootfs on a Linux/KVM-capable host, then build the executor image.
docker compose -f docker-compose.e2e.yml up --build executor

# The executor will have access to KVM inside Docker Desktop's VM
```

If you see "Firecracker not available" error, ensure Docker Desktop is running and you're using `--privileged` mode.

## VM Image Contents

The Docker image builds a Ubuntu-based rootfs with:

- Python 3 + pip
- OpenSSH server
- **Univer SDK** pre-installed
- `/workspace` directory for session files

Univer SDK is installed in the VM rootfs, where commands actually run.

## Docker Compose

```yaml
executor:
  image: opencode-veritly-executor:latest
  build:
    context: .
    dockerfile: Dockerfile.executor
  ports:
    - "7777:7777"
  environment:
    - PORT=7777
    - VM_INACTIVITY_TIMEOUT_MS=300000
  privileged: true # Required for Firecracker
  cap_add:
    - NET_ADMIN
    - NET_RAW
  volumes:
    - /dev/kvm:/dev/kvm
```

## Troubleshooting

### "Firecracker not available" error

Check:

- `/dev/kvm` exists in the container
- Container has `--privileged` flag
- Firecracker binary exists at `FIRECRACKER_BINARY`

### Commands timeout

VMs may be slow to boot. Check:

- Kernel and rootfs exist and are valid
- Firecracker logs: `docker logs <executor-container>`
- VM resources (try increasing `machine_config.mem_size_mib`)

### SSH connection fails

- VM may not have finished booting (increase boot wait time)
- SSH keys not configured properly
- Network setup failed (requires `NET_ADMIN`)

### Backend can't connect to executor

- Verify `VERITLY_EXECUTOR_URL` is correct
- Check docker-compose network connectivity
- Ensure executor health check passes

## Backend Integration

The bash tool in `packages/opencode/src/tool/bash.ts` sends commands to the executor:

```typescript
const result = await fetch(`${EXECUTOR_URL}/v1/sessions/${sessionId}/exec`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ command, timeout }),
})
```

If the VM was cleaned up due to inactivity, the backend gets a 404 and should retry (which creates a new VM automatically).

## Future Improvements

- [ ] Add streaming output via WebSocket/SSE
- [ ] VM snapshots for faster session resume
- [ ] File sync between backend and VMs
- [ ] Resource limits (CPU, memory per VM)
- [ ] VM pool for faster cold start
- [ ] Multi-region executor deployment
