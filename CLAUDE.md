# CLAUDE.md

## Quick Start

All common commands are in the root `Makefile`. Run `make` targets from the repo root.

| Command | What it does |
|---------|-------------|
| `make install` | `bun install` |
| `make dev` | Backend + frontend with hot reload |
| `make dev-server` | Backend only (port 4096) |
| `make dev-web` | Frontend only (port 5174) |
| `make up` | Docker build & start — production-like (port 4096) |
| `make dev-up` | Docker with source mounted — no rebuild on code changes |
| `make down` | Stop Docker containers |
| `make logs` | Tail Docker logs |
| `make rebuild` | Force Docker rebuild |
| `make clean` | Stop Docker + wipe volumes |
| `make shell` | Bash into the Docker container |
| `make typecheck` | Run turbo typecheck |
| `make test-e2e` | Run Playwright e2e tests |

First `make up` auto-creates `.env.local` with defaults (login: `opencode`/`opencode`). Edit it to customise.

For VPS production deploys, see `deploy/vps-single-customer/`.

## License System

License keys are **not stored in this repository**. They are validated server-side against a remote license service.

- The app calls `POST /v1/licenses/activate` with the key, and the server responds with activation status, expiry, and entitlement tokens.
- Refresh uses `POST /v1/licenses/refresh` with the entitlement/refresh tokens.
- The license service URL is configured via `VITE_OPENCODE_LICENSE_URL` (see `packages/app/.env.example`).
- License state is persisted client-side in localStorage under `opencode.global.dat:license`.
- The console backend (`packages/console`) manages licenses via Stripe integration and syncs them to workspaces.
- E2E tests bypass the license server entirely by seeding localStorage directly with an active license state (see `packages/app/e2e/fixtures.ts`).
