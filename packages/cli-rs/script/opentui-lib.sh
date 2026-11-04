#!/bin/sh
# Copies OpenTUI native artifacts that match opentui-rust's generated bindings into the directory
# .cargo/config.toml points OPENTUI_LIB_DIR at.
#
# Usage: script/opentui-lib.sh [artifact-dir...]
#
# Each artifact directory holds opentui.h, libopentui.a, and libopentui.so, for example an OpenTUI checkout's
# packages/native/lib/x86_64-linux. Without arguments it searches $OPENTUI_ROOT, ~/src/opentui, and the OpenTUI
# worktrees in ~/src/wt/ot-*. The newest directory whose opentui.h has the hash the bindings expect wins.
set -eu

platform=$(uname -sm)
case "$platform" in
  "Linux x86_64") platform=x86_64-linux ;;
  "Darwin arm64") platform=aarch64-macos ;;
  "Darwin x86_64") platform=x86_64-macos ;;
  *) echo "opentui-lib: unsupported platform $platform" >&2; exit 1 ;;
esac
case "$platform" in
  *-linux) shared=libopentui.so ;;
  *) shared=libopentui.dylib ;;
esac

opentui_rust=${OPENTUI_RUST:-$HOME/src/opentui-rust}
dest=${OPENCODE_RS_OPENTUI_DIR:-$HOME/.cache/opencode-rs/opentui/$platform}

expected=$(sed -n 's/^pub const OPENTUI_HEADER_FNV1A64: u64 = 0x\([0-9a-f_]*\);$/\1/p' \
  "$opentui_rust/crates/opentui-sys/src/generated.rs" | tr -d _)
if [ -z "$expected" ]; then
  echo "opentui-lib: no header hash in $opentui_rust/crates/opentui-sys/src/generated.rs" >&2
  exit 1
fi

# Must match fnv1a64 in opentui-rust's crates/opentui-sys/build.rs.
hash() {
  python3 -c '
import sys
h = 0xcbf29ce484222325
for b in open(sys.argv[1], "rb").read():
    h = ((h ^ b) * 0x100000001b3) & 0xffffffffffffffff
print(f"{h:016x}")
' "$1"
}

if [ $# -eq 0 ]; then
  set -- "${OPENTUI_ROOT:-$HOME/src/opentui}/packages/native/lib/$platform" "$HOME"/src/wt/ot-*/packages/native/lib/"$platform"
fi

best=
best_time=0
for dir in "$@"; do
  [ -f "$dir/opentui.h" ] && [ -f "$dir/libopentui.a" ] && [ -f "$dir/$shared" ] || continue
  [ "$(hash "$dir/opentui.h")" = "$expected" ] || continue
  time=$(stat -c %Y "$dir/libopentui.a" 2>/dev/null || stat -f %m "$dir/libopentui.a")
  if [ "$time" -gt "$best_time" ]; then
    best=$dir
    best_time=$time
  fi
done

if [ -z "$best" ]; then
  echo "opentui-lib: no artifact directory has an opentui.h with hash 0x$expected" >&2
  echo "opentui-lib: build OpenTUI at the commit opentui-rust's bindings were generated from and pass its packages/native/lib/$platform" >&2
  exit 1
fi

mkdir -p "$dest"
for file in opentui.h libopentui.a "$shared"; do
  cp "$best/$file" "$dest/$file.tmp"
  mv "$dest/$file.tmp" "$dest/$file"
done
echo "opentui-lib: copied $best to $dest (header 0x$expected)"
