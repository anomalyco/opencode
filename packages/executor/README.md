# Veritly QEMU Executor

Isolated command execution: each session runs a QEMU VM with **direct kernel boot**, **`-nodefaults`**, **virtio user networking** (SSH host-forward), and a **9p-mounted** per-session root directory (copied from a minimal Alpine template). No Firecracker, no ext4 disk image for the guest root.

## Layout

Guest bundles live under `packages/executor/output/<aarch64|x86_64>/`:

- `vmlinuz` — kernel  
- `initrd.img` — optional; present when Alpine `linux-virt` ships it  
- `guest-root/` — directory rootfs template (includes OpenSSH, Python, `veritly_univer_sdk`)

Build (requires Docker, cross-arch supported):

```bash
(cd packages/executor && bun run build-vm)
bun run --cwd packages/executor verify-artifacts
```

## Modes

### 1. Production — executor in the cluster

- Pod is **Linux** with **`/dev/kvm`** when the node matches the guest ISA (aarch64 guest on arm64 nodes, x86_64 on amd64). Image installs `qemu-system-arm` and `qemu-system-x86`.
- OpenCode reaches the executor via in-cluster Service DNS (e.g. `http://executor:7777`), not port-forward.

### 2. Local laptop (e.g. macOS Apple Silicon)

- Install QEMU: `brew install qemu`
- Build guests (above), then: `bun run --cwd packages/executor start`
- On Darwin, **HVF** is used for aarch64 guests; x86_64 guests use **TCG** (slow but works).

### 3. Cluster dev image + port-forward (optional)

Same as before: deploy `executor-dev`, `kubectl port-forward`, set `VERITLY_EXECUTOR_URL=http://127.0.0.1:7777`. SDK integration tests use this URL.

## API

- `GET /livez` — cheap process liveness (`ok` text).
- `GET /readyz` — deep readiness: **HTTP 200 only if** static checks pass **and** a throwaway QEMU guest boots, SSH connects, and `echo __readyz_ok__` succeeds. JSON includes `static` (paths, sizes, KVM device, template checks), `vm` (probe timings, command output, `serialTail` on failure), and `errors`. Responses within `READYZ_INTERVAL_MS` repeat the last result with `cached: true` (kube should use a period ≥ that interval and a long enough `timeoutSeconds`).
- `POST /v1/sessions/:id/exec` — `{ command, timeout? }`
- `GET /v1/sessions/:id/status`
- `POST /v1/sessions/:id/close`

## Environment (sparing)

| Variable | Role |
|----------|------|
| `PORT` | HTTP port (default `7777`) |
| `VM_DATA_DIR` | Per-session VM and workspace dirs |
| `VM_INACTIVITY_TIMEOUT_MS` | Idle cleanup |
| `VM_MEMORY_MIB` / `VM_CPUS` | Guest sizing |
| `SSH_BOOT_TIMEOUT_MS` | Wait for SSH after QEMU start |
| `READYZ_INTERVAL_MS` | Min milliseconds between full `/readyz` probes (default `60000`; set `0` to disable cache) |
| `KERNEL_PATH` / `INITRD_PATH` | Override kernel/initrd files (defaults under `output/<guest>/`) |
| `QEMU_PATH` | Override QEMU binary |

Guest ISA is inferred from `process.arch` (`arm64` → aarch64 bundle, else x86_64).

## Docker image

`docker/Dockerfile.executor` copies `packages/executor/output/aarch64` and `x86_64` into `/app/output/`. The server resolves `../output` relative to `src/`.

## Troubleshooting

- **`/readyz` 503**: read `errors`, `static`, and `vm.serialTail`. Often: missing guest (`build-vm`), QEMU not on `PATH`, or SSH still booting (raise `SSH_BOOT_TIMEOUT_MS`). Host checks use `guest-root/bin/busybox`, not `bin/sh` (symlink breaks on the host copy).
- **SSH timeout**: raise `SSH_BOOT_TIMEOUT_MS`; inspect `VM_DATA_DIR/vms/<id>/serial.log` or the probe’s `serialTail` in `/readyz`.
