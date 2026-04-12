# Cloudflare Tunnel (local HTTPS / WSS like production)

Use this when you already use Cloudflare and want **real `https://` + `wss://`** against a **local** process without deploying to Railway every time.

## Quick tunnel (no config file)

Requires [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) installed.

1. Start whatever listens on HTTP locally (Vite on `3000`, or the full hosted Docker image on `3000`).
2. Run:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Cloudflare prints a **`https://*.trycloudflare.com`** URL. That origin uses **TLS**; **WebSocket** upgrades work the same as prod (`wss://` to that host).

3. Open that URL in the browser. For the **spreadsheet relay**, you still need either:
   - **Full stack** on `3000` (edge `serve-custom-app` + OpenCode + sdk-relay), or  
   - **Vite only** plus `DEV_PROXY_TARGET` + `VITE_UNIVER_SDK_WS=/api/univer-sdk-relay/ws` in `packages/app/.env` so `/api` proxies to a real backend (see `vite.config.ts`).

## Named tunnel + your own hostname

Copy `cloudflared.config.example.yml` → `cloudflared.config.yml`, set `tunnel`, `credentials-file`, `hostname`, and `service` URL. Then:

```bash
cloudflared tunnel --config cloudflared.config.yml run
```

Point the DNS record for `hostname` at the tunnel in the Cloudflare dashboard.

## What “prod-like” means here

- **Same-origin** `https` page talking **`wss`** to the **same host** (no cross-origin WS quirks).
- Still **not** identical to Railway if the **origin** behind Cloudflare differs (headers, caching rules). For **parity**, run the **same** container/process you ship (edge on `3000` + loopback OpenCode + sdk-relay).

## Checklist: relay URL in the app

- **Hosted build:** `VITE_UNIVER_SDK_WS=/api/univer-sdk-relay/ws` (relative) so the browser uses `wss://<current-host>/api/...`.
- **Tunnel hostname:** use the **trycloudflare** or **custom** hostname as the site origin; keep the same relative path.

## Railway / `test1` note (Apr 2026)

A plain **GET** (no WebSocket upgrade) to  
`https://test1.veritly.co.uk/api/univer-sdk-relay/ws`  
still returned **SPA HTML** (`text/html`, `<!doctype html>`), while an **Upgrade** request **timed out with 0 bytes**. That usually means **routing or CDN** in front of the Node edge is wrong for `/api/*`, not the browser “Provisional headers” label. Fix **ingress** so `/api/**` reaches the process that runs `serve-custom-app.mjs` (and does **not** serve the SPA shell for those paths).
