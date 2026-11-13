#!/bin/sh
# Compile-checks the workspace for x86_64-pc-windows-msvc on Linux: clippy with every target and -D warnings, once
# with the default features and once with opencode-ui/grammars-all. Nothing is linked or run; only the preview
# repository's Windows runner does that.
#
# This is OpenTUI's packages/rust/scripts/check-targets.sh recipe for one target, with no installs: the standard
# library builds from rust-src (RUSTC_BOOTSTRAP stays in this local script and is never used in CI), Zig compiles
# the C code of ring, the grammars and opentui-sys against its MinGW headers, and opentui-sys gets stub artifacts with
# the real opentui.h, because its build.rs only checks that they exist and that the header matches the bindings.
#
# Usage: sh script/check-windows.sh [extra cargo clippy arguments...]
# Set ZIG to the Zig command. The default is `zig`, or `zig 0.17.1` (OpenTUI's version) when `zig` is anyzig, which
# needs a version outside a Zig project.
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$here"
if [ -n "${ZIG:-}" ]; then
    zig=$ZIG
elif zig version > /dev/null 2>&1; then
    zig=zig
else
    zig='zig 0.17.1'
fi
target=x86_64-pc-windows-msvc
# .cargo/config.toml's directory, unless the shell names another one.
header=${OPENTUI_LIB_DIR:-$HOME/.cache/opentui-native/x86_64-linux}/opentui.h

export CARGO_TARGET_DIR="$here/target/check-windows"
tools=$CARGO_TARGET_DIR/tools
mkdir -p "$tools/lib"
cp "$header" "$tools/lib/opentui.h"
for stub in opentui.dll opentui.lib; do
    : > "$tools/lib/$stub"
done
# cc-rs gives MSVC targets lib.exe's options.
printf '#!/bin/sh\nexec %s lib "$@"\n' "$zig" > "$tools/zig-lib"
# Zig has no MSVC headers, so the C code compiles against MinGW's; the objects are never linked.
# It drops cc-rs's --target, which zig cc takes from -target instead.
cat > "$tools/cc" <<EOF
#!/bin/sh
for arg do
    shift
    case \$arg in --target=*) continue ;; esac
    set -- "\$@" "\$arg"
done
exec $zig cc -target x86_64-windows-gnu "\$@"
EOF
chmod +x "$tools/zig-lib" "$tools/cc"

export OPENTUI_LIB_DIR="$tools/lib"
export RUSTC_BOOTSTRAP=1 CARGO_UNSTABLE_BUILD_STD=std
export CC_x86_64_pc_windows_msvc="$tools/cc" AR_x86_64_pc_windows_msvc="$tools/zig-lib"
cargo=${CARGO:-cargo}
for features in '' '--features opencode-ui/grammars-all'; do
    # shellcheck disable=SC2086
    "$cargo" clippy --locked --target "$target" --workspace --all-targets $features "$@" -- -D warnings < /dev/null
done
printf 'PASS: compile checks (%s)\n' "$target"
