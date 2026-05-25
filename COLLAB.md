# Collab Sessions — How It Works

## TL;DR for teammates

**You do not need to install anything.** Just click an invite link, sign in with GitHub, and you're in the session — in your browser.

---

## Architecture: who needs what

```
┌─────────────────────────────────┐      invite link      ┌──────────────────┐
│  Server admin (Hanno)           │ ───────────────────▶  │  Teammate        │
│  • Runs Docker on their Mac     │                        │  • Browser only  │
│  • Holds the Claude API creds   │  ◀── browser access ─ │  • GitHub login  │
│  • Manages collab sessions      │       via ngrok        │  • No install    │
└─────────────────────────────────┘                        └──────────────────┘
```

**The server holds the LLM credentials.** Every prompt in a Collab Session — whether sent by the Driver or approved from a Contributor suggestion — is executed by the server using the server's Claude API key. Teammates' own Claude or Anthropic accounts are not involved and not needed.

This is intentional: it's a *shared coding environment*, not a billing relay. One team subscription powers the shared session.

---

## For teammates: joining a session

1. **Receive an invite link** from the session Driver (looks like `https://corrosive-cola-chalice.ngrok-free.dev/collab/invite/abc123`)
2. **Open it in your browser** — no install needed
3. **Sign in with GitHub** (OAuth popup — this only verifies you're in the `unleashlive` org)
4. You're in. What you can do depends on your role:

| Role | Can do |
|------|--------|
| **Driver** | Send prompts directly to the LLM, approve/reject Contributor suggestions, manage roles |
| **Contributor** | Submit prompt suggestions (Driver reviews before execution), vote in Vote Pool mode |
| **Viewer** | Read-only — see all messages and queue updates in real time |

Your role is set in the invite link. The Driver can change roles live from the session UI.

---

## For the server admin: running the server

### Prerequisites

- Docker (OrbStack recommended on Mac M-series)
- ngrok account (free tier works)
- A GitHub OAuth App registered at https://github.com/settings/developers
  - Callback URL: `https://your-ngrok-url/collab/auth/github/callback`
- Either an Anthropic API key **or** Claude Code subscription credentials

### Quick start

```bash
git clone https://github.com/unleashlive/opencode
cd opencode
cp .env.example .env        # then fill in the values
ngrok http 4096 &           # note your https URL
docker compose up --build -d
```

### Required `.env` values

```bash
# GitHub OAuth App (created at github.com/settings/developers)
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...

# GitHub org membership check
GITHUB_ORG_NAME=unleashlive
GITHUB_TOKEN=ghp_...        # PAT with read:org scope

# Public URL (ngrok URL for local testing, domain for production)
OPENCODE_BASE_URL=https://YOUR-NGROK-ID.ngrok-free.dev

# Random secret: openssl rand -hex 32
SESSION_SECRET=...

# LLM credentials — one of:
# Option A (default): Claude Code subscription — see "Credentials" section below
# Option B: API key (metered $)
# ANTHROPIC_API_KEY=sk-ant-...
```

### LLM credentials: two options

#### Option A — Claude Code subscription (recommended)
Leave `ANTHROPIC_API_KEY` unset (or absent from `.env`). The server uses the `opencode-claude-auth` plugin (already configured in the Docker image).
In production (ECS) the literal placeholder `ANTHROPIC_API_KEY=dummy` is **rejected** — ADR-0001 Phase 4 treats `"dummy"` as missing and refuses to boot.

On macOS, extract your credentials once:

```bash
# Run on the Mac that runs Docker:
security find-generic-password -s "Claude Code-credentials" -w > ~/.claude/.credentials.json
```

The `docker-compose.yml` bind-mounts `~/.claude/.credentials.json` into the container (read-only). If the token expires, run the command again — no container restart needed.

> **Important:** This shares *your* Claude subscription with the server — all LLM usage is billed to your account. Teammates do not need and cannot use their own Claude subscriptions through this path. If you want per-user billing, use the API key option with an org-level key.

#### Option B — Anthropic API key (metered $)
Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env`. All LLM costs are billed to that key. The presence of a non-empty, non-`"dummy"` value bypasses the `opencode-claude-auth` plugin entirely.

---

## Creating a Collab Session (Driver flow)

1. Go to `http://localhost:4096/collab/new` (or your ngrok URL)
2. Sign in with your GitHub account
3. Fill in:
   - **Session name** — e.g. "Auth refactor sprint"
   - **Visibility while typing** — how much others see before you submit
   - **Prompt queue mode** — FIFO (first-come) or Vote Pool (democratic)
4. Click **Create Collab Session**
5. In the session view, click **Invite** → pick a role → copy the link
6. Share the link with teammates

---

## Does everyone need to commit / install from GitHub?

**Collaborators: No.** They only need a browser and the invite link. Nothing to clone or install.

**Anyone who wants to run their own server: Yes.** Clone this repo, copy `.env.example`, fill in credentials, and run `docker compose up --build -d`. The entire server is self-contained in Docker.

---

## Persisted data

| What | Where | Survives restart? |
|------|-------|-------------------|
| Sessions, messages, participants | Named volume `opencode-data` | ✅ Yes |
| Server-side repo workspaces | Named volume `collab-workspaces` | ✅ Yes |
| In-memory SSE connections | Container RAM | ❌ Reconnects on reload |
| Cookie sessions (GitHub auth) | Container RAM | ❌ Re-auth on restart |

---

## Updating ngrok URL

If your ngrok URL changes, update two things:

1. `.env` → `OPENCODE_BASE_URL=https://NEW-URL.ngrok-free.dev`
2. Your GitHub OAuth App's callback URL → `https://NEW-URL.ngrok-free.dev/collab/auth/github/callback`

Then: `docker compose up -d --force-recreate`

---

## What gets committed to GitHub

All source code changes are committed. Secrets are **never** committed.

```
.gitignore / .dockerignore already exclude:
  .env
  ~/.claude/.credentials.json  (bind-mounted from host, not in repo)
```

The `.env.example` file documents all required variables without values.
