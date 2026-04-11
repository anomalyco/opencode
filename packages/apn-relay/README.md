# APN Relay

Minimal APNs relay for OpenCode mobile background notifications.

## What it does

- Registers iOS device tokens for a shared secret.
- Receives OpenCode event posts (`complete`, `permission`, `error`).
- Sends APNs notifications to mapped devices.
- Stores delivery rows in PlanetScale.

## Routes

- `GET /health`
- `GET /` (simple dashboard)
- `POST /v1/device/register`
- `POST /v1/device/unregister`
- `POST /v1/event`

## Environment

Use `.env.example` as a starting point.

- `DATABASE_HOST`
- `DATABASE_USERNAME`
- `DATABASE_PASSWORD`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_PRIVATE_KEY`
- `APNS_DEFAULT_BUNDLE_ID`

## Run locally

```bash
bun install
bun run src/index.ts
```

## Docker

Build from this directory:

```bash
docker build -t apn-relay .
docker run --rm -p 8787:8787 --env-file .env apn-relay
```
