# cli-rs

The Rust client, `opencode-rs`, on opentui-rust. The plan and decisions live outside this repository, in
`/home/simon/src/opendocs/oc-rust/plan.md` and `decisions.md`. The root `AGENTS.md` applies too.

## Running cargo

- Cargo reads `.cargo/config.toml` from the current directory, not from `--manifest-path`, and
  `cargo -C` is unstable. Without that config `opentui-sys` fails with "set OPENTUI_LIB_DIR". Run
  cargo through the package script, which runs in this directory:
  `bun run --cwd packages/cli-rs cargo check -p opencode-api`.
- `script/opentui-lib.sh` (or `bun run --cwd packages/cli-rs opentui-lib`) fills
  `~/.cache/opencode-rs/opentui/<platform>` with native artifacts whose `opentui.h` matches
  opentui-rust's bindings. Rerun it when the build fails with the header hash message. A shell
  `OPENTUI_LIB_DIR` wins over the config.
- opentui is a path dependency on the local opentui-rust checkout, linked statically. A change on
  opentui-rust `main` shows up in the next build, with no lock change.

## Checks

Fast checks only, scoped with `-p` to the crates a step touches: `cargo fmt --check`, `cargo check`,
`cargo clippy --all-targets -- -D warnings`, and `cargo test`. Add one targeted parity scenario and single
TypeScript test files. No root `bun run check`, no full Bun suites, no opentui-rust `test.sh`, no
OpenTUI suites, no benchmarks. Put `timeout` on anything that could hang.

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
- opentui-rust handles are not `Send`. Network work runs on tokio through `App::spawn`; never block the
  UI thread.
- Every queue between tasks and the UI is bounded.
- Where the TypeScript TUI uses `flexGrow`, use `grow().basis(Length::Auto)`: opentui-rust's `grow()`
  alone sets basis 0, which lays out differently.
- Generated files are committed; regenerate with `bun run --cwd packages/cli-rs generate`, which runs
  every `script/gen/*.ts`. Parity fixtures regenerate with `bun run --cwd packages/cli-rs fixtures`.
