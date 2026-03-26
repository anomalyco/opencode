#!/usr/bin/env bash
set -euo pipefail

REPO="CobuilderLabs/opencode"
BIN_NAME="cobuilder"
INSTALL_DIR="${COBUILDER_INSTALL_DIR:-$HOME/.local/bin}"

# ── Colors ────────────────────────────────────────────────────────────────────
bold="\033[1m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
reset="\033[0m"

info()    { echo -e "  ${bold}${green}✔${reset}  $*"; }
warn()    { echo -e "  ${yellow}!${reset}  $*"; }
error()   { echo -e "  ${bold}${red}✘${reset}  $*" >&2; exit 1; }
step()    { echo -e "\n${bold}$*${reset}"; }

echo ""
echo -e "${bold}  CoBuilder Installer${reset}"
echo "  ─────────────────────────────────────"

# ── Detect platform ──────────────────────────────────────────────────────────
step "Detecting platform…"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)   PLATFORM="linux" ;;
  Darwin*)  PLATFORM="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) error "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) error "Unsupported architecture: $ARCH" ;;
esac

info "Platform: ${PLATFORM}-${ARCH}"

# ── Check for bun (needed only if installing from source fallback) ─────────
# Primary path: download pre-built binary — no bun required at runtime
# bun is only needed as a dev tool for contributors

# ── Build asset name ─────────────────────────────────────────────────────────
# Asset naming: cobuilder-<platform>-<arch>.tar.gz (linux) or .zip (others)
PKG_NAME="cobuilder-${PLATFORM}-${ARCH}"

if [[ "$PLATFORM" == "linux" ]]; then
  # Detect musl
  if ldd --version 2>&1 | grep -qi musl || [[ -f /etc/alpine-release ]]; then
    PKG_NAME="cobuilder-${PLATFORM}-${ARCH}-musl"
  fi
  ASSET="${PKG_NAME}.tar.gz"
else
  ASSET="${PKG_NAME}.zip"
fi

# ── Fetch latest release that has the expected asset ─────────────────────────
# Use the GitHub API to inspect each release's asset list directly — HTTP
# probing is unreliable because GitHub uses varying redirect codes.
# Walk up to 10 recent non-draft releases until one has the expected asset.
step "Fetching latest release…"

RELEASES_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=10")

if [[ -z "$RELEASES_JSON" ]]; then
  error "Could not fetch releases. Check your internet connection."
fi

LATEST=""
DOWNLOAD_URL=""

# Extract tag names in order (newest first)
TAGS=$(echo "$RELEASES_JSON" | grep '"tag_name"' | sed 's/.*"tag_name": *"\(.*\)".*/\1/')

for TAG in $TAGS; do
  # Query the specific release and look for our asset in browser_download_url entries
  RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${TAG}" 2>/dev/null)
  # Skip drafts
  IS_DRAFT=$(echo "$RELEASE_JSON" | grep '"draft"' | head -1 | grep -o 'true' || true)
  [[ "$IS_DRAFT" == "true" ]] && continue
  # Check if the expected asset is listed
  URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' \
    | sed 's/.*"browser_download_url": *"\(.*\)".*/\1/' \
    | grep "/${ASSET}$" | head -1)
  if [[ -n "$URL" ]]; then
    LATEST="$TAG"
    DOWNLOAD_URL="$URL"
    break
  fi
done

if [[ -z "$LATEST" ]]; then
  error "No release found with asset ${ASSET}. Try again in a few minutes while the build completes."
fi

info "Latest release: ${LATEST}"

# ── Download ─────────────────────────────────────────────────────────────────
step "Downloading ${ASSET}…"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "${TMP_DIR}/${ASSET}"; then
  error "Download failed. Asset may not exist for your platform yet.\nURL: ${DOWNLOAD_URL}"
fi

info "Downloaded ${ASSET}"

# ── Extract ──────────────────────────────────────────────────────────────────
step "Extracting…"

if [[ "$ASSET" == *.tar.gz ]]; then
  tar -xzf "${TMP_DIR}/${ASSET}" -C "$TMP_DIR"
else
  unzip -q "${TMP_DIR}/${ASSET}" -d "$TMP_DIR"
fi

BINARY=$(find "$TMP_DIR" -name "$BIN_NAME" -o -name "${BIN_NAME}.exe" | head -1)
[[ -z "$BINARY" ]] && error "Could not find cobuilder binary in archive"

# ── Install ──────────────────────────────────────────────────────────────────
step "Installing to ${INSTALL_DIR}…"

mkdir -p "$INSTALL_DIR"
cp "$BINARY" "${INSTALL_DIR}/${BIN_NAME}"
chmod +x "${INSTALL_DIR}/${BIN_NAME}"

info "Installed to ${INSTALL_DIR}/${BIN_NAME}"

# ── PATH check ───────────────────────────────────────────────────────────────
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  warn "${INSTALL_DIR} is not in your PATH."
  echo ""
  echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
  echo -e "  ${bold}export PATH=\"\$HOME/.local/bin:\$PATH\"${reset}"
  echo ""
  warn "Running via full path for now…"
  COBUILDER_BIN="${INSTALL_DIR}/${BIN_NAME}"
else
  COBUILDER_BIN="${BIN_NAME}"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${bold}${green}CoBuilder installed successfully!${reset}"
echo ""

# ── Onboard ──────────────────────────────────────────────────────────────────
# When piped via `curl | bash`, stdin is not a TTY — re-attach to /dev/tty
# so interactive prompts (arrow keys etc.) work seamlessly.
if [ -t 0 ]; then
  "$COBUILDER_BIN" onboard
elif [ -e /dev/tty ]; then
  "$COBUILDER_BIN" onboard </dev/tty
else
  echo ""
  echo -e "  ${bold}Run this to complete setup:${reset}"
  echo -e "  ${bold}${green}cobuilder onboard${reset}"
  echo ""
fi
