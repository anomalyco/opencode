#!/usr/bin/env bash
# publish-desktop.sh <sign-macos dir> <sign-desktop-windows-installer dir> <build-desktop-linux-x64 dir>
# <build-desktop-linux-arm64 dir>: uploads the desktop builds to opencode.ai/files and registers the desktop update
# artifact. The electron-updater feeds (latest*.yml) are computed here from the final signed files.
. "$(dirname "$0")/lib.sh"

macos=$1 windows=$2 linux_x64=$3 linux_arm64=$4
win=("$windows/opencode-desktop-win-arm64.exe" "$windows/opencode-desktop-win-x64.exe")
mac=("$macos/opencode-desktop-mac-arm64.zip" "$macos/opencode-desktop-mac-arm64.dmg" "$macos/opencode-desktop-mac-x64.zip" "$macos/opencode-desktop-mac-x64.dmg")
linux=("$linux_x64/opencode-desktop-linux-x86_64.AppImage" "$linux_x64/opencode-desktop-linux-amd64.deb" "$linux_x64/opencode-desktop-linux-x86_64.rpm")
linux_arm=("$linux_arm64/opencode-desktop-linux-arm64.AppImage" "$linux_arm64/opencode-desktop-linux-arm64.deb" "$linux_arm64/opencode-desktop-linux-aarch64.rpm")
# Dev and beta skip the .app.tar.gz, which only the retired Tauri updater feed read.
bundles=()
case "$OPENCODE_CHANNEL" in
  dev | beta) ;;
  *) bundles=("$macos/opencode-desktop-mac-arm64.app.tar.gz" "$macos/opencode-desktop-mac-x64.app.tar.gz") ;;
esac

feed() {
  for file in "$@"; do
    jq -n --arg url "https://opencode.ai/files/bin/$OPENCODE_VERSION/$(basename "$file")" \
      --arg sha512 "$(openssl dgst -sha512 -binary "$file" | base64 | tr -d '\n')" --argjson size "$(size "$file")" \
      '{url: $url, sha512: $sha512, size: $size}'
  done | jq -s --arg date "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '{files: ., releaseDate: $date}'
}

files=$(upload_files "${win[@]}" "${mac[@]}" "${linux[@]}" "${linux_arm[@]}" "${bundles[@]}")
manifests=$(jq -n --argjson win "$(feed "${win[@]}")" --argjson mac "$(feed "${mac[@]}")" \
  --argjson linux "$(feed "${linux[@]}")" --argjson linux_arm64 "$(feed "${linux_arm[@]}")" \
  '{"desktop.yml": $win, "desktop-mac.yml": $mac, "desktop-linux.yml": $linux, "desktop-linux-arm64.yml": $linux_arm64}')
publish_update desktop opencode "$(jq -n --argjson files "$files" --argjson manifests "$manifests" '{files: $files, manifests: $manifests}')"
