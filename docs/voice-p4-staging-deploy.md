# P4 — Staging deploy architecture

**Goal:** Deploy voice end-to-end on staging so a remote user can open the web app, enable mic, speak, and hear a reply against a **tenant directory** on the server.

**Status:** All three apps on **Fly.io** — [`scripts/deploy-voice-staging.sh`](../scripts/deploy-voice-staging.sh).

**Companion:** [`voice-p4-spike-hosted-directory.md`](./voice-p4-spike-hosted-directory.md) · [`voice-architecture.md`](./voice-architecture.md) · [`voice-roadmap.md`](./voice-roadmap.md)

---

## Staging topology (all Fly)

Three Fly apps in the same org:

```
┌─────────────────────────────────────────────────────────────┐
│  Fly.io                                                      │
│                                                              │
│  opencode-voice-ui.fly.dev        — UI (nginx + Vite dist)  │
│  opencode-voice-server.fly.dev    — bun server              │
│  opencode-voice-sidecar.fly.dev   — voicar                  │
│                                                              │
│  (persistent volume on server app: /tenants)                 │
└─────────────────────────────────────────────────────────────┘
```

| App | Package | URL | Process |
|---|---|---|---|
| **UI** | `packages/app` | `https://opencode-voice-ui.fly.dev` | nginx serves `dist` (Docker) |
| **bun server** | `packages/opencode` | `https://opencode-voice-server.fly.dev` | `opencode serve` (Docker) |
| **voicar** | `packages/voice-sidecar` | `https://opencode-voice-sidecar.fly.dev` | `voice-stt serve` (Docker) |

UI build bakes in server/sidecar URLs via [`packages/app/fly.toml`](../packages/app/fly.toml) `[build.args]`.

---

## Deploy now (checklist)

Use a **deploy** terminal (not your local **bun server** / **voicar** / **UI** dev terminals).

```sh
# 1. Install flyctl (once)
curl -L https://fly.io/install.sh | sh
# Add to ~/.zshrc, then restart the terminal or: source ~/.zshrc
export FLYCTL_INSTALL="$HOME/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

# Verify
fly version

# 2. Log in (opens browser)
fly auth login

# 3. Create apps (once)
fly apps create opencode-voice-server
fly apps create opencode-voice-sidecar
fly apps create opencode-voice-ui

# 4. Tenant disk for bun server (once)
fly volumes create tenants --size 10 --region iad -a opencode-voice-server

# 5. Secrets
fly secrets set OPENCODE_SERVER_PASSWORD="your-password" XAI_API_KEY="xai-…" \
  -a opencode-voice-server

fly secrets set XAI_API_KEY="xai-…" OPENCODE_SERVER_PASSWORD="your-password" \
  VOICE_SIDECAR_TOKEN="your-sidecar-token" \
  OPENCODE_SERVER_URL="https://opencode-voice-server.fly.dev" \
  VOICE_CORS_ORIGINS="https://opencode-voice-ui.fly.dev" \
  -a opencode-voice-sidecar

# 6. Deploy all three (from repo root)
cd /Users/nivedita/git/opencode
./scripts/deploy-voice-staging.sh
```

Verify:

```sh
curl -s https://opencode-voice-server.fly.dev/global/health
curl -s https://opencode-voice-sidecar.fly.dev/health
curl -sI https://opencode-voice-ui.fly.dev | head -1
```

Open **https://opencode-voice-ui.fly.dev** → session → mic → speak.

**Auth:** if `OPENCODE_SERVER_PASSWORD` is set, use  
`?auth_token=<base64(opencode:your-password)>` once.

**External users:** anyone with the UI Fly URL can use voice once health checks pass. Add real sign-in (Slice 6) before a broad public launch.

> Change app names in each `fly.toml` if these names are already taken on Fly. Update `[build.args]` in `packages/app/fly.toml` and `VOICE_CORS_ORIGINS` to match.

---

## Request flow (one voice turn)

1. Browser loads **UI** from `opencode-voice-ui.fly.dev`.
2. SDK calls `opencode-voice-server.fly.dev` (baked in at UI build time).
3. Mic opens WSS to `opencode-voice-sidecar.fly.dev`.
4. **voicar** STT → **bun server** `prompt_async` → summarize → TTS → WSS back.
5. **UI** plays audio; barge-in works.

---

## Config files

| Component | Files |
|---|---|
| **UI** | [`packages/app/Dockerfile`](../packages/app/Dockerfile), [`packages/app/nginx.conf`](../packages/app/nginx.conf), [`packages/app/fly.toml`](../packages/app/fly.toml) |
| **bun server** | [`packages/opencode/Dockerfile.server`](../packages/opencode/Dockerfile.server), [`packages/opencode/fly.toml`](../packages/opencode/fly.toml) |
| **voicar** | [`packages/voice-sidecar/Dockerfile`](../packages/voice-sidecar/Dockerfile), [`packages/voice-sidecar/fly.toml`](../packages/voice-sidecar/fly.toml) |
| **Deploy script** | [`scripts/deploy-voice-staging.sh`](../scripts/deploy-voice-staging.sh) |

