#!/bin/sh
# Compile-checks the workspace for another target on Linux: clippy with every target and -D warnings. Nothing is
# linked or run; only the preview repository's runners do that.
#
# This is OpenTUI's packages/rust/scripts/check-targets.sh recipe for one target, with no installs: the standard
# library builds from rust-src (RUSTC_BOOTSTRAP stays in this local script and is never used in CI), Zig compiles
# the C code of ring, the grammars and opentui-sys against its own headers (MinGW's for Windows, its Darwin libc for
# macOS), and opentui-sys gets stub artifacts with the real opentui.h, because its build.rs only checks that they exist
# and that the header matches the bindings.
#
# Usage: sh script/check-target.sh <target> [extra cargo clippy arguments...]
# Targets: x86_64-pc-windows-msvc, aarch64-pc-windows-msvc, x86_64-apple-darwin, aarch64-apple-darwin.
# Set ZIG to the Zig command. The default is `zig`, or `zig 0.17.1` (OpenTUI's version) when `zig` is anyzig, which
# needs a version outside a Zig project.
set -eu

target=${1:?usage: check-target.sh <target> [cargo clippy arguments...]}
shift
case $target in
    x86_64-pc-windows-msvc) name=windows zig_target=x86_64-windows-gnu stubs='opentui.dll opentui.lib' ;;
    aarch64-pc-windows-msvc) name=windows-arm64 zig_target=aarch64-windows-gnu stubs='opentui.dll opentui.lib' ;;
    x86_64-apple-darwin) name=macos-x64 zig_target=x86_64-macos.13.0 stubs=libopentui.a ;;
    aarch64-apple-darwin) name=macos-arm64 zig_target=aarch64-macos.13.0 stubs=libopentui.a ;;
    *)
        printf 'check-target.sh: no recipe for %s\n' "$target" >&2
        exit 2
        ;;
esac

here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$here"
if [ -n "${ZIG:-}" ]; then
    zig=$ZIG
elif zig version > /dev/null 2>&1; then
    zig=zig
else
    zig='zig 0.17.1'
fi
# .cargo/config.toml's directory for the pin, unless the shell names another one.
pinned=$(sed -n 's/^OPENTUI_LIB_DIR = { value = "\([^"]*\)".*/\1/p' .cargo/config.toml)
header=${OPENTUI_LIB_DIR:-$pinned}/opentui.h

export CARGO_TARGET_DIR="$here/target/check-$name"
tools=$CARGO_TARGET_DIR/tools
mkdir -p "$tools/lib"
cp "$header" "$tools/lib/opentui.h"
for stub in $stubs; do
    : > "$tools/lib/$stub"
done
# rustc reads a static library it is told to link even in a check, so the archive is an empty one, not an empty file.
case $stubs in *libopentui.a*) printf '!<arch>\n' > "$tools/lib/libopentui.a" ;; esac
# cc-rs gives MSVC targets lib.exe's options and the others ar's.
case $target in
    *-windows-msvc) printf '#!/bin/sh\nexec %s lib "$@"\n' "$zig" > "$tools/ar" ;;
    *) printf '#!/bin/sh\nexec %s ar "$@"\n' "$zig" > "$tools/ar" ;;
esac
# The objects are never linked. zig cc takes the target from -target, so the wrapper drops cc-rs's --target, and the
# -arch pair Apple's clang takes.
cat > "$tools/cc" <<EOF
#!/bin/sh
skip=
for arg do
    shift
    if [ -n "\$skip" ]; then
        skip=
        continue
    fi
    case \$arg in
        --target=*) continue ;;
        -arch) skip=1; continue ;;
    esac
    set -- "\$@" "\$arg"
done
exec $zig cc -target $zig_target "\$@"
EOF
chmod +x "$tools/ar" "$tools/cc"

variable=$(printf '%s' "$target" | tr - _)
export OPENTUI_LIB_DIR="$tools/lib"
export RUSTC_BOOTSTRAP=1 CARGO_UNSTABLE_BUILD_STD=std
export "CC_$variable=$tools/cc" "AR_$variable=$tools/ar"
cargo=${CARGO:-cargo}
"$cargo" clippy --locked --target "$target" --workspace --all-targets "$@" -- -D warnings < /dev/null
printf 'PASS: compile checks (%s)\n' "$target"
