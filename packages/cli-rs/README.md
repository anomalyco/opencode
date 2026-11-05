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

## Try it

Build the release binary once, then run it in a project directory. With no flags it finds the
running background service, as `opencode` does, or starts one.

```sh
bun run --cwd packages/cli-rs cargo build --release --bin opencode-rs
cd ~/src/my-project
~/src/opencode/packages/cli-rs/target/release/opencode-rs        # home
~/src/opencode/packages/cli-rs/target/release/opencode-rs -c     # continue the last session here
```

For a smaller, faster binary to ship or measure, build with `cargo build --profile dist --bin opencode-rs` (fat
LTO; the link takes about 10 minutes). The output is in `target/dist/`.

`opencode-rs` reads the same `cli.json` (keybinds, theme, session settings) as the TypeScript TUI.
Main keys, with the default leader `ctrl+x`:

| Key | Action |
| --- | --- |
| `enter` | Send the prompt (on home it creates a session) |
| `esc` | Interrupt a running reply; close a dialog; reject a permission |
| `<leader>l` | Session list |
| `<leader>m` | Models |
| `ctrl+p` | Command palette |
| `<leader>n` | New session |
| `pageup`, `pagedown` | Scroll the transcript |
| `ctrl+g` or `home`, `ctrl+alt+g` or `end` | First and last message |
| `ctrl+c` | Clear the prompt, or quit when it is empty |

Known gaps:

- The event stream can panic on non-ASCII text that is split across chunks. Live updates then stop
  until a restart, and the panic text corrupts the screen until the next full repaint.
- The first prompt in a new session can show a spurious "Session not found" toast.
- Session actions, tabs and panes, system commands, and plugins are not done yet.
- The release binary keeps line-table debug info (about 180 MB). `strip` brings it to about 40 MB.

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

## Parity commands

Each command runs the TypeScript client and `opencode-rs` on the same input and compares the results.
Run them from this directory with `bun run <command>`. Each one builds the debug binary first, unless
`OPENCODE_RS_BIN` names a binary.

| Command | Compares |
| --- | --- |
| `parity:cli [scenario.cli.ts ...]` | Exit code, stdout, stderr, and requests of one command (P-CLI) |
| `parity:pty [scenario.pty.ts ...]` | Screens and OSC output under a pseudo-terminal (P-PTY) |
| `parity:sim [scenario.sim.ts ...]` | TUI captures against a simulated server (P-TUI) |
| `parity:acp [suite ...]` | ACP JSON-RPC transcripts of `packages/cli/test/acp/*.subprocess.test.ts` (P-WIRE) |

`parity:acp` runs each suite twice, once per agent, through `parity/acp/record.sh`. It fails when a test
fails on either side or when the normalized transcripts differ. The transcripts are kept in
`$TMPDIR/opencode-parity/acp/<suite>-<side>/`.
