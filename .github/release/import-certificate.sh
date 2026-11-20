#!/usr/bin/env bash
set -euo pipefail
umask 077
cert="$RUNNER_TEMP/cert.p12"
trap 'rm -f "$cert"' EXIT
keychain_password=$(openssl rand -base64 32)
printf '%s' "$APPLE_SIGNING_CERTIFICATE" | base64 --decode > "$cert"
unset APPLE_SIGNING_CERTIFICATE
security create-keychain -p "$keychain_password" build.keychain
security set-keychain-settings -lut 21600 build.keychain
security unlock-keychain -p "$keychain_password" build.keychain
security import "$cert" -k build.keychain -P "" -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productsign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" build.keychain > /dev/null
security list-keychains -d user -s build.keychain $(security list-keychains -d user | tr -d '"')
