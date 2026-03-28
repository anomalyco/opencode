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
# Asset naming: opencode-<platform>-<arch>.tar.gz (linux) or .zip (others)
PKG_NAME="opencode-${PLATFORM}-${ARCH}"

if [[ "$PLATFORM" == "linux" ]]; then
  # Detect musl
  if ldd --version 2>&1 | grep -qi musl || [[ -f /etc/alpine-release ]]; then
    PKG_NAME="opencode-${PLATFORM}-${ARCH}-musl"
  fi
  ASSET="${PKG_NAME}.tar.gz"
else
  ASSET="${PKG_NAME}.zip"
fi

# ── Fetch latest release that contains the CLI asset ─────────────────────────
step "Fetching latest release…"

LATEST=""
DOWNLOAD_URL=""
PAGE=1
while [[ -z "$LATEST" && $PAGE -le 3 ]]; do
  RELEASES=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=10&page=${PAGE}")
  while IFS= read -r line; do
    TAG=$(echo "$line" | grep '"tag_name"' | sed 's/.*"tag_name": *"\(.*\)".*/\1/')
    [[ -z "$TAG" ]] && continue
    URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
    if curl -fsSL --head "$URL" -o /dev/null 2>/dev/null; then
      LATEST="$TAG"
      DOWNLOAD_URL="$URL"
      break
    fi
  done < <(echo "$RELEASES" | grep '"tag_name"')
  PAGE=$((PAGE + 1))
done

if [[ -z "$LATEST" ]]; then
  error "Could not find a release with asset '${ASSET}'. Check your internet connection or try again later."
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
"$COBUILDER_BIN" onboard
