#!/usr/bin/env bash
# sign-desktop-macos.sh <out dir> <app tarball>...: signs each unsigned .app inside-out with hardened runtime,
# notarizes them in one submission, staples them, and only then builds opencode-desktop-mac-<arch>.{zip,dmg,app.tar.gz}
# from the stapled apps. Dry runs sign ad-hoc and skip notarization. Dev and beta trade larger files for faster
# packaging (zip and dmg at zlib level 1) and skip the .app.tar.gz, which only the retired Tauri updater feed read.
# Notarization reads APPLE_API_KEY_CONTENT, APPLE_API_KEY_ID and APPLE_API_ISSUER.
. "$(dirname "$0")/lib.sh"

out=$1
shift
mkdir -p "$out"
apps=$(mktemp -d)
identity=- timestamp=--timestamp=none
zip_level=() dmg_level=() preview=false
case "$OPENCODE_CHANNEL" in dev | beta) preview=true ;; esac
if [ "$preview" = true ]; then zip_level=(--zlibCompressionLevel 1) dmg_level=(-imagekey zlib-level=1); fi
if ! dry_run; then
  identity=$(security find-identity -v -p codesigning build.keychain | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -n 1)
  [ -n "$identity" ] || die "Developer ID Application identity not found"
  timestamp=--timestamp
fi
sign() {
  codesign --force "$timestamp" --options runtime --entitlements "$2" --sign "$identity" "$1"
}
bundle() {
  find "$apps/$1" -mindepth 1 -maxdepth 1 -name '*.app' -type d
}

for tarball in "$@"; do
  arch=$(basename "$tarball" .app.tar)
  arch=${arch#opencode-desktop-mac-}
  [ "$arch" = arm64 ] || [ "$arch" = x64 ] || die "Unexpected app tarball: $tarball"
  mkdir -p "$apps/$arch"
  tar -xf "$tarball" -C "$apps/$arch"
  if [ "$(find "$apps/$arch" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" != 1 ] || [ -z "$(bundle "$arch")" ]; then
    die "Expected exactly one .app bundle in $tarball"
  fi
  app=$(bundle "$arch")

  # Every nested Mach-O file and bundle, deepest first, then the app itself.
  list=$(mktemp)
  {
    find "$app/Contents" -type f -print0 | while IFS= read -r -d '' file; do
      case "$(file -b --mime-type "$file")" in application/x-mach-binary*) printf '%s\n' "$file" ;; esac
    done
    find "$app/Contents" -type d \( -name '*.app' -o -name '*.framework' \) -print
  } | awk -F/ '{ print NF "\t" $0 }' | sort -t "$(printf '\t')" -k1,1nr | cut -f2- > "$list"
  echo "Signing $(wc -l < "$list" | tr -d ' ') items in $app"
  while IFS= read -r item; do
    if [ "$item" = "$app/Contents/Resources/opencode-cli" ]; then
      # The bundled Bun CLI loads bun-pty's native library; Electron and its helpers do not need this exception.
      sign "$item" "$release_dir/entitlements/desktop-cli.plist"
    else
      sign "$item" "$release_dir/entitlements/desktop.plist"
    fi
  done < "$list"
  sign "$app" "$release_dir/entitlements/desktop.plist"
  codesign --verify --deep --strict --verbose=2 "$app"
done

if ! dry_run; then
  key=$(mktemp)
  printf '%s\n' "$APPLE_API_KEY_CONTENT" > "$key"
  ditto -c -k --sequesterRsrc "$apps" "$apps.zip"
  xcrun notarytool submit "$apps.zip" --key "$key" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
    --wait --timeout 60m --output-format json > "$apps.json"
  rm -f "$key"
  cat "$apps.json"
  [ "$(jq -r .status "$apps.json")" = Accepted ] || die "Notarization was not accepted"
fi

for dir in "$apps"/*; do
  arch=$(basename "$dir")
  app=$(bundle "$arch")
  name=$(basename "$app")
  if ! dry_run; then
    xcrun stapler staple "$app"
    xcrun stapler validate "$app"
    spctl --assess --type execute --verbose=2 "$app"
  fi
  ditto -c -k ${zip_level[@]+"${zip_level[@]}"} --sequesterRsrc --keepParent "$app" "$out/opencode-desktop-mac-$arch.zip"
  staging=$(mktemp -d)
  ditto "$app" "$staging/$name"
  ln -s /Applications "$staging/Applications"
  hdiutil create -volname "${name%.app}" -srcfolder "$staging" -fs HFS+ -format UDZO ${dmg_level[@]+"${dmg_level[@]}"} -ov "$out/opencode-desktop-mac-$arch.dmg"
  if [ "$preview" = true ]; then continue; fi
  COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$out/opencode-desktop-mac-$arch.app.tar.gz" -C "$dir" "$name"
done
