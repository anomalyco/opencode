#!/usr/bin/env bash
# 代码签名 + 公证脚本
# 需要环境变量:
#   APPLE_DEVELOPER_ID     - Developer ID Application 证书名称
#   APPLE_TEAM_ID          - Team ID
#   APPLE_ID_EMAIL         - Apple ID (用于公证)
#   APPLE_ID_PASSWORD      - App-specific password (用于公证)
#   KEYCHAIN_PROFILE       - notarytool keychain profile (可选)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="${1:-}"
ENTITLEMENTS="$SCRIPT_DIR/../packaging/YunPat.entitlements"

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "usage: sign-and-notarize.sh <path-to-YunPat.app>"
  exit 1
fi

DEVELOPER_ID="${APPLE_DEVELOPER_ID:-}"
TEAM_ID="${APPLE_TEAM_ID:-}"

if [ -z "$DEVELOPER_ID" ]; then
  echo "APPLE_DEVELOPER_ID not set. Searching for available Developer ID certificates..."
  DEVELOPER_ID=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
  if [ -z "$DEVELOPER_ID" ]; then
    echo "ERROR: No Developer ID Application certificate found."
    echo "Skipping signing. App will not pass Gatekeeper."
    exit 0
  fi
fi

echo "=== Signing YunPat.app ==="
echo "  Identity: $DEVELOPER_ID"
echo "  Entitlements: $ENTITLEMENTS"
echo ""

# Sign native frameworks and dylibs first (deep sign)
echo "Signing bundled binaries and frameworks..."
find "$APP_PATH/Contents/Resources" -name '*.dylib' -o -name '*.node' -o -name '*.so' | while read -r file; do
  codesign --force --options runtime --sign "$DEVELOPER_ID" --timestamp "$file" 2>/dev/null || true
done

# Sign Sparkle framework if present
if [ -d "$APP_PATH/Contents/Frameworks/Sparkle.framework" ]; then
  codesign --force --options runtime --sign "$DEVELOPER_ID" --timestamp \
    "$APP_PATH/Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle" 2>/dev/null || true
fi

# Sign the main binary with entitlements
echo "Signing main binary..."
codesign --force --options runtime \
  --entitlements "$ENTITLEMENTS" \
  --sign "$DEVELOPER_ID" \
  --timestamp \
  --deep \
  "$APP_PATH"

echo "  Signing complete"
echo ""

# Verify signature
echo "Verifying signature..."
codesign --verify --verbose=4 "$APP_PATH"
echo ""

# Notarization
if [ "${SKIP_NOTARIZE:-0}" = "1" ]; then
  echo "Skipping notarization (SKIP_NOTARIZE=1)"
  exit 0
fi

echo "=== Creating zip for notarization ==="
ZIP_PATH="$(dirname "$APP_PATH")/YunPat-notarize.zip"
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

echo "Submitting for notarization..."
NOTARY_RESULT=$(xcrun notarytool submit "$ZIP_PATH" \
  --apple-id "${APPLE_ID_EMAIL:-}" \
  --team-id "${TEAM_ID:-}" \
  --password "${APPLE_ID_PASSWORD:-}" \
  --wait 2>&1) || true

echo "$NOTARY_RESULT"
SUBMISSION_ID=$(echo "$NOTARY_RESULT" | grep "id:" | head -1 | awk '{print $2}')

if [ -n "${SUBMISSION_ID:-}" ]; then
  echo ""
  echo "Notarization status:"
  xcrun notarytool info "$SUBMISSION_ID" \
    --apple-id "${APPLE_ID_EMAIL:-}" \
    --team-id "${TEAM_ID:-}" \
    --password "${APPLE_ID_PASSWORD:-}"

  echo ""
  echo "Stapling notarization ticket..."
  xcrun stapler staple "$APP_PATH"
  echo "  Staple complete"
fi

rm -f "$ZIP_PATH"

echo ""
echo "=== Signing & Notarization Complete ==="
