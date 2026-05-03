# Veritly Firecracker Executor

Isolated command execution using Firecracker microVM guests. Each session gets its own VM.

---

## Two modes (do not confuse them)

### 1. Production — executor runs **in the cluster** (build and operate this first)

This is the real deployment path.

- The executor Pod runs on **Linux nodes** with **`/dev/kvm`**, **privileged** networking (TAP, `socat`), and the Firecracker binary inside the image.
- MicroVMs run **on that node** next to the HTTP service. Nothing about port-forward or your laptop belongs here.
- OpenCode / API reaches the executor via **Kubernetes Service DNS** inside the cluster. Production uses the **`executor`** Service (see `deploy/k8s/base/03-executor.yaml`), e.g. `http://executor:7777` from `opencode-api` — **not** the dev stack. **No tunnel**, **no `kubectl port-forward`**.
- Image build and push to your registry are part of normal deploy; see `deploy/k8s/` and your CI.

```
┌──────────────┐   Cluster DNS / ClusterIP   ┌─────────────────────┐   SSH   ┌──────────┐
│  opencode-api│ ───────────────────────────→│ executor Service :7777   │ ─────→│ microVM  │
│  (same VPC)  │                             │  (Pod on Linux+KVM)     │       │ per sess │
└──────────────┘                             └─────────────────────┘         └──────────┘
```

### 2. Local development — **Mac (or any machine without KVM / Firecracker)**

Firecracker **does not** run on macOS. You are **not** meant to run this HTTP server on your laptop for real VMs.

- **Production** and **dev** are **two different Deployments/Services** in Kubernetes:
  - **`executor`** — what `opencode-api` uses in production (`http://executor:7777` in-cluster).
  - **`executor-dev`** — separate stack for experimental `:dev` images and laptop testing (`deploy/k8s/base/03b-executor-dev.yaml`). Do not point production config at this Service.

- Deploy **`executor-dev`** to a **real cluster** that has KVM (same image intent as prod).
- From your laptop, **only then**: `kubectl port-forward` from `svc/executor-dev` to `127.0.0.1` so local tools and tests can speak HTTP to the executor that still runs **in the cluster**.
- Set `VERITLY_EXECUTOR_URL=http://127.0.0.1:<local-port>` while the forward is running.

Helpers (Mode 2 only — not part of the executor process itself):

- **Canonical:** `bash packages/opencode/script/executor-dev-k8s-tunnel.sh` (or `bun run --cwd packages/opencode executor-dev:k8s-tunnel`, which runs that same script)
- **Shortcut from repo root:** `./script/executor-dev-port-forward.sh` → same script

**Executor SDK integration tests** (`packages/opencode/test/executor/sdk.test.ts`) target the **dev** stack (`executor-dev` via `executor-dev-k8s-tunnel.sh` or `VERITLY_EXECUTOR_URL`), never the production `executor` Service — **Mode 2** only.

---

## Requirements (Mode 1 — where Firecracker actually runs)

- **Firecracker** + **jailer** in the image (`FIRECRACKER_PATH`, `JAILER_PATH`)
- **Guest** `vmlinux`, `initrd.img`, `rootfs.ext4` (see `fetch-guest-kernel` / `build-vm`)
- **Linux + KVM**: `/dev/kvm` mounted, privileged Pod, `ip` / `socat` for TAP + SSH relay

## Why kernel + initrd artifacts?

Firecracker boots Linux from `vmlinux` + `initrd.img` and mounts `rootfs.ext4`. The **guest** OS is Ubuntu in your built image; the **host** must be Linux with KVM for production.

## Quick start — Linux (optional local container with KVM)

Build VM artifacts, then run the executor image on a **Linux** host or compose stack that exposes `/dev/kvm`:

```bash
(cd packages/executor && bun run build-vm)

# Example: Linux with Docker and /dev/kvm — not applicable on Mac for real FC VMs
docker compose -f docker-compose.e2e.yml up --build executor

curl http://localhost:7777/readyz
```

On **Mac**, use **Mode 2** (cluster executor-dev + port-forward) instead of expecting Firecracker on localhost.

### Building VM artifacts on macOS (optional)

