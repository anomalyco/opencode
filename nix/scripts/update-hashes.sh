#!/usr/bin/env bash

set -euo pipefail

DUMMY="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
SYSTEM=${SYSTEM:-x86_64-linux}
DEFAULT_HASH_FILE=${MODULES_HASH_FILE:-nix/hashes.json}
HASH_FILE=${HASH_FILE:-$DEFAULT_HASH_FILE}

if [ ! -f "$HASH_FILE" ]; then
  cat >"$HASH_FILE" <<EOF
{
  "nodeModules": {}
}
EOF
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git ls-files --error-unmatch "$HASH_FILE" >/dev/null 2>&1; then
    git add -N "$HASH_FILE" >/dev/null 2>&1 || true
  fi
fi

export DUMMY
export NIX_KEEP_OUTPUTS=1
export NIX_KEEP_DERIVATIONS=1

cleanup() {
  rm -f "${JSON_OUTPUT:-}" "${BUILD_LOG:-}" "${TMP_EXPR:-}"
}

trap cleanup EXIT

write_node_modules_hash() {
  local value="$1"
  local system="${2:-$SYSTEM}"
  local temp
  temp=$(mktemp)
  
  if jq -e '.nodeModules | type == "object"' "$HASH_FILE" >/dev/null 2>&1; then
    jq --arg system "$system" --arg value "$value" '.nodeModules[$system] = $value' "$HASH_FILE" >"$temp"
  else
    jq --arg system "$system" --arg value "$value" '.nodeModules = {($system): $value}' "$HASH_FILE" >"$temp"
  fi
  
  mv "$temp" "$HASH_FILE"
}

TARGET="packages.${SYSTEM}.default"
MODULES_ATTR=".#packages.${SYSTEM}.default.node_modules"
CORRECT_HASH=""

DRV_PATH="$(nix eval --raw "${MODULES_ATTR}.drvPath")"

echo "Setting dummy node_modules outputHash for ${SYSTEM}..."
write_node_modules_hash "$DUMMY"

BUILD_LOG=$(mktemp)
JSON_OUTPUT=$(mktemp)

echo "Building node_modules for ${SYSTEM} to discover correct outputHash..."
echo "Attempting to realize derivation: ${DRV_PATH}"
REALISE_OUT=$(nix-store --realise "$DRV_PATH" --keep-failed 2>&1 | tee "$BUILD_LOG" || true)

BUILD_PATH=$(echo "$REALISE_OUT" | grep "^/nix/store/" | head -n1 || true)
if [ -n "$BUILD_PATH" ] && [ -d "$BUILD_PATH" ]; then
  echo "Realized node_modules output: $BUILD_PATH"
  CORRECT_HASH=$(nix hash path --sri "$BUILD_PATH" 2>/dev/null || true)
fi

if [ -z "$CORRECT_HASH" ]; then
  CORRECT_HASH="$(grep -E 'got:\s+sha256-[A-Za-z0-9+/=]+' "$BUILD_LOG" | awk '{print $2}' | head -n1 || true)"

  if [ -z "$CORRECT_HASH" ]; then
    CORRECT_HASH="$(grep -A2 'hash mismatch' "$BUILD_LOG" | grep 'got:' | awk '{print $2}' | sed 's/sha256:/sha256-/' || true)"
  fi

  if [ -z "$CORRECT_HASH" ]; then
    echo "Searching for kept failed build directory..."
    KEPT_DIR=$(grep -oE "build directory.*'[^']+'" "$BUILD_LOG" | grep -oE "'/[^']+'" | tr -d "'" | head -n1)

    if [ -z "$KEPT_DIR" ]; then
      KEPT_DIR=$(grep -oE '/nix/var/nix/builds/[^ ]+' "$BUILD_LOG" | head -n1)
    fi

    if [ -n "$KEPT_DIR" ] && [ -d "$KEPT_DIR" ]; then
      echo "Found kept build directory: $KEPT_DIR"
      if [ -d "$KEPT_DIR/build" ]; then
        HASH_PATH="$KEPT_DIR/build"
      else
        HASH_PATH="$KEPT_DIR"
      fi

      echo "Attempting to hash: $HASH_PATH"
      ls -la "$HASH_PATH" || true

      if [ -d "$HASH_PATH/node_modules" ]; then
        CORRECT_HASH=$(nix hash path --sri "$HASH_PATH" 2>/dev/null || true)
        echo "Computed hash from kept build: $CORRECT_HASH"
      fi
    fi
  fi
fi

if [ -z "$CORRECT_HASH" ]; then
  echo "Failed to determine correct node_modules hash for ${SYSTEM}."
  echo "Build log:"
  cat "$BUILD_LOG"
  exit 1
fi

write_node_modules_hash "$CORRECT_HASH"

jq -e --arg system "$SYSTEM" --arg hash "$CORRECT_HASH" '.nodeModules[$system] == $hash' "$HASH_FILE" >/dev/null

echo "node_modules hash updated for ${SYSTEM}: $CORRECT_HASH"

rm -f "$BUILD_LOG"
unset BUILD_LOG
