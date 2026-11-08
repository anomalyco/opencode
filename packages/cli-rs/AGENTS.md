# cli-rs

The Rust client, `opencode-rs`, on OpenTUI's Rust crates. The plan and decisions live outside this repository, in
`/home/simon/src/opendocs/oc-rust/plan.md` and `decisions.md`. The root `AGENTS.md` applies too.

## Running cargo

- Cargo reads `.cargo/config.toml` from the current directory, not from `--manifest-path`, and
  `cargo -C` is unstable. Without that config `opentui-sys` fails with "set OPENTUI_LIB_DIR". Run
  cargo through the package script, which runs in this directory:
  `bun run --cwd packages/cli-rs cargo check -p opencode-api`.
- opentui comes from `packages/rust` of `anomalyco/opentui`, pinned by git `rev` in `Cargo.toml` and linked
  statically. That checkout has no native library: `.cargo/config.toml` points `OPENTUI_LIB_DIR` at
  `~/.cache/opentui-native/x86_64-linux`, which `/home/simon/src/opendocs/native-hardening/tools/abi-artifacts.py`
  fills with the artifacts whose `opentui.h` matches the bindings at that `rev`. When the build fails with the
  header hash message, rerun it. A shell `OPENTUI_LIB_DIR` wins over the config.
- A change to OpenTUI's Rust crates is a pull request into `packages/rust` of `anomalyco/opentui`. A re-pin runs
  `abi-artifacts.py` first, then commits the new `rev` with its `Cargo.lock`. The `rev` may name the head of an
  open pull request; re-pin to the merge commit on `main` once it merges.

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
