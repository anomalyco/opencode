#!/usr/bin/env bash
# ============================================================================
#  VantaCode Unix installer (idempotent) — macOS / Linux
#  - Installs Bun if missing
#  - Installs JS dependencies + builds the CLI
#  - Links `vantacode` into ~/.vantacode/bin and onto your PATH
#  - Verifies with `command -v vantacode`
#
#  Safe to re-run.
# ============================================================================
set -euo pipefail

echo
echo "=== VantaCode installer ==="
echo

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 1. Ensure Bun -----------------------------------------------------------
if command -v bun >/dev/null 2>&1; then
  echo "[ok] Bun already installed ($(bun --version))."
else
  echo "[..] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# --- 2. Dependencies ---------------------------------------------------------
echo "[..] Installing dependencies (bun install)..."
( cd "$REPO_ROOT" && bun install )

# --- 3. Build ----------------------------------------------------------------
echo "[..] Building the CLI..."
( cd "$REPO_ROOT/packages/opencode" && bun run build )

# --- 4. Launcher shim --------------------------------------------------------
BIN_DIR="$HOME/.vantacode/bin"
mkdir -p "$BIN_DIR"
LAUNCHER="$REPO_ROOT/packages/opencode/bin/vantacode"
SHIM="$BIN_DIR/vantacode"

cat > "$SHIM" <<EOF
#!/usr/bin/env bash
export VANTACODE_BRAND=vantacode
exec node "$LAUNCHER" "\$@"
EOF
chmod +x "$SHIM"
echo "[ok] Wrote launcher shim: $SHIM"

# --- 5. PATH (idempotent) ----------------------------------------------------
add_path_line='export PATH="$HOME/.vantacode/bin:$PATH"'
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -e "$rc" ] || continue
  if grep -qF ".vantacode/bin" "$rc"; then
    echo "[ok] PATH already configured in $(basename "$rc")."
  else
    printf '\n# Added by VantaCode installer\n%s\n' "$add_path_line" >> "$rc"
    echo "[ok] Added ~/.vantacode/bin to PATH in $(basename "$rc")."
  fi
done
export PATH="$BIN_DIR:$PATH"

# --- 6. Verify ---------------------------------------------------------------
echo
if command -v vantacode >/dev/null 2>&1; then
  echo "[ok] vantacode is on PATH: $(command -v vantacode)"
else
  echo "[ok] Installed to $SHIM"
  echo "[!!] Open a new terminal (or 'source' your shell rc) so PATH takes effect."
fi

echo
echo "=== Done. Try:  vantacode vantacode doctor ==="
