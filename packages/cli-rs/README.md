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

This installs `opencode-native` and the TypeScript `opencode` server it runs, built from the same commit at the same
version, into `~/.local/lib/opencode-native/`, and links `~/.local/bin/opencode-native` to it. Nothing else needs to
be installed: the bundled `opencode` stays off `PATH`, so your own `opencode`, if any, is untouched.

`opencode-native` runs the TypeScript binary for its background service and standalone server, delegates `serve`,
`plugin` and remote access to it, and runs TypeScript TUI plugins on its Bun. It takes
`OPENCODE_TS_BIN` when set, else the `opencode` beside its own executable (its real path, through links), else
`opencode` on `PATH`. When the TUI or `mini` finds a background service of another version in its channel, it
restarts it on that binary and says `Restarting background server (version mismatch)...`, as the TypeScript TUI
does.

`opencode-native upgrade` upgrades nothing; it says how this binary is updated. In a preview build that is re-running
the install script, which updates both binaries; the next start then restarts the old service. With `opencode`
installed beside it, it is `opencode upgrade`, which replaces both. A source build is rebuilt. Anything else has no
updater: an `opencode` on `PATH` or in `OPENCODE_TS_BIN` is a separate TypeScript install.

The bundled server is built for the channel `latest`, which `opencode-native` uses when `OPENCODE_CHANNEL` is unset,
so it shares `service.json` and your sessions with a TypeScript install of a release. The bundled server always
registers there: with another `OPENCODE_CHANNEL` the client still finds the service it started, but never restarts it
on a version mismatch.

`opencode-native` uses your real sessions, service and `cli.json`. To keep its TUI state (tabs and other
client-local state) apart from the TypeScript TUI's, set `OPENCODE_TUI_CHANNEL=native-preview`.

To report a crash or bug, include the output of `opencode-native --version` and the end of
`~/.local/share/opencode/log/opencode.log` (`opencode-native debug paths` prints the `log` directory). Each start logs
a `cli starting` line with the version and the source commit of the build.

## Build

