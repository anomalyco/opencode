# P4 spike — hosted tenant directory (1 hour)

**Goal:** Prove voice + opencode work when code lives on a **tenant path** (simulating hosted), not your laptop checkout.

**Status:** runnable in ~15 minutes once opencode + sidecar are up.

---

## Setup (fake tenant)

```sh
mkdir -p /tmp/hosted-demo/user-1
git clone --depth 1 file:///path/to/opencode /tmp/hosted-demo/user-1/opencode
# Tenant path:
export TENANT_DIR="/tmp/hosted-demo/user-1/opencode"
```

---

## Terminal 1 — opencode

```sh
cd /path/to/opencode
bun dev serve
# Note the port (e.g. 4096 or dynamic)
```

---

## Terminal 2 — sidecar

```sh
cd packages/voice-sidecar && source .venv/bin/activate
export XAI_API_KEY="xai-…"
export OPENCODE_DIRECTORY="$TENANT_DIR"
export OPENCODE_SERVER_URL="http://127.0.0.1:4096"   # match terminal 1
export OPENCODE_AGENT="build"
export OPENCODE_MODEL_PROVIDER="opencode"
export OPENCODE_MODEL_ID="big-pickle"
voice-stt serve --port 8765
```

---

## Terminal 3 — verify

### Text (no mic)

```sh
export OPENCODE_DIRECTORY="$TENANT_DIR"
export OPENCODE_SERVER_URL="http://127.0.0.1:4096"
voice-stt ask --server http://127.0.0.1:4096 "list the top-level files and folders in this workspace"
```

**Pass:** Reply mentions `packages/`, `AGENTS.md`, etc. — contents of **tenant clone**, not `/Users/you/...`.

### Web app

```sh
# Encode tenant path for URL (same as app routing)
python3 -c "import base64; print(base64.urlsafe_b64encode('$TENANT_DIR'.encode()).decode().rstrip('='))"

VITE_OPENCODE_SERVER_PORT=4096 bun run --cwd packages/app dev
# Open http://localhost:3000/{encoded-dir}/session
# Mic on → speak same command
```

**Pass:** Same behavior as local dev, but session runs against `$TENANT_DIR`.

---

## What this proves

| Claim | Evidence |
|---|---|
| No new workspace API needed for v1 | Same `OPENCODE_DIRECTORY` + session headers |
| Hosted = different filesystem root | Tenant path under `/tmp/hosted-demo/...` |
| Voice stack unchanged | sidecar + web composer already pass directory |

---

## What this does NOT prove (later P4 work)

- GitHub OAuth / auto-clone on sign-in
- Multi-tenant auth (browser → sidecar → opencode tokens)
- HTTPS deploy, rate limits
- Process isolation between tenants

---

## Next after spike

See **[voice-p4-staging-deploy.md](./voice-p4-staging-deploy.md)** for the full staging topology.

1. Slice 1 — app hosted server URL + `VITE_*` ✅
2. Slice 2 — Dockerfiles (bun server + voicar) ✅
3. Slice 3 — **Fly.io** (UI + bun server + voicar) — see deploy checklist
4. Tenant provisioning (GitHub → tenant directory on Fly volume)
6. Auth wiring
7. P5/P6 quality on staging
