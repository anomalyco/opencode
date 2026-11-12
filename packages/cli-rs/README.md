# OpenCode native CLI

The OpenCode CLI and TUI in Rust, built on OpenTUI's Rust crates. It talks to an OpenCode server over HTTP and
lives next to the TypeScript CLI in `packages/cli` and TUI in `packages/tui`. Until it replaces them as
`opencode`, its command is `opencode-native`.

## Try a preview build

Nightly preview builds come from [`simonklee/opencode-native-preview`](https://github.com/simonklee/opencode-native-preview).
Install or update to the newest one with:

```sh
curl -fsSL https://raw.githubusercontent.com/simonklee/opencode-native-preview/main/install.sh | bash
```

This installs `~/.local/bin/opencode-native`. It needs the TypeScript `opencode` 2.2.7 or later on `PATH` (or
`OPENCODE_TS_BIN` set to it): `opencode-native` starts and uses its background service, and delegates `serve`,
`upgrade`, `plugin` and remote access to it. `opencode-native upgrade` in a preview build only tells you to re-run
the install script.

`opencode-native` uses your real sessions, service and `cli.json`. To keep its TUI state (tabs and other
client-local state) apart from the TypeScript TUI's, set `OPENCODE_TUI_CHANNEL=native-preview`.

To report a crash or bug, include the output of `opencode-native --version` and the end of
`~/.local/share/opencode/log/opencode.log` (`opencode-native debug paths` prints the `log` directory). Each start logs
a `cli starting` line with the version and the source commit of the build.

## Build

The client takes OpenTUI's Rust crates from `packages/rust` of
[`anomalyco/opentui`](https://github.com/anomalyco/opentui), pinned by git `rev` in `Cargo.toml`. Cargo fetches that
commit, but the checkout has no native library, and the bindings accept only the `opentui.h` they were generated
from. `.cargo/config.toml` points `OPENTUI_LIB_DIR` at `~/.cache/opentui-native/x86_64-linux`, which
native-hardening's `abi-artifacts.py` fills with artifacts built at the matching OpenTUI commit. Fill it once, then
build:

```sh
python3 /home/simon/src/opendocs/native-hardening/tools/abi-artifacts.py
bun run --cwd packages/cli-rs cargo build --bin opencode-native
```

On Linux and macOS the library is linked statically with its own private libc++, so neither the build nor the binary
needs `libopentui` or a system libc++.

Changes to OpenTUI's Rust crates are pull requests into `packages/rust` of `anomalyco/opentui`. To move the client
to another commit, run `abi-artifacts.py` for it, then change the `rev` and commit it with `Cargo.lock`.

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
bun run --cwd packages/cli-rs cargo build --release --bin opencode-native
cd ~/src/my-project
~/src/opencode/packages/cli-rs/target/release/opencode-native        # home
~/src/opencode/packages/cli-rs/target/release/opencode-native -c     # continue the last session here
```

For a smaller, faster binary to ship or measure, build with `cargo build --profile dist --bin opencode-native` (fat
LTO; the link takes about 10 minutes). The output is in `target/dist/`.

`opencode-native` reads the same `cli.json` (keybinds, theme, session settings) as the TypeScript TUI.
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

Known gap: the release binary keeps line-table debug info (about 180 MB). `strip` brings it to about 40 MB.

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
| `opencode-cli` | The `opencode-native` binary |

`script/generate.ts` runs the generators in `script/gen`; `parity/fixtures.ts` regenerates the parity
fixtures.

## Parity commands

Each command runs the TypeScript client and `opencode-native` on the same input and compares the results.
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
