# opencode-rs

A Rust client for OpenCode, built on opentui-rust. It talks to an OpenCode server over HTTP and
lives next to the TypeScript CLI in `packages/cli` and TUI in `packages/tui`; it does not replace them.

## Build

opentui-rust links OpenTUI's native library, and its bindings accept only the `opentui.h` they were
generated from. Copy a matching set of artifacts once, then build:

```sh
bun run --cwd packages/cli-rs opentui-lib
bun run --cwd packages/cli-rs cargo build --bin opencode-rs
```

`opentui-lib` searches `$OPENTUI_ROOT`, `~/src/opentui`, and `~/src/wt/ot-*` for a
`packages/native/lib/<platform>` directory whose header matches, or takes directories as arguments.
It copies into `~/.cache/opencode-rs/opentui/<platform>`, where `.cargo/config.toml` points
`OPENTUI_LIB_DIR`. The library is linked statically, so the binary needs no `libopentui` at run
time; it does need libc++ and libc++abi.

Cargo finds `.cargo/config.toml` only when it runs inside `packages/cli-rs`, which is why the
commands go through `bun run --cwd packages/cli-rs cargo`.

## Run against the live service

```sh
bun run --cwd packages/cli-rs live [directory]
```

`script/live.sh` connects to the running `opencode` background service with the URL from
`opencode service status` and the password from `opencode service get password`, and uses the `dev`
TUI storage channel, as the root `dev:live` does.

## Layout

| Crate | Contents |
| --- | --- |
| `opencode-api` | Generated API types and methods, transports, events, sockets |
| `opencode-local` | Client-local files shared with the TypeScript client |
| `opencode-service` | Finding, probing, and starting the server |
| `opencode-store` | The client data store |
| `opencode-ui` | Themes, keymap, dialogs, content widgets |
| `opencode-plugin`, `opencode-latex`, `opencode-mermaid` | The plugin API and its first plugins |
| `opencode-tui` | The full-screen TUI |
| `opencode-mini` | `mini` |
| `opencode-acp` | The ACP agent |
| `opencode-drive` | The simulation UI endpoint |
| `opencode-parity` | Parity fixtures and comparison (development only) |
| `opencode-cli` | The `opencode-rs` binary |

`script/generate.ts` runs the generators in `script/gen`; `parity/fixtures.ts` regenerates the parity
fixtures.
