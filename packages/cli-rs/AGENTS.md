# cli-rs

The OpenCode native CLI (command `opencode-native`), on OpenTUI's Rust crates. Only user-facing names say
"native"; the crates, this directory and the `OPENCODE_RS_*` test variables keep their `rs` names. The root
`AGENTS.md` applies too.

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
  directory together. A git `rev` between releases has no zip: build OpenTUI's native library from that commit and set
  `OPENTUI_LIB_DIR` to it.
- The toolchain is pinned in `rust-toolchain.toml`; rustup installs it on first use.

## Checks

Scope checks with `-p` to the crates a change touches: `cargo fmt --check`, `cargo check`,
`cargo clippy --all-targets -- -D warnings`, and `cargo test`. Add a targeted parity scenario and run single
TypeScript test files. OpenTUI's own suites (`packages/rust/test.sh`) and benchmarks are not part of this package's
checks. Put `timeout` on anything that could hang. Before merging, the whole package must pass:

- `bun run cargo fmt --check`
- `bun run cargo clippy --locked --workspace --all-targets -- -D warnings`
- `bun run cargo test --locked --workspace --no-fail-fast`
- `bun run check:drift`
- `bun run parity:machines`

Run `cargo fmt` before every final commit; `cargo fmt --check` must be clean. `rustfmt.toml` matches OpenTUI's
`packages/rust/rustfmt.toml`.

The integration tests of `opencode-tui` and `opencode-ui` link the static OpenTUI set, so each crate
has one test binary, `tests/all/main.rs`, with one module per area and the shared helpers under
`tests/all/support`. Add a new test file there as a module, not as a new `tests/*.rs`. Run one area
with `cargo test -p opencode-tui --test all <module>::`, the unit tests with `--lib`.

The package has no `test` script on purpose: the repository's CI runs every package's `test` through turbo, also for
pull requests that only touch a package this one depends on, and the parity machines are slow. Run them with
`bun run parity:machines`; `parity:machines:deep` adds every path to the file's depth and the fault trials.

## Dependencies

- Third-party crates are declared once in the root `[workspace.dependencies]`. A crate takes one with
  `name.workspace = true`.
- `deps-allow.txt` lists every third-party crate the workspace may use, and `crates/cli/tests/deps.rs` fails unless
  it matches the graph. A new crate, build script, proc macro or source needs a maintainer's approval before its
  line goes in. `deny.toml` checks licences, bans and sources (`bun run check:deny`).

## Rules

- Deviations from the TypeScript client go in `parity/deviations/<row>-<slug>.md`: the TypeScript
  behavior, the Rust behavior, and the reason. A difference without a file is a failure. A defect the TypeScript
  client shares is fixed in Rust and recorded as a deviation.
- OpenTUI handles are not `Send`. Network work runs on tokio through `App::spawn`; never block the
  UI thread.
- Every queue between tasks and the UI is bounded.
- Where the TypeScript TUI uses `flexGrow`, use `grow().basis(Length::Auto)`: OpenTUI's `grow()`
  alone sets basis 0, which lays out differently.
- Generated files are committed; regenerate with `bun run --cwd packages/cli-rs generate`, which runs
  every `script/gen/*.ts`. Parity fixtures regenerate with `bun run --cwd packages/cli-rs fixtures`; a file under
  `parity/fixtures` is written only by its writer, never by hand.
  `bun run --cwd packages/cli-rs check:drift` reruns the generators and fixture oracles and fails on any
  change. `OPENCODE_RS_REQUIRE_TS=1` makes the live TypeScript interop tests fail instead of skip
  without bun or `node_modules`.
