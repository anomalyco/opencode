#!/usr/bin/env bash
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; }

# ── Detect OS and arch ──────────────────────────────────────────────────────
OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "$OS_RAW" in
  Darwin*)  OS="darwin" ;;
  Linux*)   OS="linux"  ;;
  *)        error "Unsupported OS: $OS_RAW"; exit 1 ;;
esac

case "$ARCH_RAW" in
  arm64|aarch64)  ARCH="arm64" ;;
  x86_64)         ARCH="x64"   ;;
  *)              error "Unsupported architecture: $ARCH_RAW"; exit 1 ;;
esac

TARGET="${OS}-${ARCH}"
info "Detected platform: ${TARGET}"

# ── Check for bun ────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  error "bun is required but not installed. Install it from https://bun.sh"
  exit 1
fi
info "Found bun: $(command -v bun) ($(bun --version))"

# ── Resolve repo root ───────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"
info "Repo root: ${REPO_ROOT}"

# ── Install dependencies ────────────────────────────────────────────────────
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
  warn "Installing dependencies…"
  bun install
else
  info "node_modules already present, skipping install"
fi

# ── Build ────────────────────────────────────────────────────────────────────
info "Building opencode for ${TARGET}…"
bun run packages/opencode/script/build.ts --single

# ── Verify build output ─────────────────────────────────────────────────────
DIST_DIR="packages/opencode/dist/opencode-${TARGET}/bin"
BINARY="${DIST_DIR}/opencode"

if [ ! -f "$BINARY" ]; then
  error "Build output not found at ${BINARY}"
  exit 1
fi

# ── Install ─────────────────────────────────────────────────────────────────
INSTALL_DIR="$HOME/.opencode/bin"
mkdir -p "$INSTALL_DIR"

cp "$BINARY" "$INSTALL_DIR/opencode"
chmod 755 "$INSTALL_DIR/opencode"

info "Installed binary to ${INSTALL_DIR}/opencode"

# ── Add PATH to shell config ────────────────────────────────────────────────
PATH_LINE="export PATH=\"${INSTALL_DIR}:\$PATH\""
PATH_COMMENT="# opencode"

# Detect shell config file
SHELL_NAME="$(basename "$SHELL")"
case "$SHELL_NAME" in
  zsh)    CONFIG_FILE="$HOME/.zshrc" ;;
  bash)
    if [ -f "$HOME/.bashrc" ]; then
      CONFIG_FILE="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
      CONFIG_FILE="$HOME/.bash_profile"
    else
      CONFIG_FILE="$HOME/.bashrc"
    fi
    ;;
  fish)   CONFIG_FILE="$HOME/.config/fish/config.fish"
          PATH_LINE="fish_add_path \"${INSTALL_DIR}\""
          PATH_COMMENT="# opencode"
          ;;
  *)
    warn "Unknown shell: ${SHELL_NAME}, defaulting to ~/.bashrc"
    CONFIG_FILE="$HOME/.bashrc"
    ;;
esac

# Ensure config file exists
touch "$CONFIG_FILE"

# Check if PATH entry already exists
if grep -qF "$INSTALL_DIR" "$CONFIG_FILE" 2>/dev/null; then
  warn "PATH entry for ${INSTALL_DIR} already exists in ${CONFIG_FILE}"
else
  echo "" >> "$CONFIG_FILE"
  echo "$PATH_COMMENT" >> "$CONFIG_FILE"
  echo "$PATH_LINE" >> "$CONFIG_FILE"
  info "Added PATH entry to ${CONFIG_FILE}"
fi

# ── Print version ────────────────────────────────────────────────────────────
VERSION="$("$INSTALL_DIR/opencode" --version 2>/dev/null || echo "unknown")"
info "opencode ${VERSION} installed at ${INSTALL_DIR}/opencode"
info "Run 'opencode' or restart your shell to use it."
