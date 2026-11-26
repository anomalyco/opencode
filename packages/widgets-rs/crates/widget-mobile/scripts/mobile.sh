# Sourced by build-ios.sh and build-android.sh: `$mobile`, the psychoscript-mobile source cargo builds this crate with
# (the git checkout of the revision Cargo.lock pins, or the crates.io package), whose build scripts make the package;
# `$root`, this workspace.
crate="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$crate/../.." && pwd)"
# rustup's proxies first, so rust-toolchain.toml picks the toolchain (a Homebrew cargo ignores it).
[ -x "$HOME/.cargo/bin/cargo" ] && PATH="$HOME/.cargo/bin:$PATH" && export PATH
manifest="$(cd "$root" && cargo metadata --locked --format-version 1 \
  | grep -oE '"manifest_path":"[^"]*/psychoscript-mobile(-[0-9][^/"]*)?/Cargo.toml"' | head -n 1 | cut -d '"' -f 4)"
[ -n "$manifest" ] || { echo "psychoscript-mobile isn't among this workspace's packages" >&2; exit 1; }
mobile="$(dirname "$manifest")"
export CRATE=widget-mobile ROOT="$root" REPO=anomalyco/opencode README="$crate/README.md"
