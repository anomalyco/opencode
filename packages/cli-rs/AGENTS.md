# cli-rs

The OpenCode native CLI (`opencode-native`), in Rust on OpenTUI. The root `AGENTS.md` applies too. User-facing names
say "native"; crates, this directory, and `OPENCODE_RS_*` variables say "rs".

## Build

- Run cargo through the package script, for example `bun run --cwd packages/cli-rs cargo check -p opencode-api`. It
  installs OpenTUI's native library, and cargo reads `.cargo/config.toml` only from the current directory.
- `rust-toolchain.toml` pins the toolchain.
- OpenTUI is the crates.io `opentui` at an exact `version` in `Cargo.toml`. To re-pin it, change these together: the
  release's rows in the sha256 table in `script/opentui-native.ts`, the `version`, `Cargo.lock`, and the directory in
  `.cargo/config.toml`. Send changes to OpenTUI's crates to `anomalyco/opentui`.

## Checks

CI (`.github/workflows/check-cli-rs.yml`) runs:

- `bun run cargo fmt --check`
- `bun run cargo clippy --locked --workspace --all-targets -- -D warnings`
- `bun run cargo test --locked --workspace --no-fail-fast`
- `bun run check:drift`

CI has no `opencode` binary, so a few tests that need one skip. Before merging, also run these locally:

- `OPENCODE_RS_REQUIRE_TS=1 bun run cargo test --locked --workspace --no-fail-fast`, with an `opencode` binary on
  `PATH`. Then the TypeScript interop tests fail instead of skipping.
- `bun run parity:machines`

Each of `opencode-tui` and `opencode-ui` has one integration test binary, `tests/all/main.rs`, with one module per
area. Add tests as a module there, not as a new `tests/*.rs`. The package has no `test` script on purpose, because
CI would run the slow parity machines through turbo; run them with `bun run parity:machines`.

## Rules

- Generated files are committed. Regenerate them with `bun run generate` and the parity fixtures with
  `bun run fixtures`; never edit a fixture by hand. `bun run check:drift` fails if either is stale.
- Record each deviation from the TypeScript client in `parity/deviations/`. A difference without a file is a
  failure.
- OpenTUI handles are not `Send`. Run network work through `App::spawn`, and never block the UI thread.
- Bound every queue between tasks and the UI.
- Where the TypeScript TUI uses `flexGrow`, use `grow().basis(Length::Auto)`; `grow()` alone sets basis 0.
- Declare third-party crates once in the root `[workspace.dependencies]`. A change to `deps-allow.txt` needs a
  maintainer's approval.
