# Grimoire

> A fork of [OpenCode](https://github.com/sst/opencode) by [EvalOps](https://evalops.dev) - The AI coding agent built for the terminal.

## About This Fork

**Grimoire** is a public fork of OpenCode maintained by [EvalOps](https://evalops.dev), a platform for shipping LLM changes without surprises. As a company focused on LLM evaluation, quality gates, and preventing regressions in AI systems, we use OpenCode extensively for our development workflows and maintain this fork for internal customization and experimentation.

This fork maintains the core functionality of OpenCode while providing a customized experience. OpenCode is open source and permissively licensed (MIT), and we're grateful to the SST team for building such an amazing tool.

### Why Fork?

At EvalOps, we build tools for evaluating and improving LLM applications. Having a customized development environment that aligns with our workflows and allows us to experiment with AI-assisted development patterns is valuable for:

- Testing our own LLM evaluation methodologies in a real development context
- Experimenting with custom agents and workflows
- Contributing improvements back to the OpenCode ecosystem

### Key Changes

- **UI Rebranding**: Terminal interface displays "Grimoire" instead of "OpenCode"
- All core features and functionality remain intact
- May include experimental features or configurations specific to our use cases

### Upstream

This fork tracks the `dev` branch of [sst/opencode](https://github.com/sst/opencode). For the latest official releases, documentation, and community support, please refer to the upstream repository.

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
brew install sst/tap/opencode      # macOS and Linux
paru -S opencode-bin               # Arch Linux
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Documentation

For more info on how to configure OpenCode [**head over to our docs**](https://opencode.ai/docs).

### Usage Stats

You can inspect local usage history and tool telemetry with the built-in stats command:

```bash
opencode stats                   # pretty summary
opencode stats --json            # machine-readable output
opencode stats --telemetry all   # include recent tool runs
opencode stats --limit 50        # show more history
opencode stats --clear           # reset stored telemetry data
opencode stats --details         # show telemetry metadata fields
opencode stats --details-format ndjson --fields status,final_url
opencode stats --status error --since 1d
opencode stats --compare baseline.json --warn-latency 2000
```

Advanced telemetry usage tips:

- Capture a baseline for comparison with `opencode stats --json --telemetry all --limit 500 > baseline.json`, then diff with `--compare baseline.json`.
- Export metadata for dashboards using `--details-format csv` or `--details-format ndjson`.
- Focus on specific signals by pairing `--status`, `--since`, `--until`, and `--fields` filters.
- Gate builds by combining `--warn-latency` or `--warn-errors` with CI scripts.

The telemetry section lists recent tool executions (duration, status, error message) gathered from persisted `tool.telemetry` events.

### Contributing

OpenCode is an opinionated tool so any fundamental feature needs to go through a
design process with the core team.

> [!IMPORTANT]
> We do not accept PRs for core features.

However we still merge a ton of PRs - you can contribute:

- Bug fixes
- Improvements to LLM performance
- Support for new providers
- Fixes for env specific quirks
- Missing standard behavior
- Documentation

Take a look at the git history to see what kind of PRs we end up merging.

> [!NOTE]
> If you do not follow the above guidelines we might close your PR.

To run OpenCode locally you need.

- Bun
- Golang 1.24.x

And run.

```bash
$ bun install
$ bun dev
```

#### Development Notes

**API Client**: After making changes to the TypeScript API endpoints in `packages/opencode/src/server/server.ts`, you will need the OpenCode team to generate a new stainless sdk for the clients.

### FAQ

#### How is this different than Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although Anthropic is recommended, OpenCode can be used with OpenAI, Google or even local models. As models evolve the gaps between them will close and pricing will drop so being provider-agnostic is important.
- A focus on TUI. OpenCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This for example can allow OpenCode to run on your computer, while you can drive it remotely from a mobile app. Meaning that the TUI frontend is just one of the possible clients.

#### What's the other repo?

The other confusingly named repo has no relation to this one. You can [read the story behind it here](https://x.com/thdxr/status/1933561254481666466).

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
