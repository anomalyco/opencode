<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent — extended fork with enhanced capabilities.</p>
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

### Features

OpenCode (xuviga fork) extends the base OpenCode with the following capabilities:

#### 🔍 Smart Auto-Context

Automatically determines relevant files based on your query and adds them to the session context. Uses a file rank analyzer that scores files by relevance. Configure via `opencode.json`:

```json
{
  "context": {
    "autoAdd": true,
    "maxFiles": 10,
    "includeTests": true
  }
}
```

#### 👥 Multi-Agent Teams

The `/team` command launches multiple agents in three modes:

- **parallel** — all agents work simultaneously on the same task
- **pipeline** — each agent receives the previous agent's output as context
- **supervisor** — a coordinating agent delegates work and synthesizes results

```json
{
  "multiAgent": {
    "defaultMode": "parallel",
    "maxAgents": 3
  }
}
```

#### 📊 Mermaid Diagram Support

When enabled, the model is instructed to generate diagrams using Mermaid syntax inside ` ```mermaid ` code blocks. Diagrams are extracted, rendered to SVG, and emitted for UI consumption. Mermaid blocks are replaced in the text with a `[Mermaid diagram generated]` marker. The UI provides a download button for `.mmd` files.

```json
{
  "diagrams": {
    "enabled": true,
    "format": "svg"
  }
}
```

#### 🔧 Auto-Fix

After each LLM turn, automatically runs linters and TypeScript checks, reporting errors back to the model for iterative fixing. Supports tsc, biome, eslint, oxlint.

```json
{
  "autoFix": {
    "enabled": true,
    "maxIterations": 3,
    "tools": ["tsc", "biome"]
  }
}
```

#### 🧠 Meta-Cognition Layer

OpenCode adds a lightweight planning and verification layer around each LLM step:

- **Plan**: A fast LLM (Haiku / 4o-mini) analyzes the user request before the main turn, identifying intent, affected files, risks, and approach. The plan is injected into the system context so the main model starts with a clear strategy.
- **Verify**: After each step settlement, changes are reviewed for regressions, side effects, and correctness.
- **Reflect**: At the end of a session drain, insights are extracted and stored in a durable knowledge store for future sessions.

**Predictive Context Warmup** — before each prompt, a predictor analyzes three signals in parallel:

- **Import graph**: Direct and transitive TypeScript/JavaScript imports from the current file, resolved via the TypeScript Compiler API
- **Git co-change patterns**: Files frequently modified together over the last 6 months (`git log --all --name-only --since=6 months`)
- **Session recency**: Files recently referenced in the current session

Predicted files are presented to the planner for inclusion in the system context, reducing the need for the agent to discover relevant files through tool calls.

**Cross-Session Knowledge Graph** — insights and decisions from previous sessions are persisted in a durable knowledge store and automatically loaded into new sessions as a `<session-knowledge>` block:

```
<session-knowledge>
[architecture] auth module uses JWT with refresh tokens stored in SQLite
[pattern] all handlers follow Effect.fn('Domain.method')
[constraint] requires Node >= 20
</session-knowledge>
```

```json
{
  "sessionKnowledge": {
    "enabled": true
  }
}
```

**Auto-Debugger** — when a tool execution fails, automatically analyzes the error using a fast LLM:

- Determines root cause, relevant file, and suggested fix
- Works with any tool failure (bash, edit, write, glob, grep, etc.)
- Produces structured diagnosis for the verification step

**Self-Profiling Agent** — a background profiler tracks development patterns across sessions:

- **Edit heatmap**: Files changed more than 5 times are flagged as potential refactoring candidates
- **Error frequency**: Repeated errors (3+) are flagged for root-cause investigation
- Metrics are stored in the session knowledge store and exposed through the system context as `<profile-insights>` blocks

**Diff-Aware Dependency Tracking** — when files are modified, automatically searches for all usages of changed exports across the codebase using ripgrep. The dependency report is included in the verification step so the model can check that callers, test files, and reverse dependencies remain correct.

#### 🎯 Built-in Commands

- **`/test`** — Generate and run tests for the current file with auto-detection of the testing framework
- **`/commit`** — Generate a Conventional Commits message from staged changes
- **`/team`** — Run a multi-agent team with configurable mode

Test configuration:

```json
{
  "testing": {
    "enabled": true,
    "framework": "vitest",
    "testCommand": "bun test"
  }
}
```

Git configuration:

```json
{
  "git": {
    "autoStage": false,
    "conventional": true
  }
}
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
