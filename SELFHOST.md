# Self-Hosted Veritly Stack

This repo contains the hosted OpenCode and the Univer integration. This document gives you a self-hosted Docker Compose setup rooted in `vendor/opencode-veritly`.

## Architecture

```
Browser ──► Traefik (sticky LB) ──► opencode (HTTP API)
          │
          └──► Traefik (sticky LB) ──► relay (WebSocket)
```

- **traefik**: Public HTTP edge and load balancer with sticky sessions
- **opencode**: HTTP API server (OpenCode backend)
- **relay**: Standalone WebSocket relay for Univer SDK (no HTTP proxy chain)
- **executor-api**: Execution boundary for shell work (microVM-ready)

The relay is now a **standalone service** - no more HTTP proxy chains through OpenCode. Traefik routes WebSocket connections directly to relay replicas with sticky cookies.

## Files

- App stack: [docker-compose.selfhost.yml](/Users/Apple/Documents/Github/veritly/vendor/opencode-veritly/docker-compose.selfhost.yml)
- Env example: [.env.selfhost.example](/Users/Apple/Documents/Github/veritly/vendor/opencode-veritly/.env.selfhost.example)
- Relay service: [deploy/relay/](/Users/Apple/Documents/Github/veritly/vendor/opencode-veritly/deploy/relay/)
- Executor API: [deploy/executor-api/server.mjs](/Users/Apple/Documents/Github/veritly/vendor/opencode-veritly/deploy/executor-api/server.mjs)

## Quick Start

### 1. Bring up Univer first

From the repo root:

```bash
docker compose \
  --project-directory vendor/helm-charts/docker-compose \
  -f vendor/helm-charts/docker-compose/docker-compose.yaml \
  up -d lb universer collaboration-envoy collaboration-server collaboration-helper-server univer-temporal univer-worker-exchange veritly-usip
```

This uses the external Docker network `univer-prod`.

### 2. Bring up Veritly self-host

From `vendor/opencode-veritly`:

```bash
cp .env.selfhost.example .env.selfhost
# Edit .env.selfhost and set OPENCODE_SERVER_PASSWORD
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up --build -d
```

## Sticky WebSocket Routing

Traefik handles sticky sessions for the relay service. When you scale:

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --scale relay=3
```

Browsers get a `veritly_relay` cookie that pins them to the same relay replica for the session.

**Note**: The relay keeps state in memory (`browser`, `agents`, `pending`). Without Redis:
- If a replica crashes, clients reconnect to a different replica = fresh session
- Agents should connect after browsers establish the session

## Scaling Limits

| Service | Current Limit | Scale Method |
|---------|--------------|--------------|
| `opencode` | 1 replica (SQLite/XDG state) | Wait for tenant rewrite |
| `relay` | Many replicas (sticky sessions) | `docker compose up --scale relay=N` |
| `executor-api` | Many replicas (stateless) | `docker compose up --scale executor-api=N` |

## Executor API Drivers

The executor service is the stable API boundary for shell execution.

Supported drivers:

- `stub`: returns `501`
- `local-process`: executes inside the executor container
- `host-binary`: calls a host-mounted runner binary such as `veritly-vmexec`
- `proxy`: forwards to another executor service

Recommended production:

- `EXECUTOR_DRIVER=host-binary` or `proxy`
- Back with a Linux host that has KVM and a microVM runtime (Firecracker/Kata)

## Hosted-Mode Filesystem Guard

The self-host compose enables:

- `OPENCODE_HOSTED_MODE=1`
- `OPENCODE_DISABLE_LOCAL_FILESYSTEM=1`

This disables local host filesystem semantics:

- file API routes return `501`
- workspace routes return `501`
- session shell returns `501`
- local-disk tools (`bash`, `read`, `glob`, `grep`, `edit`, `write`, etc.) are removed from the tool registry

## Remaining Work

1. **OpenCode tenant rewrite**: Make tables user-scoped instead of directory-scoped
2. **Virtual filesystem**: Replace local FS with object-backed storage
3. **Redis (optional)**: Add Redis for cross-replica relay state if needed

These are product/runtime changes, not deployment changes.
