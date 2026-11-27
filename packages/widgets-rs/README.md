# widgets-rs

OpenCode widgets' Rust hosts, as one Cargo workspace on PsychoScript's crates (`anomalyco/psychoscript`, `rust/`):

- `crates/widget-wire`: the widget binary wire format (`specs/v2/widgets-binary.md`: the encoder from PsychoScript
  values and a bounds-checked decoder) and the `wgsl` shorthand (`shorthand`: `Shorthand`, `Uniforms`, `HEADER`,
  `SLOW_*`) on psychoscript-gpu. GPU batches are psychoscript-gpu's `Arg` and `Batch`.
- `crates/widget-mobile`: the one native library each app ships (`libwidget_mobile`), psychoscript-mobile's UniFFI API
  plus the widget encoder and `ShaderCanvas` (its `README.md`).
- `crates/widget-web` and `web/`: the browser host (its `README.md`).

## PsychoScript's crates

`psychoscript`, `psychoscript-gpu` and `psychoscript-mobile` come from crates.io (`"0.1"`; `[workspace.dependencies]` in
`Cargo.toml` and the crates' own manifests); bump them with `cargo update -p <crate>` and commit `Cargo.lock`. A
published crate can't carry PsychoScript's vendored `wgpu-hal` (wgpu-hal 30.0.2 plus the Metal fix of
gfx-rs/wgpu#10875: any command buffer that fails loses the device), so this workspace patches `wgpu-hal` to it
(`[patch.crates-io]`, by git at a commit of PsychoScript's `dev`) until a wgpu release has the fix.

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
