# OpenCode Relay

A self-hosted relay server that enables device-to-device sharing of [OpenCode](https://opencode.ai) desktop sessions.

## What it does

The relay acts as a **control plane** for discovering and connecting to remote OpenCode instances:

1. **Account system** — register / login / session tokens
2. **Environment registry** — desktop instances register themselves as discoverable environments
3. **WebSocket reverse tunnel** — desktop establishes an outbound WebSocket; relay forwards client requests through it
4. **App access layer** — exposes an API shape that OpenCode Mobile and other clients recognize

The relay does **not** see opencode business traffic in plaintext. In V2 mode, traffic flows as binary frames through the WebSocket tunnel.

## Architecture

```
Client (Mobile / Desktop)              Relay Server                    Desktop (share-service)
       │                                     │                                   │
       │  POST /api/auth/login                │                                   │
       │  GET  /api/environments              │                                   │
       │  GET  /api/proxy/:envId/...          │                                   │
       │ ─────────────────────────────────►   │                                   │
       │                                     │  WebSocket tunnel (outbound)      │
       │                                     │ <──────────────────────────────── │
       │                                     │  /api/tunnel/:envId               │
       │                                     │                                   │
       │                                     │  Forward request via tunnel ──►   │ → localhost sidecar
       │                                     │  ◄── Response (binary frames) ─── │
       │  ◄── HTTP response ─────────────── │                                   │
```

## Quick start

### Prerequisites

- Node.js >= 22
- npm or bun

### Install

```bash
cd relay
npm install   # or: bun install
```

### Run

```bash
# Minimal
RELAY_PORT=9998 RELAY_HOST=127.0.0.1 RELAY_DATA_DIR=./data node server.js

# Behind nginx (recommended for TLS)
RELAY_PORT=9998 RELAY_HOST=127.0.0.1 RELAY_DATA_DIR=/opt/oc-relay/data \
RELAY_TRUST_PROXY=1 RELAY_PUBLIC_BASE=https://your-domain:9999 \
node server.js
```

### Production deployment

See `oc-relay.service` for a systemd unit example and `nginx-oc-relay.conf` for the nginx TLS terminator configuration.

Replace `<your-domain>` and `<your-server-ip>` placeholders with your actual values.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `RELAY_PORT` | `9999` | Port to listen on |
| `RELAY_HOST` | `127.0.0.1` | Bind address |
| `RELAY_DATA_DIR` | `/opt/oc-relay/data` | Data directory for `relay.json` |
| `RELAY_TRUST_PROXY` | (unset) | Set to `1` to trust `X-Forwarded-For` (behind nginx) |
| `RELAY_PUBLIC_BASE` | (empty) | Public base URL (for display only) |
| `RELAY_SESSION_TTL_MS` | `86400000` (24h) | Session inactivity timeout |
| `RELAY_SESSION_CLEANUP_MS` | `600000` (10min) | Session cleanup interval |
| `RELAY_RATE_LIMIT_WINDOW_MS` | `60000` (1min) | Rate limit window |
| `RELAY_RATE_LIMIT_MAX` | `10` | Max auth attempts per IP per window |

## API

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new account |
| `POST` | `/api/auth/login` | Login and get a session token |
| `GET` | `/api/auth/me` | Get current user |
| `POST` | `/api/auth/logout` | Destroy current session |

### Environments

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/environments` | List environments for current user |
| `POST` | `/api/environments` | Register/update an environment |
| `PATCH` | `/api/environments/:id` | Update environment (heartbeat) |
| `POST` | `/api/environments/:id/heartbeat` | Heartbeat + probe |
| `DELETE` | `/api/environments/:id` | Delete environment |

### Proxy

| Method | Path | Description |
|---|---|---|
| `*` | `/api/proxy/:envId/:rest*` | Proxy request to environment via tunnel |
| `GET` | `/global/health` | Health check |

### WebSocket

| Path | Description |
|---|---|
| `/api/tunnel/:envId` | Desktop reverse tunnel (outbound, persistent) |
| `/api/proxy/:envId/...` | Client terminal session (WebSocket upgrade) |

## V2 binary frame protocol

The relay supports two tunnel protocols:

### V1 (legacy, JSON + base64)

All messages are JSON text frames. Binary data is base64-encoded.

```
relay → desktop: { type:'req', id, method, path, headers, body? }
desktop → relay: { type:'res', id, status, headers }
                  { type:'chunk', id, data }    (multiple)
                  { type:'end', id }
```

### V2 (binary frames, no base64)

Metadata uses JSON text frames; binary data uses WebSocket binary frames.

```
relay → desktop (text):   { t:1, id, method, path, headers }   request start
relay → desktop (binary): [idLen:2B BE][id][raw body bytes]     request body chunk
relay → desktop (text):   { t:2, id }                            request body end

desktop → relay (text):   { t:3, id, status, headers }          response headers
desktop → relay (binary): [idLen:2B BE][id][raw body bytes]     response body chunk
desktop → relay (text):   { t:4, id }                            response end
```

Protocol negotiation: desktop sends `Sec-WebSocket-Protocol: oc-tunnel-v2` during WebSocket handshake. Relay checks `ws.protocol` to select V2 or fall back to V1.

### Backpressure

V2 includes backpressure control: if `ws.bufferedAmount` exceeds 2MB, the sender pauses and waits for the `drain` event before continuing.

## Security

- Passwords hashed with scrypt (N=16384, r=8, p=1) + per-user random salt
- Session tokens are 32-byte base64url random values
- Sessions expire after 24h of inactivity (configurable)
- Rate limiting on auth endpoints (10 attempts/min/IP, configurable)
- Relay listens on loopback only; TLS terminated by nginx
- `RELAY_TRUST_PROXY=1` should only be set behind a trusted reverse proxy

## Data storage

All data is stored in a single JSON file (`relay.json` in `RELAY_DATA_DIR`). Writes are atomic (write temp file + rename). The data volume is small (a few accounts + a few machines), so no database is needed.

## License

MIT
