# OpenCode native CLI

The OpenCode CLI and TUI in Rust, on OpenTUI's Rust crates. It is a client: it finds or starts the TypeScript
`opencode` server and talks to it over HTTP. Until it replaces `packages/cli` and `packages/tui` as `opencode`, its
command is `opencode-native`.

## Try a preview build

```sh
curl -fsSL https://raw.githubusercontent.com/simonklee/opencode-native-preview/main/install.sh | bash
```

This installs the newest nightly from
[`simonklee/opencode-native-preview`](https://github.com/simonklee/opencode-native-preview): `opencode-native` and the
TypeScript `opencode` server of the same commit, in `~/.local/lib/opencode-native/`, with a link in `~/.local/bin`.
The bundled `opencode` stays off `PATH`, so your own is untouched. Run the script again to update both;
`opencode-native upgrade` only says how.

- **Which server it runs.** `OPENCODE_TS_BIN`, else the `opencode` beside its own executable (through links), else
  `opencode` on `PATH`. That binary is the background service and the standalone server; `serve`, `plugin` and
  remote access are delegated to it, and TypeScript TUI plugins run on its Bun.
- **Shared state.** It uses your real sessions, service and `cli.json`. The bundled server is built for the channel
  `latest`, the default when `OPENCODE_CHANNEL` is unset, so it shares `service.json` with a TypeScript release.
  When the TUI or `mini` finds a service of another version there, it restarts it on its own binary and says
  `Restarting background server (version mismatch)...`, as the TypeScript TUI does. Under another `OPENCODE_CHANNEL`
  it never restarts one.
- **Separate TUI state.** `OPENCODE_TUI_CHANNEL=native-preview` keeps tabs and other client-local state apart from
  the TypeScript TUI's.
- **Reporting a bug.** Include `opencode-native --version` and the end of `~/.local/share/opencode/log/opencode.log`
  (`opencode-native debug paths` prints the `log` directory). Each start logs `cli starting` with the version and
  the commit.

## Build

```sh
bun run --cwd packages/cli-rs cargo build --bin opencode-native
```

Run cargo this way. `bun run cargo` first installs OpenTUI's native library, and cargo reads `.cargo/config.toml`
only inside `packages/cli-rs`.

The client pins `packages/rust` of [`anomalyco/opentui`](https://github.com/anomalyco/opentui) to a release, as the
crates.io packages `anomalyco-opentui` and `anomalyco-opentui-sys` (library names `opentui` and `opentui_sys`) at
an exact `version` in `Cargo.toml`; the release tag is `v<version>`. The crate has no native library, and the
bindings accept only the `opentui.h` they were generated from. `script/opentui-native.ts` (`bun run opentui:native`) installs the release's
`opentui-native-<tag>-<platform>.zip` into `.opentui/<tag>/host`, checked against the script's sha256 table and the
release's header hash, with the zip's licence files under `licenses/`. Zips are cached in
`$XDG_CACHE_HOME/opencode/opentui-native`. A plain `cargo` run that finds the directory empty fails with the command
to run. `opentui:native --target <triple>` installs another target's library and prints the directory to set as
`OPENTUI_LIB_DIR`.

To move to another release, add its rows to the table in `script/opentui-native.ts` (from
`gh release view <tag> -R anomalyco/opentui --json assets`), change the `version` and the directory in
`.cargo/config.toml`, and commit them with `Cargo.lock`. A pin between releases (a git `rev`) has no zip: build its
library from OpenTUI's source and set `OPENTUI_LIB_DIR`. Changes to OpenTUI's Rust crates are pull requests to
`anomalyco/opentui`.

On Linux and macOS the library links statically with its own libc++, so neither the build nor the binary needs
`libopentui` or a system libc++. The Linux release builds match OpenTUI's floor:

- **glibc**: `cargo zigbuild --profile dist --target x86_64-unknown-linux-gnu.2.17` (or `aarch64-…`). The binary
  needs `libc.so.6`, `libm.so.6`, `libpthread.so.0` and `libdl.so.2` at `GLIBC_2.17` or older, and no libstdc++ or
  libgcc_s.
- **musl** (`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`): musl links dynamically, because a static musl
  binary cannot `dlopen` native plugins. `.cargo/config.toml` sets the flags, and a crt-static musl build fails to
  compile. The binary needs only `ld-musl-<arch>.so.1`, which every Alpine install has.

`--release` keeps line-table debug info (about 180 MB; `strip` brings it to about 40 MB). `--profile dist` adds fat
LTO for a smaller, faster binary in `target/dist/`; its link takes about 10 minutes.

**Editor.** rust-analyzer finds no project when you open the repository root. Open `packages/cli-rs`, or in VS Code
set `{ "rust-analyzer.linkedProjects": ["packages/cli-rs/Cargo.toml"] }`. Its `cargo check` fails in `anomalyco-opentui-sys`
until you run `bun run --cwd packages/cli-rs opentui:native` once.

## Run

```sh
bun run --cwd packages/cli-rs cargo build --release --bin opencode-native
cd ~/src/my-project
~/src/opencode/packages/cli-rs/target/release/opencode-native        # home
~/src/opencode/packages/cli-rs/target/release/opencode-native -c     # continue the last session here
```

With no flags it finds the running background service, as `opencode` does, or starts one.
`bun run --cwd packages/cli-rs live [directory]` (`script/live.sh`) instead connects to the live service with the URL
and password `opencode service` reports, on the `dev` TUI storage channel, as the root `dev:live` does.

The TUI reads the same `cli.json` (keybinds, theme, session settings) as the TypeScript TUI. Main keys, with the
default leader `ctrl+x`:

| Key | Action |
| --- | --- |
| `enter` | Send the prompt (on home it creates a session) |
| `esc` | Interrupt a running reply; close a dialog; reject a permission |
| `<leader>l`, `<leader>m`, `<leader>n` | Session list, models, new session |
| `ctrl+p` | Command palette |
| `pageup`, `pagedown` | Scroll the transcript |
| `ctrl+g` or `home`, `ctrl+alt+g` or `end` | First and last message |
| `ctrl+c` | Clear the prompt, or quit when it is empty |

## Plugins

`opencode-native` runs the TypeScript TUI plugins the TypeScript TUI runs, on a Bun process of its own. It also runs
native plugins (shared libraries on a C ABI) and Luau plugins. `/plugins` shows each plugin's state and error.

- [`docs/plugins.md`](docs/plugins.md): how plugins work, how to write one in Rust, Luau or TypeScript, and how they
  are found, approved and reloaded.
- [`docs/plugin-abi.md`](docs/plugin-abi.md): the contract, in full.
- [`crates/plugin-abi/README.md`](crates/plugin-abi/README.md): the Rust SDK and its quick start.

## More

- [`docs/architecture.md`](docs/architecture.md): the crates, how the client reaches the server, the store, the TUI.
- [`docs/testing.md`](docs/testing.md): the parity suites against the TypeScript client, the other checks, and the
  manual Windows checklist.
