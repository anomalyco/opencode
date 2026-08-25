# pencode

The open source AI coding agent — rewritten in Rust.

pencode is a fork of [opencode](https://github.com/anomalyco/opencode) being
rebuilt as a native Rust application. This branch (`rust-rewrite`) replaces the
original TypeScript monorepo with a Cargo workspace that mirrors its
architecture.

## Status

This is an early-stage rewrite. The workspace compiles, tests pass, and the
core surfaces exist; full feature parity with upstream opencode is work in
progress.

| Crate | Replaces | Purpose |
|---|---|---|
| `crates/pencode-protocol` | `packages/protocol` | Shared wire types: sessions, messages, parts, events |
| `crates/pencode-core` | `packages/opencode/src` | Config loading, durable session store, tool registry |
| `crates/pencode-server` | `packages/server` | HTTP API (axum): sessions, config, health |
| `crates/pencode-client` | `packages/sdk/js` | Typed HTTP client for the server API |
| `crates/pencode-tui` | `packages/tui` | Terminal UI (ratatui) with transcript + prompt |
| `crates/pencode` | CLI entrypoint | Subcommands: `run`, `serve`, `tui`, `models`, `auth` |

## Build

Requires Rust 1.85+ (edition 2021).

```
cargo build --release
cargo test --workspace
```

## Usage

```
pencode serve --port 4096   # start the HTTP API server
pencode tui                 # interactive terminal UI
pencode run "fix the bug"   # one-shot prompt
pencode models              # show configured model/providers
pencode auth                # provider auth status
```

## Configuration

Global: `~/.config/pencode/config.json` (respects `XDG_CONFIG_HOME`)
Project: `.pencode/config.json` in your repo (overrides global)

```json
{
  "theme": "dark",
  "model": "anthropic/claude-sonnet-4",
  "autoupdate": true,
  "provider": {
    "anthropic": { "apiKey": "sk-..." }
  }
}
```

Sessions are stored durably under `.pencode/storage/session/<id>.json`.

## Roadmap

- [ ] LLM provider integration (Anthropic, OpenAI, ...) behind a `Provider` trait
- [ ] Streaming responses over SSE
- [ ] Agent loop wiring tools into model turns
- [ ] Full TUI feature parity (themes, keybindings, subagents)
- [ ] Desktop app (Tauri)

## License

MIT — see [LICENSE](LICENSE). pencode is a fork of opencode and is not built
by or affiliated with the OpenCode team.
