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

### Features

#### Smart Auto-Context
OpenCode automatically determines relevant files based on your query and adds them to the session context. Configure via `opencode.json`:

```json
{
  "context": {
    "autoAdd": true,
    "maxFiles": 10,
    "includeTests": true
  }
}
```

#### Multi-Agent Teams
Run multiple agents in parallel, pipeline, or supervisor mode with the `/team` command:

- **parallel**: All agents work simultaneously on the same task
- **pipeline**: Each agent receives the previous agent's output as context
- **supervisor**: A coordinating agent delegates work and synthesizes results

Configure team execution via `opencode.json`:

```json
{
  "multiAgent": {
    "defaultMode": "parallel",
    "maxAgents": 3
  }
}
```

#### Mermaid Diagram Support
When enabled, the model is instructed to generate diagrams using Mermaid syntax inside ` ```mermaid ` code blocks. Diagrams are extracted, rendered to SVG, and emitted as `session.diagram.rendered` events for UI consumption. Mermaid blocks are replaced in the text with a `[Mermaid diagram generated]` marker.

```json
{
  "diagrams": {
    "enabled": true,
    "format": "svg"
  }
}
```

#### Auto-Fix
After each LLM turn, OpenCode can automatically run linters and report errors to the model for iterative fixing.

```json
{
  "autoFix": {
    "enabled": true,
    "maxIterations": 3,
    "tools": ["biome", "tsc"]
  }
}
```

#### Meta-Cognition Layer
OpenCode adds a lightweight planning and verification step around each LLM turn. Before the main model responds, a fast model analyzes the request, identifies risks, and determines the approach. After each step, the results are verified for correctness. The plan is injected into the system context so the main model starts with a clear strategy.

- **Plan**: A fast LLM (Haiku / 4o-mini) analyzes the user request before the main turn, identifying intent, affected files, risks, and approach
- **Verify**: After each step settlement, changes are reviewed for issues, regressions, and side effects
- **Reflect**: At the end of a session drain, insights are extracted and stored for future reference

#### Predictive Context Warmup
Before each prompt, OpenCode predicts which files will be needed by analyzing three signals in parallel:

- **Import graph**: Direct and transitive TypeScript/JavaScript imports from the current file
- **Git co-change patterns**: `git log --all --name-only --since=6 months` identifies files frequently modified together
- **Session recency**: Files recently referenced in the current session

Predicted files are presented to the planner for inclusion in the system context, reducing the need for the agent to discover relevant files through tool calls.

#### Cross-Session Knowledge Graph
Insights and decisions from previous sessions are persisted in a durable knowledge store and automatically loaded into new sessions as system context. When a reflection step extracts architectural facts, patterns, constraints, or user preferences, they are recorded and surfaced in subsequent sessions.

```json
{
  "sessionKnowledge": {
    "enabled": true
  }
}
```

Knowledge facts are rendered as a `<session-knowledge>` block in the system prompt:

```
<session-knowledge>
[architecture] auth module uses JWT with refresh tokens stored in SQLite
[pattern] all handlers follow Effect.fn('Domain.method')
[constraint] requires Node >= 20
</session-knowledge>
```

#### Auto-Debugger
When a tool execution fails, OpenCode automatically analyzes the error using a fast LLM, identifies the root cause, and surfaces a suggested fix. The analysis is passed to the verification step for inclusion in the next continuation turn.

- Supports any tool failure (bash, edit, write, glob, grep, etc.)
- Extracts relevant context from error output, tool input, and recent changes
- Produces structured diagnosis: root cause, relevant file, suggested fix, confidence level

#### Self-Profiling Agent
A background profiler tracks development patterns across sessions and surfaces actionable insights when patterns emerge.

- **Edit heatmap**: Files changed more than 5 times are flagged as potential refactoring candidates
- **Error frequency**: Repeated errors (3+) are flagged for root-cause investigation
- All metrics are stored in the session knowledge store and exposed through the system context as `<profile-insights>` blocks

#### Diff-Aware Dependency Tracking
When files are modified, OpenCode automatically searches for all usages of changed exports across the codebase using ripgrep. The dependency report is included in the verification prompt so the model can check that callers, test files, and reverse dependencies remain correct.

- Finds callers, test files, and reverse dependencies of changed names
- Results are passed to the verification step for automated review

#### Built-in Commands
- **`/test`** — Generate and run tests for the current file
- **`/commit`** — Generate a Conventional Commits message from staged changes
- **`/team`** — Run a multi-agent team with configurable mode

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
See [`examples/opencode.example.jsonc`](./examples/opencode.example.jsonc) for a complete configuration example with all new features.

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
