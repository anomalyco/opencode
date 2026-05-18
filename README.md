# unleashlive/opencode

> **This is the [unleashlive](https://github.com/unleashlive) fork of [opencode](https://github.com/anomalyco/opencode).**
> It adds **Collab Sessions** — real-time multi-user AI coding sessions where your whole team shares one LLM context, with role-based participation and a shared prompt queue.
>
> Upstream opencode docs and install instructions are preserved below.

---

## Collab Sessions

### What is a Collab Session?

A Collab Session lets two or more developers share a single opencode session — same conversation, same codebase, same LLM context. One person drives, others contribute or watch.

- **Driver** — sends prompts directly to the LLM, approves suggestions from Contributors, manages roles
- **Contributor** — submits prompt suggestions for the Driver to approve before execution, votes in Vote Pool mode
- **Viewer** — read-only access to the full session in real time

The server runs on one machine. Everyone else joins in their browser — **no install required for collaborators.**

---

## Joining a session (collaborators)

**You need: a browser and a GitHub account in the `unleashlive` org. Nothing else.**

1. Receive an invite link from the session Driver — it looks like:
   ```
   https://corrosive-cola-chalice.ngrok-free.dev/collab/invite/abc123xyz
   ```
2. Open it in your browser
3. Click **Sign in with GitHub** — this just confirms you're in the org
4. You're in the session with the role the Driver assigned you

That's it. No Docker, no API keys, no local setup.

---

## Starting a session (Driver)

The server is running at: **https://corrosive-cola-chalice.ngrok-free.dev**

1. Go to [`/collab/new`](https://corrosive-cola-chalice.ngrok-free.dev/collab/new)
2. Sign in with your GitHub account (unleashlive org member)
3. Fill in your session:
   - **Session name** — e.g. "Drone API refactor"
   - **Visibility while typing** — choose how much teammates see before you submit a prompt:
     - *Submitted only* — they see prompts only after you send
     - *Typing indicator* — shows "Hanno is typing…" while you compose
     - *Live preview* — they see your draft in real time
   - **Prompt queue mode**:
     - *FIFO* — prompts execute in the order received
     - *Vote Pool* — team votes on suggestions; highest score runs first
4. Click **Create Collab Session**
5. From the session page, click **Invite** → pick a role → copy the link → share it

---

## How it works

```
Your browser ──── HTTPS ──── ngrok tunnel ──── Docker (localhost:4096)
                                                      │
                                              opencode server
                                              + collab router
                                              + GitHub OAuth
                                              + Claude LLM (server-side)
```

- **LLM calls are server-side.** The server holds the Claude credentials. Teammates' own Claude accounts are not involved — this is a shared session billed to the server owner.
- **GitHub OAuth** only verifies org membership. No GitHub permissions beyond that are granted.
- **Sessions persist** across server restarts (SQLite, Docker volume). Disconnect and reconnect — your history is intact.

---

## Running your own server

Want to run this for a different org, or deploy to EC2?

```bash
git clone https://github.com/unleashlive/opencode
cd opencode
cp .env.example .env
# Fill in GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET,
# GITHUB_TOKEN, SESSION_SECRET, OPENCODE_BASE_URL, and LLM credentials
ngrok http 4096              # note your https URL → set as OPENCODE_BASE_URL
docker compose up --build -d
```

Full setup details in [COLLAB.md](./COLLAB.md).

---

<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
