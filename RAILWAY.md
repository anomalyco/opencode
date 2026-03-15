# Railway runtime

This repo can run as a single Railway service using the custom `packages/app` frontend plus the OpenCode `serve` backend behind one public port.

## What it does

- installs the full monorepo with `bun install`
- builds the custom frontend from `packages/app`
- starts the OpenCode backend on an internal port
- serves the custom frontend on the public port and proxies API requests to the backend
- keeps OpenCode state under `/data`
- uses `/workspace` as a symlink to `/data/workspace`

## Railway setup

Create one Railway service from this repo and use:

- Dockerfile: `Dockerfile`
- volume mount: `/data`
- healthcheck path: `/healthz`

Required environment variables:

- `OPENCODE_SERVER_PASSWORD=<strong password>`

Useful optional environment variables:

- `OPENCODE_SERVER_USERNAME=opencode`
- `OPENAI_API_KEY=...`
- `ANTHROPIC_API_KEY=...`
- `CLOUDFLARE_ACCOUNT_ID=...`
- `CLOUDFLARE_GATEWAY_ID=...`
- `CLOUDFLARE_API_TOKEN=...`

## Local smoke test

```bash
OPENCODE_SERVER_PASSWORD=testpass bun run web:veritly
```

Then open `http://localhost:4097`.
