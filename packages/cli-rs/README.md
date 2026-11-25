# OpenCode native CLI

The OpenCode CLI and TUI in Rust, built on OpenTUI's Rust crates. It is a client of the TypeScript `opencode`
server and talks to it over HTTP. Its binary is `opencode-native`, and it does not ship yet.

## Build and run

```sh
bun run --cwd packages/cli-rs cargo build --release --bin opencode-native
```

Always run cargo through `bun run cargo`: it installs OpenTUI's native library first, and cargo reads
`.cargo/config.toml` only inside `packages/cli-rs`.

Run `target/release/opencode-native` in a project directory to open the TUI, or add `-c` to continue the last
session there.

## Server

The client runs the server from `OPENCODE_TS_BIN`, else the `opencode` beside its own executable, else `opencode` on
`PATH`. It shares sessions, the background service, and `cli.json` with the TypeScript client.

## Editor

rust-analyzer finds no project at the repository root. Open `packages/cli-rs`, or set
`"rust-analyzer.linkedProjects": ["packages/cli-rs/Cargo.toml"]`.

## Plugins

The client runs the TypeScript TUI plugins on its own Bun process, and it also runs Luau plugins.

- [`docs/plugins.md`](docs/plugins.md): how plugins work and how to write one.
- [`docs/plugin-abi.md`](docs/plugin-abi.md): the full plugin contract.

## More

- [`docs/architecture.md`](docs/architecture.md): the crates, the server connection, the store, and the TUI.
- [`docs/testing.md`](docs/testing.md): the parity suites against the TypeScript client and the other checks.
