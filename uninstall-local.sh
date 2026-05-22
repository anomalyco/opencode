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

# ── Parse flags ─────────────────────────────────────────────────────────────
DRY_RUN=false
KEEP_CONFIG=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)     DRY_RUN=true ;;
    --keep-config) KEEP_CONFIG=true ;;
    --force)       FORCE=true ;;
    -h|--help)
      echo "Usage: $(basename "$0") [OPTIONS]"
      echo ""
      echo "Remove the locally-built opencode binary and clean up."
      echo ""
      echo "Options:"
      echo "  --dry-run       Show what would be removed without removing it"
      echo "  --keep-config   Keep \$HOME/.opencode/ directory (data, config, state)"
      echo "  --force         Skip confirmation prompt"
      echo "  -h, --help      Show this help message"
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      exit 1
      ;;
  esac
done

INSTALL_DIR="$HOME/.opencode/bin"
BINARY="$INSTALL_DIR/opencode"
CONFIG_DIR="$HOME/.opencode"

PATH_COMMENT="# opencode"

# ── Dry-run mode ────────────────────────────────────────────────────────────
if $DRY_RUN; then
  echo -e "${YELLOW}[DRY RUN]${NC} The following would be removed:"
  echo ""

  if [ -f "$BINARY" ]; then
    echo "  Binary:  $BINARY"
  else
    echo "  Binary:  (not found)"
  fi

  if [ -d "$CONFIG_DIR" ] && ! $KEEP_CONFIG; then
    echo "  Config:  $CONFIG_DIR"
  elif $KEEP_CONFIG && [ -d "$CONFIG_DIR" ]; then
    echo "  Config:  (skipped — --keep-config)"
  fi

  # Check shell configs for PATH entries
  SHELL_CONFIGS=(
    "$HOME/.zshrc"
    "$HOME/.bashrc"
    "$HOME/.bash_profile"
    "$HOME/.profile"
    "$HOME/.config/fish/config.fish"
  )

  for cfg in "${SHELL_CONFIGS[@]}"; do
    if [ -f "$cfg" ] && grep -qF "$PATH_COMMENT" "$cfg" 2>/dev/null; then
      echo "  PATH:    lines in $cfg"
    fi
  done

  echo ""
  info "Dry run complete. No changes were made."
  exit 0
fi

# ── Confirmation ────────────────────────────────────────────────────────────
if ! $FORCE; then
  echo -n "Remove locally-built opencode? [y/N] "
  read -r response
  case "$response" in
    [yY][eE][sS]|[yY]) ;;
    *) info "Aborted."; exit 0 ;;
  esac
fi

# ── Remove binary ───────────────────────────────────────────────────────────
if [ -f "$BINARY" ]; then
  rm -f "$BINARY"
  info "Removed binary: $BINARY"
else
  warn "Binary not found: $BINARY"
fi

# ── Remove bin directory if empty ───────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  if [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    rmdir "$INSTALL_DIR"
    info "Removed empty directory: $INSTALL_DIR"
  fi
fi

# ── Remove config directory ─────────────────────────────────────────────────
if ! $KEEP_CONFIG && [ -d "$CONFIG_DIR" ]; then
  rm -rf "$CONFIG_DIR"
  info "Removed config directory: $CONFIG_DIR"
elif $KEEP_CONFIG && [ -d "$CONFIG_DIR" ]; then
  warn "Keeping config directory: $CONFIG_DIR"
fi

# ── Remove PATH lines from shell configs ────────────────────────────────────
SHELL_CONFIGS=(
  "$HOME/.zshrc"
  "$HOME/.bashrc"
  "$HOME/.bash_profile"
  "$HOME/.profile"
  "$HOME/.config/fish/config.fish"
)

for cfg in "${SHELL_CONFIGS[@]}"; do
  if [ -f "$cfg" ] && grep -qF "$PATH_COMMENT" "$cfg" 2>/dev/null; then
    # Remove the comment line and the following PATH line
    # Use sed to delete the comment line and any line containing the install dir
    sed -i '' "/${PATH_COMMENT}/d" "$cfg"
    sed -i '' "\|${INSTALL_DIR}|d" "$cfg"
    info "Removed PATH entries from: $cfg"
  fi
done

info "Uninstall complete."