You can build disk/kernel artifacts in a Linux VM (UTM, remote Linux box), then use them in the Docker image — that does not run Firecracker on the Mac host.

## API Endpoints

### Health Check

```bash
GET /readyz
```

Response:

```json
{
  "ok": true,
  "service": "executor",
  "mode": "firecracker",
  "guest": "x86_64",
  "firecrackerVersion": "Firecracker v1.x.x",
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

| Variable                   | Default                                      | Description                                      |
| -------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `PORT`                     | `7777`                                       | HTTP API port                                    |
| `VM_INACTIVITY_TIMEOUT_MS` | `300000`                                     | Auto-cleanup after inactivity (5 min)            |
| `KERNEL_PATH`              | `packages/executor/output/vmlinux` (dev)     | Linux kernel image                               |
| `INITRD_PATH`              | `packages/executor/output/initrd.img` (dev)  | Initramfs (required)                             |
| `ROOTFS_PATH`              | `packages/executor/output/rootfs.ext4` (dev) | ext4 root disk                                   |
| `FIRECRACKER_PATH`         | `/usr/bin/firecracker`                       | Firecracker binary path                          |
| `JAILER_PATH`              | `/usr/bin/jailer`                              | Jailer binary path                               |
| `VM_DATA_DIR`              | `/tmp/veritly-vms`                             | Per-session VM state                             |
| `VM_CPUS`                  | `1`                                          | vCPU count                                       |
| `VM_MEMORY_MIB`            | `1024`                                       | RAM (MiB) per guest                              |
| `SSH_BOOT_TIMEOUT_MS`      | `90000`                                      | Wait for SSH on relay port                       |

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
- In **Mode 1**, backend uses in-cluster Service URL only
- VMs may have internet access (for package installation) depending on cluster networking

## Session Lifecycle

1. **First command** → VM created (~boot time varies)
2. **Active use** → Commands execute in same VM
3. **Inactivity** → VM cleaned up after timeout
4. **New command after cleanup** → Session missing → new VM on next exec
5. **Session end** → VM destroyed

## VM Image Contents

The Docker image builds a Ubuntu-based rootfs with:

- Python 3 + pip
- OpenSSH server
- **Univer SDK** pre-installed
- `/workspace` directory for session files

## Docker Compose (Linux + KVM)

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
  privileged: true
  cap_add:
    - NET_ADMIN
    - NET_RAW
  volumes:
    - /dev/kvm:/dev/kvm
```

## Troubleshooting

### `/readyz` returns 503 (`ready: false`)

- `firecracker` executable (`FIRECRACKER_PATH`)
- Artifacts exist and `rootfs.ext4` is > 1 MiB; `initrd.img` present
- `/dev/kvm` available and Pod privileged (**Mode 1**)

### Commands timeout

- Guest still booting — raise `SSH_BOOT_TIMEOUT_MS` or `VM_MEMORY_MIB`
- Guest arch matches built `ROOTFS_PATH` / kernel

### SSH connection fails

- Increase `SSH_BOOT_TIMEOUT_MS`
- Dev images use `root` / `root`

### Backend can't connect (**Mode 1**)

- Use the **in-cluster** executor Service URL from the API Pod, not localhost unless you deliberately use **Mode 2** port-forward.

### Backend can't connect (**Mode 2**)

- `kubectl port-forward` running and `VERITLY_EXECUTOR_URL` matches the local bind address

## Backend Integration

The bash tool in `packages/opencode/src/tool/bash.ts` sends commands to the executor:

```typescript
const result = await fetch(`${EXECUTOR_URL}/v1/sessions/${sessionId}/exec`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ command, timeout }),
})
```

In **Mode 1**, `EXECUTOR_URL` is the cluster-internal base URL. In **Mode 2**, it is typically `http://127.0.0.1:<port>` while port-forward is active.

## Future Improvements

- [ ] Add streaming output via WebSocket/SSE
- [ ] VM snapshots for faster session resume
- [ ] File sync between backend and VMs
- [ ] Resource limits (CPU, memory per VM)
- [ ] VM pool for faster cold start
- [ ] Multi-region executor deployment
