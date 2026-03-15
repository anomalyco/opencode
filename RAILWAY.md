# Railway runtime

This repo can run as a single Railway service using the upstream `opencode web` command.

## What it does

- installs the full monorepo with `bun install`
- starts `opencode web`
- serves the OpenCode web UI and API together on one port
- keeps OpenCode state under `/data`
- uses `/workspace` as a symlink to `/data/workspace`

## Railway setup

Create one Railway service from this repo and use:

- Dockerfile: `Dockerfile`
- volume mount: `/data`
- healthcheck path: `/global/health`

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
docker build -t opencode-railway .
docker run --rm -p 3000:3000 -e OPENCODE_SERVER_PASSWORD=testpass opencode-railway
```

Then open `http://localhost:3000`.
