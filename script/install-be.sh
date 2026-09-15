#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OpenCode installer with Belarusian (be) locale
#
# Builds the opencode CLI binary from source (embedding the Belarusian
# translation) and installs it to ~/.opencode/bin, adding it to PATH.
#
# Usage:
#   bash script/install-be.sh            # build from source + install
#   bash script/install-be.sh --skip-build  # install an already-built binary
# ---------------------------------------------------------------------------
set -euo pipefail

APP="opencode"
BIN_NAME="opencode"
INSTALL_DIR="${HOME}/.opencode/bin"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SKIP_BUILD=false
if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=true
fi

info()  { printf '\033[38;5;214m[be]\033[0m %s\n' "$1"; }
ok()    { printf '\033[32m[ok]\033[0m %s\n' "$1"; }
err()   { printf '\033[31m[err]\033[0m %s\n' "$1" >&2; }

# 1. Ensure bun is available (the repo is built with bun).
command -v bun >/dev/null 2>&1 || {
  err "bun is required to build opencode. Install it first: https://bun.sh"
  exit 1
}

# 2. Verify the Belarusian locale files exist in the source tree.
for f in \
  "packages/app/src/i18n/be.ts" \
  "packages/ui/src/i18n/be.ts" \
  "packages/desktop/src/renderer/i18n/be.ts"; do
  if [[ ! -f "${REPO_DIR}/${f}" ]]; then
    err "Missing Belarusian locale: ${f}. Run script/be-locale-gen.py first."
    exit 1
  fi
done
ok "Belarusian locale files present."

# 3. Build the binary (unless asked to skip).
if [[ "${SKIP_BUILD}" == "false" ]]; then
  info "Installing dependencies (bun install)…"
  (cd "${REPO_DIR}" && bun install)
  info "Building opencode CLI binary…"
  (cd "${REPO_DIR}/packages/opencode" && bun run script/build.ts)
  ok "Build complete."
else
  info "Skipping build (--skip-build)."
fi

# 4. Locate the freshly built binary.
BUILT_BIN="${REPO_DIR}/packages/opencode/bin/${BIN_NAME}"
if [[ ! -f "${BUILT_BIN}" ]]; then
  # fallback: search for any opencode executable in bin
  BUILT_BIN="$(find "${REPO_DIR}/packages/opencode" -maxdepth 3 -name "${BIN_NAME}" -type f 2>/dev/null | head -n1 || true)"
fi
if [[ -z "${BUILT_BIN}" || ! -f "${BUILT_BIN}" ]]; then
  err "Could not find the built binary. Run the build step first."
  exit 1
fi

# 5. Install.
mkdir -p "${INSTALL_DIR}"
cp "${BUILT_BIN}" "${INSTALL_DIR}/${BIN_NAME}"
chmod +x "${INSTALL_DIR}/${BIN_NAME}"
ok "Installed ${APP} to ${INSTALL_DIR}/${BIN_NAME}"

# 6. Add to PATH for the current shell profile.
if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
  profile="${HOME}/.bashrc"
  [[ -f "${HOME}/.zshrc" ]] && profile="${HOME}/.zshrc"
  if ! grep -qF "export PATH=\"${INSTALL_DIR}:\$PATH\"" "${profile}" 2>/dev/null; then
    printf '\n# added by opencode-be installer\nexport PATH="%s:$PATH"\n' "${INSTALL_DIR}" >> "${profile}"
    ok "Added ${INSTALL_DIR} to PATH in ${profile}"
  fi
fi

# 7. Verify Belarusian is bundled.
if "${INSTALL_DIR}/${BIN_NAME}" --version >/dev/null 2>&1; then
  ok "Installed version: $("${INSTALL_DIR}/${BIN_NAME}" --version 2>/dev/null || echo 'unknown')"
fi
info "Done. Open a new terminal and run 'opencode' to start coding."
