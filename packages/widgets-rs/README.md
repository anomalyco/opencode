# widgets-rs

OpenCode widgets' Rust hosts, as one Cargo workspace on PsychoScript's crates (`anomalyco/psychoscript`, `rust/`):

- `crates/widget-wire`: the widget binary wire format (`specs/v2/widgets-binary.md`: the encoder from PsychoScript
  values and a bounds-checked decoder) and the `wgsl` shorthand (`shorthand`: `Shorthand`, `Uniforms`, `HEADER`,
  `SLOW_*`) on psychoscript-gpu. GPU batches are psychoscript-gpu's `Arg` and `Batch`.
- `crates/widget-mobile`: the one native library each app ships (`libwidget_mobile`), psychoscript-mobile's UniFFI API
  plus the widget encoder and `ShaderCanvas` (its `README.md`).
- `crates/widget-web` and `web/`: the browser host (its `README.md`).

## PsychoScript's crates

`psychoscript-gpu` and `psychoscript-mobile` come from git at one revision of `anomalyco/psychoscript`
(`[workspace.dependencies]` in `Cargo.toml`), and `psychoscript` itself, `"0.1"` in the crates that need only it, is
patched to the same revision, so every crate here shares one. `wgpu-hal` is patched to PsychoScript's vendored copy at
that revision too (published wgpu-hal plus the Metal fix of gfx-rs/wgpu#10875: any command buffer that fails loses the
device), until a wgpu release has it. To bump the revision, change every `rev = ` in `Cargo.toml`, then run
`cargo update -p psychoscript` and commit `Cargo.lock`.

## Commands

Run from `packages/widgets-rs`, with the toolchain in `rust-toolchain.toml` (1.99.1):

```sh
cargo fmt --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace                                 # on a Mac: --features widget-wire/metal
```

The shorthand's tests (`widget-wire/tests/shorthand.rs`) run on Vulkan (lavapipe on a machine without a GPU, or a real
one), or on Metal with `--features widget-wire/metal`. widget-wire's tests read `packages/widget/test/fixtures/wire`
(the 58 native-host fixtures) and `draw.json` in place; widget-mobile's are in its `README.md`, Tests.

The apps' libraries are built by `crates/widget-mobile/scripts/build-ios.sh` and `build-android.sh`
(`crates/widget-mobile/README.md`, Building).
