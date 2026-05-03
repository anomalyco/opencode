# Veritly Executor

HTTP service that runs **MicroPython** in per-session workspace directories on the host (no QEMU or VMs).

## Layout

- `src/server.ts` — Hono API, session lifecycle, subprocess runner
- `mpy-lib/veritly_univer_sdk.py` — MicroPython-importable stub (`RangeRect`, `UniverSDK`); full CPython async client lives in `packages/univer-sdk/python`

## Local run

1. Install [MicroPython](https://micropython.org/) (`micropython` on `PATH`).
2. From repo root: `bun install --cwd packages/executor` then `bun run --cwd packages/executor start`

Optional env:

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `7777`) |
| `EXECUTOR_DATA_DIR` | Session roots (default `/tmp/veritly-executor`; `VM_DATA_DIR` still accepted) |
| `MICROPYTHON_BIN` | Interpreter binary (default `micropython`) |
| `MICROPYTHON_LIB` | Directory prepended to `MICROPYPATH` (default `packages/executor/mpy-lib` next to `src`) |
| `VM_INACTIVITY_TIMEOUT_MS` | Idle session GC (default `300000`) |
| `READYZ_INTERVAL_MS` | `/readyz` cache TTL (default `60000`; `0` disables cache) |

## API

- `GET /livez` — liveness
- `GET /readyz` — MicroPython runnable + bundle import probe (`__readyz_ok__`)
- `POST /v1/sessions/:id/exec` — JSON `{ "code": string, "timeout"?: number, "workdir"?: string }` (`workdir` is relative to the session directory; `..` rejected)
- `GET /v1/sessions/:id/status` — session metadata
- `POST /v1/sessions/:id/close` — drop session dir
- `GET /v1/admin/sessions` — list active sessions

## Docker / Kubernetes

`docker/Dockerfile.executor` installs Ubuntu `micropython`, copies `mpy-lib`, runs Bun. Production manifests (`deploy/k8s/base/03-executor.yaml`) use normal security context (no KVM, not privileged).

## OpenCode

Set `VERITLY_EXECUTOR_URL` to the executor base URL. The `micropython` tool in `packages/opencode` calls this API.

Integration tests: `bun run --cwd packages/opencode test:executor-sdk` (expects a reachable executor, e.g. port-forward to `executor-dev`).