The client takes OpenTUI's Rust crates from `packages/rust` of
[`anomalyco/opentui`](https://github.com/anomalyco/opentui), pinned to a release by git `tag` in `Cargo.toml`. Cargo
fetches it, but the checkout has no native library, and the bindings accept only the `opentui.h` they were generated
from. `script/opentui-native.ts` installs the release's library from its zip (`opentui-native-<tag>-<platform>.zip`),
checked against the sha256 table in the script and the release's header hash, with every licence and notice file of
the zip under `licenses/`. `.cargo/config.toml` points `OPENTUI_LIB_DIR` at `.opentui/<tag>/host` in this package
(git-ignored); a plain `cargo` run that finds it empty fails with the command to run (`OPENTUI_LIB_HINT`). `bun run
cargo` installs it first when it is missing, so a build needs nothing else:

```sh
bun run --cwd packages/cli-rs cargo build --bin opencode-native
```

For another target, `bun run --cwd packages/cli-rs opentui:native --target aarch64-apple-darwin` installs into
`.opentui/<tag>/<target>` and prints the directory to set as `OPENTUI_LIB_DIR`. Zips are kept in
`$XDG_CACHE_HOME/opencode/opentui-native`, so another worktree needs no download.

On Linux and macOS the library is linked statically with its own private libc++, so neither the build nor the binary
needs `libopentui` or a system libc++.

The Linux builds match OpenTUI's floor (O-164). The glibc builds link with Zig against glibc 2.17:
`cargo zigbuild --profile dist --target x86_64-unknown-linux-gnu.2.17` (or `aarch64-…`). Their binaries need
`libc.so.6`, `libm.so.6`, `libpthread.so.0` and `libdl.so.2` at `GLIBC_2.17` or older, and no libstdc++ or libgcc_s.
The musl builds (`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, with OpenTUI's musl library from
`opentui:native --target`) link musl dynamically, because a static musl binary cannot `dlopen` native plugins.
`.cargo/config.toml` sets `-C target-feature=-crt-static` and Zig's `-dynamic` for them, and a crt-static musl build
fails to compile. Their binaries need only musl (`ld-musl-<arch>.so.1`), which every Alpine install has.

Changes to OpenTUI's Rust crates are pull requests into `packages/rust` of `anomalyco/opentui`. To move the client
to another release, add the release's rows to the table in `script/opentui-native.ts` (from
`gh release view <tag> -R anomalyco/opentui --json assets`), change the `tag` and the directory in
`.cargo/config.toml`, and commit them with `Cargo.lock`. A pin between releases (a `rev`) has no zip: build its
library from OpenTUI's source and set `OPENTUI_LIB_DIR` to it.

Cargo finds `.cargo/config.toml` only when it runs inside `packages/cli-rs`, which is why the
commands go through `bun run --cwd packages/cli-rs cargo`.

### Editor

rust-analyzer looks for a `Cargo.toml` only at the root of the folder you open and one level below it, so in an editor
opened at the repository root it finds no project. Open `packages/cli-rs` itself, or point rust-analyzer at the
workspace, in VS Code with:

```json
{ "rust-analyzer.linkedProjects": ["packages/cli-rs/Cargo.toml"] }
```

Its `cargo check` runs in `packages/cli-rs`, so it reads `.cargo/config.toml`. On a fresh checkout it fails in
`opentui-sys` until the native library is installed: run `bun run --cwd packages/cli-rs opentui:native` once.

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

## Plugins

`opencode-native` runs the TypeScript TUI plugins the TypeScript TUI runs, on a Bun process of its own (the JS host):
a directory under `~/.config/opencode/plugins/`, or a package that `opencode-native plugin add <name>` installs. It also
loads native plugins, shared libraries on a C ABI.

[`docs/plugins.md`](docs/plugins.md) explains plugins in one place: the contract and the four ways a plugin runs against
it, how a handler waits (tasks, `await`, timers), the limits, and the shortest plugin in Rust, Luau and TypeScript.

- To write a native plugin, start with the quick start in [`crates/plugin-abi/README.md`](crates/plugin-abi/README.md).
  `opencode-native plugin dev <crate dir>` builds it, runs the TUI with it and reloads it on each change, and
  `opencode-native plugin test <crate dir> [--command NAME] [--wait TEXT]` prints its screen with no server. Neither is
  in `--help`, which matches the TypeScript CLI's (deviation `D01-plugin-dev-test`); each takes `-h`.
- A plugin in C uses [`crates/plugin-abi/include/opencode_plugin.h`](crates/plugin-abi/include/opencode_plugin.h);
  `crates/plugin/examples/c` is one.
- A Luau plugin is a directory with a `plugin.toml` and an `init.luau` in the same `plugins` directories. It runs in
  process, in a sandboxed Luau VM of its own with a CPU budget and a 32 MiB heap; a project's plugin waits for the
  user's approval. `crates/plugin/examples/luau` holds the examples, and `crates/plugin/src/luau/opencode` the type stub
  that `luau-analyze` and luau-lsp read (`bun run check:luau-types` checks the examples). `OPENCODE_PLUGIN_LUAU=0` turns
  Luau plugins off.
- [`docs/P.4.md`](docs/P.4.md) is the reference: discovery, the JS host, and how to debug a TypeScript plugin.

`/plugins` shows each plugin's state, and the error of one that failed or was skipped ("view error"). The log (`opencode.log` in the `log`
directory that `opencode-native debug paths` prints) has every failure.

## Layout

| Crate | Contents |
| --- | --- |
| `opencode-api` | Generated API types and methods, transports, events, sockets |
| `opencode-local` | Client-local files shared with the TypeScript client |
| `opencode-service` | Finding, probing, and starting the server |
| `opencode-store` | The client data store |
| `opencode-ui` | Themes, keymap, dialogs, content widgets |
| `opencode-api-types` | The generated API types alone, which the plugin SDK uses |
| `opencode-util` | Small shared helpers (temporary directories, `dlopen`, process jobs) |
| `opencode-plugin-abi` | The SDK of native plugins: the C ABI and its Rust bindings |
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
`OPENCODE_RS_BIN` names a binary. The TypeScript side runs from source, so run `bun install` at the repository root
once first; without it a run fails with `Cannot find module '@opentui/solid/preload'`. Scenario paths are relative to
this directory:

```sh
bun run parity:cli parity/scenarios/C.10/server-down.cli.ts
```

| Command | Compares |
| --- | --- |
| `parity:cli [scenario.cli.ts ...]` | Exit code, stdout, stderr, and requests of one command (P-CLI) |
| `parity:pty [scenario.pty.ts ...]` | Screens and OSC output under a pseudo-terminal (P-PTY) |
| `parity:sim [scenario.sim.ts ...]` | TUI captures against a simulated server (P-TUI) |
| `parity:acp [suite ...]` | ACP JSON-RPC transcripts of `packages/cli/test/acp/*.subprocess.test.ts` (P-WIRE) |

`parity:acp` runs each suite twice, once per agent, through `parity/acp/record.sh`. It fails when a test
fails on either side or when the normalized transcripts differ. The transcripts are kept in
`$TMPDIR/opencode-parity/acp/<suite>-<side>/`.

The shared fixture of the plugin life, `parity/machines/plugins.json`, has a reader in each client. The Rust one
is `crates/tui/tests/all/plugin_machines.rs`. The TypeScript one, `parity/machines/plugins.test.tsx`, drives the
TypeScript TUI and builds no binary: `bun run test`, which CI runs, covers each edge of the machine once and
the seeded walks in about 15 s, and `bun run parity:machines` adds every path to the file's depth and the fault
trials, which take a few minutes.
