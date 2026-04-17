# Env Layout

This repo now treats these as the only canonical env files:

- `.env.development`: local dev, WebStorm, Vite, sdk-relay, local Docker Compose
- `.env.production`: self-host and Kubernetes source of truth

Legacy files can be removed once you confirm the new pair works for your setup:

- `.env`
- `packages/app/.env`

## Consumers

- `.env.development` keeps split listen vars: `DEV_FRONTEND_HOST`, `DEV_FRONTEND_PORT`, `DEV_BACKEND_HOST`, `DEV_BACKEND_PORT`
- Local dev launchers derive `PUBLIC_BASE_URL`, `WORKOS_REDIRECT_URI`, and `VITE_OPENCODE_SERVER_*` from those split vars
- `.env.development` also owns `DATABASE_URL` for the standalone backend, and the dev compose files publish Postgres on `localhost:5432` to match it
- `packages/app` loads env from the repo root, not `packages/app/.env`
- `packages/opencode/veritly-debug-serve.ts` loads `.env.development` automatically
- `packages/univer-sdk` reads `.env.development`
- `docker-compose.dev.yml` and `docker-compose.separated.yml` read `.env.development`
- `deploy/k8s/sync-env.sh` syncs `.env.production` into `veritly-config` and `veritly-secrets`

## WebStorm

The existing Bun debug config keeps working because the debug entrypoint now loads `.env.development` itself. You no longer need a separate per-package app env file for that flow.

## Executor (Firecracker MicroVMs)

The executor service runs bash commands in isolated Firecracker microVMs per session.

### Backend Configuration (`packages/opencode`)

- `VERITLY_EXECUTOR_URL`: HTTP endpoint for executor API (default: `http://executor:7777`)

### Executor Configuration (`packages/executor`)

- `PORT`: Executor API port (default: `7777`)
- `VM_INACTIVITY_TIMEOUT_MS`: Auto-cleanup VMs after inactivity (default: `300000` = 5 min)
- `KERNEL_PATH`: Path to Firecracker kernel (default: `/opt/veritly/vmlinux`)
- `ROOTFS_PATH`: Path to VM root filesystem (default: `/opt/veritly/rootfs.ext4`)
- `FIRECRACKER_BINARY`: Path to firecracker binary (default: `/usr/local/bin/firecracker`)
- `VM_DATA_DIR`: Directory for VM sockets and configs (default: `/tmp/veritly-vms`)
- `VM_SSH_KEY`: Private key for SSH access to VMs (optional)

### Security Model

- Each session gets its own Firecracker microVM with UUIDv4 identifier
- VMs are isolated - no shared state between sessions
- VMs auto-terminate after inactivity timeout
- Backend automatically recreates VM if executor returns 404
- No auth between backend and executor (internal network only)
- VMs have full access to their own filesystem and network
