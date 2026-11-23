#!/usr/bin/env bash
# unpack-windows.sh <download dir> <work dir>: lays out what the signing action signs in <work dir>:
# cli/<target>/package from the Windows CLI npm tarballs, and desktop-<target>/ from the unpacked desktop apps.
. "$(dirname "$0")/lib.sh"

in=$(posix "$1") work=$(posix "$2")
mkdir -p "$work"
if [ -d "$in/build-npm" ]; then
  for target in windows-arm64 windows-x64 windows-x64-baseline; do
    mkdir -p "$work/cli/$target"
    tar -xzf "$in/build-npm/opencode-cli-$target-$OPENCODE_VERSION.tgz" -C "$work/cli/$target"
    test -s "$work/cli/$target/package/bin/opencode.exe" || die "Missing opencode.exe for $target"
  done
fi
for target in windows-arm64 windows-x64; do
  if [ -d "$in/build-desktop-$target" ]; then mkdir -p "$work/desktop-$target" && cp -R "$in/build-desktop-$target/app" "$work/desktop-$target/app"; fi
done
