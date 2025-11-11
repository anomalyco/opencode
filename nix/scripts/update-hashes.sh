#!/usr/bin/env bash

set -euo pipefail

DUMMY="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
DEFAULT_HASH_FILE=${MODULES_HASH_FILE:-nix/hashes.json}
HASH_FILE=${HASH_FILE:-$DEFAULT_HASH_FILE}
OPTIONAL_PACKAGES_DIR=${OPTIONAL_PACKAGES_DIR:-nix/optional-packages}
OPTIONAL_FILE=${OPTIONAL_PACKAGES_FILE:-}
OPTIONAL_AGGREGATE=""

if [ -z "$OPTIONAL_FILE" ] && [ -d "$OPTIONAL_PACKAGES_DIR" ]; then
  OPTIONAL_AGGREGATE=$(mktemp)
  find "$OPTIONAL_PACKAGES_DIR" -maxdepth 1 -type f -name '*.txt' | sort | while read -r file; do
    [ -n "$file" ] || continue
    cat "$file"
    echo
  done | sed 's/#.*$//' | sed '/^[[:space:]]*$/d' | sort -u >"$OPTIONAL_AGGREGATE"
  OPTIONAL_FILE="$OPTIONAL_AGGREGATE"
fi

if [ -z "$OPTIONAL_FILE" ]; then
  OPTIONAL_FILE="nix/optional-packages.txt"
fi

if [ ! -f "$HASH_FILE" ]; then
  cat <<'EOF' >"$HASH_FILE"
{
  "nodeModules": {},
  "optional": {}
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

if [ -z "${SYSTEMS:-}" ]; then
  SYSTEMS="$(nix eval --json .#packages | jq -r 'keys[]')"
fi

if [ -z "$SYSTEMS" ]; then
  echo "No target systems detected for hash update"
  exit 1
fi

cleanup() {
  if [ -n "${JSON_OUTPUT:-}" ] && [ -f "$JSON_OUTPUT" ]; then
    rm -f "$JSON_OUTPUT"
  fi
  if [ -n "${BUILD_LOG:-}" ] && [ -f "$BUILD_LOG" ]; then
    rm -f "$BUILD_LOG"
  fi
  if [ -n "${TMP_EXPR:-}" ] && [ -f "$TMP_EXPR" ]; then
    rm -f "$TMP_EXPR"
  fi
  if [ -n "$OPTIONAL_AGGREGATE" ] && [ -f "$OPTIONAL_AGGREGATE" ]; then
    rm -f "$OPTIONAL_AGGREGATE"
  fi
}

trap cleanup EXIT

update_optional() {
  if [ ! -f "$OPTIONAL_FILE" ]; then
    echo "optional package list missing at $OPTIONAL_FILE" >&2
    return 1
  fi
  local meta tmp name ver sha
  if command -v bun >/dev/null 2>&1; then
    meta="$(bun --bun nix/scripts/optional-metadata.ts "$OPTIONAL_FILE")" || return 1
  fi
  if [ -z "${meta:-}" ] && command -v nix >/dev/null 2>&1; then
    meta="$(nix shell --quiet nixpkgs#bun -c bun --bun nix/scripts/optional-metadata.ts "$OPTIONAL_FILE")" || return 1
  fi
  if [ -z "${meta:-}" ]; then
    echo "bun unavailable; skipping optional metadata refresh" >&2
    return 0
  fi
  while IFS=$'\t' read -r name ver sha; do
    [ -n "$name" ] || continue
    tmp=$(mktemp)
    jq \
      --arg name "$name" \
      --arg ver "$ver" \
      --arg sha "$sha" \
      '.optional[$name] = { version: $ver, sha512: $sha }' \
      "$HASH_FILE" >"$tmp"
    mv "$tmp" "$HASH_FILE"
  done <<EOF
$meta
EOF
}

update_optional

write_node_modules_hash() {
  local value="$1"
  local temp
  temp=$(mktemp)
  jq --arg system "$SYSTEM" --arg value "$value" '.nodeModules[$system] = $value' "$HASH_FILE" >"$temp"
  mv "$temp" "$HASH_FILE"
}

for SYSTEM in $SYSTEMS; do
  TARGET="packages.${SYSTEM}.default"
  MODULES_ATTR=".#packages.${SYSTEM}.default.node_modules"
  CORRECT_HASH=""

  echo "Removing cached node_modules output for ${SYSTEM} (if present)..."
  PREV_PATH="$(nix path-info "$MODULES_ATTR" --system "$SYSTEM" 2>/dev/null || true)"
  if [ -n "$PREV_PATH" ]; then
    nix store delete --ignore-liveness "$PREV_PATH" >/dev/null 2>&1 || true
  fi

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
    echo "Failed to extract node_modules hash for ${SYSTEM}"
    echo "Build log (last 100 lines):"
    tail -100 "$BUILD_LOG" || true
    exit 1
  fi

  write_node_modules_hash "$CORRECT_HASH"

  if ! jq -e --arg system "$SYSTEM" --arg hash "$CORRECT_HASH" '.nodeModules[$system] == $hash' "$HASH_FILE" >/dev/null; then
    echo "Failed to persist node_modules hash for ${SYSTEM}"
    exit 1
  fi

  echo "node_modules hash updated for ${SYSTEM}: $CORRECT_HASH"

  rm -f "$BUILD_LOG"
  unset BUILD_LOG
done