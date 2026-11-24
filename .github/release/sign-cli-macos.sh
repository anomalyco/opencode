#!/usr/bin/env bash
# sign-cli-macos.sh <build-npm dir> <out dir>: signs the three macOS CLI binaries inside their npm tarballs with
# the Developer ID in build.keychain, then writes the re-packed tarballs and the opencode-<target>.zip archives.
# Dry runs sign ad-hoc.
. "$(dirname "$0")/lib.sh"

in=$1 out=$2
mkdir -p "$out"
identity=- timestamp=--timestamp=none
if ! dry_run; then
  identity=$(security find-identity -v -p codesigning build.keychain | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -n 1)
  [ -n "$identity" ] || die "Developer ID Application identity not found"
  timestamp=--timestamp
fi

export COPYFILE_DISABLE=1
for target in darwin-arm64 darwin-x64 darwin-x64-baseline; do
  work=$(mktemp -d)
  tar -xzf "$in/opencode-cli-$target-$OPENCODE_VERSION.tgz" -C "$work"
  bin="$work/package/bin/opencode"
  file -b "$bin" | grep -q '^Mach-O' || die "$target is not a Mach-O binary"
  chmod 755 "$bin"
  codesign --force "$timestamp" --options runtime --entitlements "$release_dir/entitlements/cli.plist" --sign "$identity" "$bin"
  codesign --verify --strict --verbose=2 "$bin"
  tar --no-mac-metadata -czf "$out/opencode-cli-$target-$OPENCODE_VERSION.tgz" -C "$work" package
  touch -t 198001010000 "$bin"
  (cd "$work/package/bin" && zip -X -q "$out/opencode-$target.zip" opencode)
done
