#!/usr/bin/env bash
# Builds the WebAssembly module into web/wasm/: widget_web (the language: Program, LiveRun), from the Rust workspace
# packages/widgets-rs. Needs the wasm32-unknown-unknown target, wasm-bindgen-cli at the version in
# packages/widgets-rs/Cargo.lock, and wasm-opt (binaryen).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
rust="$(cd "$here/.." && pwd)"
out="$here/wasm"
target="${CARGO_TARGET_DIR:-$rust/target}"
mkdir -p "$out"
# Source paths in panic messages, made the same on every machine: the build is reproducible, and no build machine's
# directories end up in the module.
registry="${CARGO_HOME:-$HOME/.cargo}/registry/src"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$registry=/cargo/registry/src --remap-path-prefix=$(cd "$rust/../.." && pwd)=/opencode"

build() { # features out-name
  (cd "$rust" && cargo build --locked --release -p widget-web --target wasm32-unknown-unknown $1)
  wasm-bindgen --target web --out-dir "$out" --out-name "$2" \
    "$target/wasm32-unknown-unknown/release/widget_web.wasm"
  if command -v wasm-opt >/dev/null; then
    wasm-opt "$out/$2_bg.wasm" -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
      --enable-mutable-globals --strip-debug --strip-producers -o "$out/$2_bg.wasm"
  else
    echo "wasm-opt not found: $2_bg.wasm is unoptimized" >&2
  fi
}

build "" widget_web
ls -l "$out"
