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
