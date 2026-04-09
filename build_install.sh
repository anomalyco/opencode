#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"
WRAPPER="$INSTALL_DIR/opencode"

echo "==> Installing dependencies..."
cd "$REPO_DIR"
bun install

echo "==> Creating install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo "==> Writing wrapper script: $WRAPPER"
cat > "$WRAPPER" <<EOF
#!/bin/bash
export OPENCODE_CWD="\$PWD"
exec bun run --cwd "$REPO_DIR/packages/opencode" --conditions=browser src/index.ts "\$@"
EOF
chmod +x "$WRAPPER"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "WARNING: $INSTALL_DIR is not in your PATH."
  echo "Add this to your ~/.zshrc:"
  echo ""
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

echo "==> Done! Run 'opencode' to start."
