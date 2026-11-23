#!/usr/bin/env bash
# repack-windows.sh <work dir> <out dir>: checks every signature in <work dir>, then writes the signed CLI back
# into npm tarballs and opencode-<target>.zip archives in <out dir>.
. "$(dirname "$0")/lib.sh"

work=$(posix "$1") out=$(posix "$2")
bash "$release_dir/verify-signatures-windows.sh" "$work"
mkdir -p "$out"
if [ ! -d "$work/cli" ]; then exit 0; fi
for target in windows-arm64 windows-x64 windows-x64-baseline; do
  tar -czf "$out/opencode-cli-$target-$OPENCODE_VERSION.tgz" -C "$work/cli/$target" package
  powershell -NoProfile -Command "Compress-Archive -Path '$(cygpath -w "$work/cli/$target/package/bin/opencode.exe")' -DestinationPath '$(cygpath -w "$out/opencode-$target.zip")'"
done
