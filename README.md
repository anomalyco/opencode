# unleashlive/opencode

> **This is the [unleashlive](https://github.com/unleashlive) fork of [opencode](https://github.com/anomalyco/opencode).**
> It adds **Collab Sessions** — real-time multi-user AI coding sessions where your whole team shares one LLM context, with role-based participation and a shared prompt queue.
>
> Upstream opencode docs and install instructions are preserved below.

---

## Collab Sessions

### What is a Collab Session?

A Collab Session lets two or more developers share a single opencode session — same conversation, same codebase, same LLM context. One person drives, others contribute or watch.

- **Driver** — sends prompts directly to the LLM (FIFO mode) or to the vote pool (Vote mode), approves Contributor suggestions, manages roles, deletes sessions
- **Contributor** — submits prompt suggestions for a Driver to approve before execution, votes in Vote Pool mode
- **Viewer** — read-only access to the full session in real time

The server runs on one machine. Everyone else joins in their browser — **no install required for collaborators.**

### What you see in a session

```
┌────────────────────┬──────────────────────────────────────────┐
│  Collab panel      │  Conversation (opencode)                  │
│                    │  ┌────────────────────────────────────┐   │
│  • Participants    │  │  ⌘ hamburger → collab sessions     │   │
│  • Pulsing dots    │  ├────────────────────────────────────┤   │
│    next to who     │  │                                    │   │
│    is typing       │  │  LLM conversation thread           │   │
│  • Pending queue   │  │                                    │   │
│  • Vote / approve  │  ├────────────────────────────────────┤   │
│  • Session list    │  │  Prompt input (full opencode UX:   │   │
│    with X delete   │  │  ⌘P palette, /, @, attachments,    │   │
│                    │  │  history, model + agent pickers)   │   │
│                    │  └────────────────────────────────────┘   │
└────────────────────┴──────────────────────────────────────────┘
```

The prompt input lives on the right (full opencode editor with every shortcut). When you submit, it is routed through the collab queue — so Contributor prompts wait for a Driver to approve, while Driver prompts in FIFO mode dispatch instantly to the LLM. The left panel shows the queue, participants (with pulsing dots when they're typing), and lets you switch between sessions or delete them.

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
   - **Session name** — e.g. "Drone API refactor". This becomes the opencode session title too.
   - **Repositories** — pick from the org. For a single repo the LLM operates inside that repo (git diff / review pane / file tree all work). For multiple repos it works in the parent workspace.
   - **Visibility while typing** — choose how much teammates see before you submit a prompt:
     - *Typing indicator* (default) — pulsing dots show next to participants who are composing, without revealing content
     - *Submitted only* — no live indicator; others see your prompt only once you send
   - **Prompt queue mode**:
     - *FIFO* — Driver prompts dispatch instantly to the LLM; Contributor suggestions queue for Driver approval
     - *Vote Pool* — everyone (Drivers + Contributors) adds to the pool; team votes; Driver resolves to execute the winner
4. Click **Create Collab Session**
5. From the session page, click **Invite** → pick a role → copy the link → share it
6. To delete a session you own, hover over it in the left sidebar list and click the **×** that appears

### Prompt input shortcuts

The editor on the right is the full opencode prompt input. Inside it:

| Shortcut | Action |
|---|---|
| `⌘P` / `Ctrl-P` | Command palette |
| `/` | Slash command popover (mode, agent, model commands) |
| `@` | Mention files or agents |
| `⌘↵` / `Ctrl-↵` | Send |
| `⌘U` / `Ctrl-U` | Attach a file |
| Drag/drop | Drop files or images into the editor |
| ↑ / ↓ | Cycle through prompt history |

The model picker, agent selector and mode/variant dropdowns at the bottom of the editor stay editable in collab mode — whatever you have selected when a prompt is dispatched is what the LLM uses.

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
- **Repos are cloned server-side** at session creation (using `GITHUB_TOKEN`). Participants never need a local clone — the LLM works inside `/var/opencode/workspaces/<sessionId>/<repo>` on the server.
- **Co-authored commits.** The Driver who approved the prompt is the git author; all other online participants are added as `Co-authored-by:` trailers using their GitHub noreply email.
- **Every commit is signed "collaborative".** Each cloned repo gets a `prepare-commit-msg` hook installed at session-init time.  Every fresh commit made inside the workspace automatically gets trailers like:
  ```
  Collaborative-Commit: true
  Collab-Session: Drone API refactor
  Collab-Session-Id: cs_45d8a93d...
  Collab-Repo: unleashlive/backend
  ```
  Amends, merges and squashes are left alone (re-stamping would duplicate).
- **Seed prompt fires automatically.** When the workspace finishes cloning, the server sends one seed prompt to the freshly created opencode session: *"Starting a collab session: …"*.  This (a) gives the LLM context that it's in a multi-user collab session, and (b) makes the iframe immediately show a conversation instead of an empty composer.
- **Submissions route through the queue.** The opencode prompt input (full editor with every shortcut) is rendered inside an `?embed=collab` iframe; submissions are intercepted via `postMessage` and forwarded to the collab API, so the right role/queue/vote flow always applies.
- **Plugin pre-installed.** The `opencode-claude-auth` plugin is baked into the Docker image at build time so the first session creation doesn't block the event loop installing it.

### Where to find the cloned repos on disk

Workspaces live inside the `collab-workspaces` Docker volume at `/var/opencode/workspaces/<collabSessionId>/<repoName>/`.  Quick ways to inspect them:

```bash
# List all live sessions
docker exec opencode-opencode-1 ls /var/opencode/workspaces/

# Drop into a repo's shell
docker exec -it opencode-opencode-1 bash -c \
  'cd /var/opencode/workspaces/cs_<id>/<repoName> && exec bash'

# Or just check git status from the host
docker exec opencode-opencode-1 \
  git -C /var/opencode/workspaces/cs_<id>/<repoName> status
```

Inside the iframe the terminal panel is already cwd'd inside the cloned repo — `git status` / `git log` / `git diff` work directly there.  The file tree on the left of the iframe shows that same repo.

---

## Running your own server

Want to run this for a different org, or deploy to EC2?

```bash
git clone https://github.com/unleashlive/opencode
cd opencode
cp .env.example .env
# Fill in GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET,
# GITHUB_TOKEN, GITHUB_ORG_NAME, SESSION_SECRET, OPENCODE_BASE_URL

# Export your Claude Code credentials so the server can authenticate to Claude:
security find-generic-password -s "Claude Code-credentials" -w > ~/.claude/.credentials.json

ngrok http 4096              # note your https URL → set as OPENCODE_BASE_URL
docker compose up --build -d
```

After source-only changes, rebuild is fast — the Dockerfile uses a multi-stage
manifests-only extraction so `bun install` only re-runs when a `package.json`
or `bun.lock` actually changes. Force a clean container after a build with:

```bash
docker compose up -d --build --force-recreate
```

If the container reports "Claude Code credentials are unavailable or expired",
re-export them from your keychain (running `claude` on the host refreshes the
keychain but doesn't update the bind-mounted file):

```bash
rm -f ~/.claude/.credentials.json
security find-generic-password -s "Claude Code-credentials" -w > ~/.claude/.credentials.json
docker compose restart opencode
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
