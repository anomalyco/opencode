#!/usr/bin/env bash
set -euo pipefail

# pencode Korean IME Fix Installer
# https://github.com/kiyosh11/pencode/issues/14371
#
# Patches pencode to prevent Korean (and other CJK) IME last character
# truncation when pressing Enter in Kitty and other terminals.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/claudianus/pencode/fix-zhipuai-coding-plan-thinking/patches/install-korean-ime-fix.sh | bash
#   # or from a cloned repo:
#   ./patches/install-korean-ime-fix.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
ORANGE='\033[38;5;214m'
MUTED='\033[0;2m'
NC='\033[0m'

PENCODE_DIR="${PENCODE_DIR:-$HOME/.pencode}"
PENCODE_SRC="${PENCODE_SRC:-$HOME/.pencode-src}"
FORK_REPO="${FORK_REPO:-https://github.com/claudianus/pencode.git}"
FORK_BRANCH="${FORK_BRANCH:-fix-zhipuai-coding-plan-thinking}"

info()  { echo -e "${MUTED}$*${NC}"; }
warn()  { echo -e "${ORANGE}$*${NC}"; }
err()   { echo -e "${RED}$*${NC}" >&2; }
ok()    { echo -e "${GREEN}$*${NC}"; }

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Error: $1 is required but not installed."
    exit 1
  fi
}

need git
need bun

# ── 1. Clone or update fork ────────────────────────────────────────────
if [ -d "$PENCODE_SRC/.git" ]; then
  info "Updating existing source at $PENCODE_SRC ..."
  git -C "$PENCODE_SRC" fetch origin "$FORK_BRANCH"
  git -C "$PENCODE_SRC" checkout "$FORK_BRANCH"
  git -C "$PENCODE_SRC" reset --hard "origin/$FORK_BRANCH"
else
  info "Cloning fork (shallow) to $PENCODE_SRC ..."
  git clone --depth 1 --branch "$FORK_BRANCH" "$FORK_REPO" "$PENCODE_SRC"
fi

# ── 2. Verify the IME fix is present in source ────────────────────────
PROMPT_FILE="$PENCODE_SRC/packages/pencode/src/cli/cmd/tui/component/prompt/index.tsx"
if [ ! -f "$PROMPT_FILE" ]; then
  err "Prompt file not found: $PROMPT_FILE"
  exit 1
fi

if grep -q "setTimeout(() => setTimeout" "$PROMPT_FILE"; then
  ok "IME fix already present in source."
else
  warn "IME fix not found. Applying patch ..."
  # Apply the fix: replace onSubmit={submit} with double-deferred version
  sed -i 's|onSubmit={submit}|onSubmit={() => {\n                // IME: double-defer so the last composed character (e.g. Korean\n                // hangul) is flushed to plainText before we read it for submission.\n                setTimeout(() => setTimeout(() => submit(), 0), 0)\n              }}|' "$PROMPT_FILE"
  if grep -q "setTimeout(() => setTimeout" "$PROMPT_FILE"; then
    ok "Patch applied."
  else
    err "Failed to apply patch. The source may have changed."
    exit 1
  fi
fi

# ── 3. Install dependencies ────────────────────────────────────────────
info "Installing dependencies (this may take a minute) ..."
cd "$PENCODE_SRC"
bun install --frozen-lockfile 2>/dev/null || bun install

# ── 4. Build (current platform only) ──────────────────────────────────
info "Building pencode for current platform ..."
cd "$PENCODE_SRC/packages/pencode"
bun run build --single

# ── 5. Install binary ──────────────────────────────────────────────────
mkdir -p "$PENCODE_DIR/bin"

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
[ "$ARCH" = "aarch64" ] && ARCH="arm64"
[ "$ARCH" = "x86_64" ] && ARCH="x64"
[ "$PLATFORM" = "darwin" ] && true
[ "$PLATFORM" = "linux" ] && true

BUILT_BINARY="$PENCODE_SRC/packages/pencode/dist/pencode-${PLATFORM}-${ARCH}/bin/pencode"

if [ ! -f "$BUILT_BINARY" ]; then
  BUILT_BINARY=$(find "$PENCODE_SRC/packages/pencode/dist" -name "pencode" -type f -executable 2>/dev/null | head -1)
fi

if [ -f "$BUILT_BINARY" ]; then
  if [ -f "$PENCODE_DIR/bin/pencode" ]; then
    cp "$PENCODE_DIR/bin/pencode" "$PENCODE_DIR/bin/pencode.bak.$(date +%Y%m%d%H%M%S)"
  fi
  cp "$BUILT_BINARY" "$PENCODE_DIR/bin/pencode"
  chmod +x "$PENCODE_DIR/bin/pencode"
  ok "Installed to $PENCODE_DIR/bin/pencode"
else
  err "Build failed - binary not found in dist/"
  info "Try running manually:"
  echo "  cd $PENCODE_SRC/packages/pencode && bun run build --single"
  exit 1
fi

echo ""
ok "Done! Korean IME fix is now active."
echo ""
info "To uninstall and revert to the official release:"
echo "  curl -fsSL https://pencode.ai/install | bash"
echo ""
info "To update (re-pull and rebuild):"
echo "  $0"
