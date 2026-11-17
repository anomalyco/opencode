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
# Targets: x86_64-pc-windows-msvc, aarch64-pc-windows-msvc, aarch64-unknown-linux-gnu, x86_64-unknown-linux-musl,
# aarch64-unknown-linux-musl, x86_64-apple-darwin, aarch64-apple-darwin.
# Set ZIG to the Zig command. The default is `zig`, or `zig 0.17.1` (OpenTUI's version) when `zig` is anyzig, which
# needs a version outside a Zig project.
set -eu

target=${1:?usage: check-target.sh <target> [cargo clippy arguments...]}
shift
case $target in
    x86_64-pc-windows-msvc) name=windows zig_target=x86_64-windows-gnu stubs=opentui-static.lib ;;
    aarch64-pc-windows-msvc) name=windows-arm64 zig_target=aarch64-windows-gnu stubs=opentui-static.lib ;;
    aarch64-unknown-linux-gnu) name=linux-arm64 zig_target=aarch64-linux-gnu.2.17 stubs=libopentui.a ;;
    x86_64-unknown-linux-musl) name=linux-x64-musl zig_target=x86_64-linux-musl stubs=libopentui.a ;;
    aarch64-unknown-linux-musl) name=linux-arm64-musl zig_target=aarch64-linux-musl stubs=libopentui.a ;;
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
# Without Zig the check fails deep in a build script, as cc-rs's "exec: zig: not found".
if ! $zig version > /dev/null 2>&1; then
    printf 'check-target.sh: %s does not run: put Zig on PATH, or set ZIG to its command\n' "$zig" >&2
    exit 2
fi
# The header of the pin's library: from the shell's OPENTUI_LIB_DIR; for a release pin, from the directory
# script/opentui-native.ts fills (the one .cargo/config.toml names, relative to this package); for a `rev` pin, from
# the directory .cargo/config.toml names.
if [ -n "${OPENTUI_LIB_DIR:-}" ]; then
    header=$OPENTUI_LIB_DIR/opentui.h
elif grep -q '^opentui = {.*\btag = ' Cargo.toml; then
    header=$(bun run script/opentui-native.ts)/opentui.h
else
    header=$(sed -n 's/^OPENTUI_LIB_DIR = { value = "\([^"]*\)".*/\1/p' .cargo/config.toml)/opentui.h
fi

export CARGO_TARGET_DIR="$here/target/check-$name"
tools=$CARGO_TARGET_DIR/tools
mkdir -p "$tools/lib"
cp "$header" "$tools/lib/opentui.h"
# The static archive opentui-sys links with its default static feature: libopentui.a, or opentui-static.lib on MSVC.
# rustc reads a static library it is told to link even in a check, so the stub is an empty archive (COFF archives
# share ar's format), not an empty file.
for stub in $stubs; do
    printf '!<arch>\n' > "$tools/lib/$stub"
done
# cc-rs gives MSVC targets lib.exe's options and the others ar's.
case $target in
    *-windows-msvc) printf '#!/bin/sh\nexec %s lib "$@"\n' "$zig" > "$tools/ar" ;;
    *) printf '#!/bin/sh\nexec %s ar "$@"\n' "$zig" > "$tools/ar" ;;
esac
# The objects are never linked. zig cc takes the target from -target, so the wrapper drops cc-rs's --target, and the
# -arch pair Apple's clang takes. C++ (Luau's, with the luau feature) goes through zig c++ the same way: without it
# cc-rs falls back to the host's GNU c++, which makes ELF objects for Windows and refuses Apple's flags.
for tool in cc c++; do
    cat > "$tools/$tool" <<EOF
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
exec $zig $tool -target $zig_target "\$@"
EOF
done
chmod +x "$tools/ar" "$tools/cc" "$tools/c++"

variable=$(printf '%s' "$target" | tr - _)
export OPENTUI_LIB_DIR="$tools/lib"
export RUSTC_BOOTSTRAP=1 CARGO_UNSTABLE_BUILD_STD=std
export "CC_$variable=$tools/cc" "CXX_$variable=$tools/c++" "AR_$variable=$tools/ar"
cargo=${CARGO:-cargo}
"$cargo" clippy --locked --target "$target" --workspace --all-targets "$@" -- -D warnings < /dev/null
printf 'PASS: compile checks (%s)\n' "$target"
