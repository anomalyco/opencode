#!/usr/bin/env bash
# install Acompany SecureCode user-config files into ~/.config/securecode/.
#
# What this does:
#   - copy acompany-branding.tsx into ~/.config/securecode/plugins/
#   - copy tui.json into  ~/.config/securecode/         (preserves any existing one)
#   - copy securecode.json into ~/.config/securecode/    (preserves any existing one)
#
# After install, set OPENAI_API_KEY in your shell environment to the LiteLLM
# API key your Acompany contact issued for you, then run:
#
#   SecureCode run "Hello"
#
# Re-running this script is safe: existing files are kept and only the plugin
# is refreshed.

set -eu

src="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
dest="${XDG_CONFIG_HOME:-$HOME/.config}/securecode"

mkdir -p "$dest/plugins"

cp "$src/acompany-branding.tsx" "$dest/plugins/acompany-branding.tsx"
echo "installed: $dest/plugins/acompany-branding.tsx"

if [ ! -e "$dest/tui.json" ]; then
  cp "$src/tui.json.example" "$dest/tui.json"
  echo "installed: $dest/tui.json"
else
  echo "skipped (already exists): $dest/tui.json"
fi

if [ ! -e "$dest/securecode.json" ]; then
  cp "$src/securecode.json.example" "$dest/securecode.json"
  echo "installed: $dest/securecode.json"
  echo
  echo "Next steps:"
  echo "  1. export OPENAI_API_KEY=<your LiteLLM API key from Acompany>"
  echo "  2. SecureCode run \"Hello\""
else
  echo "skipped (already exists): $dest/securecode.json"
fi