Deploy individually:

```sh
./scripts/deploy-voice-staging.sh server
./scripts/deploy-voice-staging.sh sidecar
./scripts/deploy-voice-staging.sh ui
```

---

## Environment variables

### UI — Docker build args (`packages/app/fly.toml`)

| Arg | Default |
|---|---|
| `VITE_OPENCODE_SERVER_URL` | `https://opencode-voice-server.fly.dev` |
| `VITE_VOICE_SIDECAR_URL` | `https://opencode-voice-sidecar.fly.dev` |
| `OPENCODE_CHANNEL` | `beta` |

Change these in `fly.toml` before `./scripts/deploy-voice-staging.sh ui` if your app names differ.

### voicar — Fly secrets

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | STT + TTS |
| `OPENCODE_SERVER_URL` | `https://opencode-voice-server.fly.dev` |
| `OPENCODE_SERVER_PASSWORD` | Basic auth to server |
| `VOICE_SIDECAR_TOKEN` | Browser auth (when enforced) |
| `VOICE_CORS_ORIGINS` | `https://opencode-voice-ui.fly.dev` |

### bun server — Fly secrets + volume

| Variable / mount | Purpose |
|---|---|
| `OPENCODE_SERVER_PASSWORD` | HTTP Basic |
| `XAI_API_KEY` | Model provider |
| `OPENCODE_CORS_ORIGINS` | Comma-separated UI origins (hosted + `http://localhost:3000` for local dev) |
| Volume → `/tenants` | Tenant repo clones |

---

## What localhost proved

| Layer | Evidence |
|---|---|
| STT + TTS | `voice-stt serve`, xAI streaming |
| Control plane | Sidecar → opencode legacy session API |
| Media plane | Browser WSS → sidecar, TTS playback |
| Web composer | Mic, six states, barge-in, short spoken gist |
| Tenant path | `OPENCODE_DIRECTORY` on tenant clone |
| URL wiring | `VITE_*` baked into UI Docker build |

---

## Implementation slices

| Slice | Status | What |
|---|---|---|
| 1 | ✅ | App URL logic ([`hosted-url.ts`](../packages/app/src/utils/hosted-url.ts)) |
| 2 | ✅ | Docker images (server, sidecar, **UI**) |
| 3 | ✅ | Fly config for all three apps |
| 4 | **Deploy** | Run `./scripts/deploy-voice-staging.sh` |
| 5 | Pending | Tenant provisioning on Fly volume |
| 6 | Pending | Auth hardening |

---

## Local dev

### All local (default)

| Terminal | Runs |
|---|---|
| **bun server** | `bun run --cwd packages/opencode --conditions=browser src/index.ts serve` |
| **voicar** | `voice-stt serve --port 8765` |
| **UI** | `VITE_OPENCODE_SERVER_PORT=<port> bun run --cwd packages/app dev` |

### Local UI → Fly server + sidecar

Useful while iterating on the web app against staging backends:

```sh
# UI terminal only — no local bun server or voicar
VITE_OPENCODE_SERVER_URL=https://opencode-voice-server.fly.dev \
VITE_VOICE_SIDECAR_URL=https://opencode-voice-sidecar.fly.dev \
bun run --cwd packages/app dev
```

Open **http://localhost:3000**. Requires CORS on Fly for `http://localhost:3000` (see `OPENCODE_CORS_ORIGINS` / `VOICE_CORS_ORIGINS`).

Folder picker shows the **Fly server** filesystem, not your laptop.

---

## Pass criteria (staging)

- [ ] **UI** loads from `https://opencode-voice-ui.fly.dev`
- [ ] Network tab: SDK → server Fly app; voice → sidecar Fly app
- [ ] Mic + spoken reply; short gist + barge-in
- [ ] `/global/health` and `/health` green

---

## Future: WebRTC / LiveKit (P7)

Fly still hosts **bun server** + **voicar agent**. LiveKit Cloud replaces the WSS media path only. UI stays on Fly (or moves to CDN later).

---

## Explicitly defer

| Item | Phase |
|---|---|
| “Want more?” chunked read-aloud | P5 |
| Mid-turn decider | P5 |
| GitHub OAuth auto-clone | P4+ |
| LiveKit / WebRTC | P7 |
| SST/ECS ([`infra/voice.ts`](../infra/voice.ts)) | Optional alternate |

---

## Next action

1. Run the **Deploy now** checklist in a **deploy** terminal.
2. Open `https://opencode-voice-ui.fly.dev` and test voice.
3. **Slice 5** — tenant repos on Fly volume before inviting many external users.
