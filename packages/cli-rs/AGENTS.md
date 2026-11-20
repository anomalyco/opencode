# cli-rs

The OpenCode native CLI (command `opencode-native`), on OpenTUI's Rust crates. Rename only user-facing names
(decision O-114); crates, this directory and `OPENCODE_RS_*` test variables keep their names. The plan and decisions live outside this repository, in
`/home/simon/src/opendocs/oc-rust/plan.md` and `decisions.md`. The root `AGENTS.md` applies too.

## Running cargo

- Cargo reads `.cargo/config.toml` from the current directory, not from `--manifest-path`, and
  `cargo -C` is unstable. Without that config `opentui-sys` fails with "set OPENTUI_LIB_DIR". Run
  cargo through the package script, which runs in this directory:
  `bun run --cwd packages/cli-rs cargo check -p opencode-api`.
- opentui comes from `packages/rust` of `anomalyco/opentui`, pinned to a release on crates.io
  (`opentui` at an exact `version` in `Cargo.toml`; the tag is `v<version>`) and linked statically.
  The crate has no native library: `.cargo/config.toml` points `OPENTUI_LIB_DIR` at
  `.opentui/<tag>/host` in this package (git-ignored), which `script/opentui-native.ts` fills from the release zip,
  checked against the sha256 table in the script and the header hash. `bun run cargo` runs it first, so nothing else is
  needed; a plain `cargo` run that finds it empty fails with `OPENTUI_LIB_HINT`'s command.
  `bun run opentui:native --target <target>` installs another target's and prints its directory. A shell
  `OPENTUI_LIB_DIR` wins over the config.
- A change to OpenTUI's Rust crates is a pull request into `packages/rust` of `anomalyco/opentui`. A re-pin to a new
  release adds its rows to the script's table and changes the `version`, `Cargo.lock` and the tag in `.cargo/config.toml`'s
  directory together. A git `rev` between releases has no zip: build its library from source (native-hardening's
  `abi-artifacts.py`) and set `OPENTUI_LIB_DIR` to it.

## Checks

Fast checks only, scoped with `-p` to the crates a step touches: `cargo fmt --check`, `cargo check`,
`cargo clippy --all-targets -- -D warnings`, and `cargo test`. Add one targeted parity scenario and single
TypeScript test files. No root `bun run check`, no full Bun suites, no OpenTUI `packages/rust/test.sh`, no
OpenTUI suites, no benchmarks. Put `timeout` on anything that could hang.

Run `cargo fmt` before every final commit; `cargo fmt --check` must be clean. `rustfmt.toml` matches OpenTUI's
`packages/rust/rustfmt.toml`.

The integration tests of `opencode-tui` and `opencode-ui` link the static OpenTUI set, so each crate
has one test binary, `tests/all/main.rs`, with one module per area and the shared helpers under
`tests/all/support`. Add a new test file there as a module, not as a new `tests/*.rs`. Run one area
with `cargo test -p opencode-tui --test all <module>::`, the unit tests with `--lib`.

## Ownership

- Each step owns the files plan 8.4 lists. `lib.rs` of `api`, `local`, `service`, `store`, and `ui`
  already declares every module, each a stub file naming its step; fill your stubs and leave other
  steps' files alone.
- Third-party crates are declared once in the root `[workspace.dependencies]`. A crate takes one with
  `name.workspace = true`. `Cargo.lock`, crate `[dependencies]`, and `bun.lock` are shared and resolved
  by rebase.

## Rules

- Deviations from the TypeScript client go in `parity/deviations/<row>-<slug>.md`: the TypeScript
  behavior, the Rust behavior, and the reason. A difference without a file is a failure.
- OpenTUI handles are not `Send`. Network work runs on tokio through `App::spawn`; never block the
  UI thread.
- Every queue between tasks and the UI is bounded.
- Where the TypeScript TUI uses `flexGrow`, use `grow().basis(Length::Auto)`: OpenTUI's `grow()`
  alone sets basis 0, which lays out differently.
- Generated files are committed; regenerate with `bun run --cwd packages/cli-rs generate`, which runs
  every `script/gen/*.ts`. Parity fixtures regenerate with `bun run --cwd packages/cli-rs fixtures`.
  `bun run --cwd packages/cli-rs check:drift` reruns the generators and fixture oracles and fails on any
  change. `OPENCODE_RS_REQUIRE_TS=1` makes the live TypeScript interop tests fail instead of skip
  without bun or `node_modules`.
