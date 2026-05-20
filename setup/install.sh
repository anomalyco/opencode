#!/usr/bin/env bash
# install Acompany SecureCode user-config templates into ~/.config/securecode/.
#
# What this does:
#   - copy securecode.json into ~/.config/securecode/    (preserves any existing one)
#   - copy tui.json into  ~/.config/securecode/         (preserves any existing one)
#   - copy themes/*.json into ~/.config/securecode/themes/ (preserves any existing one)
#
# Branding (SecureCode wordmark / sidebar badge) is shipped inside the binary
# and does not need a separate plugin file. The bundled TUI theme that
# tui.json.example selects (`theme: "securecode"`) lives in `themes/` and is
# copied alongside.
#
# After install, set SECURECODE_QWEN3_API_KEY in your shell environment to the
# Qwen3.6-35B-A3B-FP8 API key your Acompany contact issued for you, then run:
#
#   securecode run "Hello"
#
# Re-running this script is safe: existing config files are kept.

set -eu

src="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
dest="${XDG_CONFIG_HOME:-$HOME/.config}/securecode"

mkdir -p "$dest"

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
  echo "  1. export SECURECODE_QWEN3_API_KEY=<your Qwen3.6 API key from Acompany>"
  echo "  2. securecode run \"Hello\""
else
  echo "skipped (already exists): $dest/securecode.json"
fi

mkdir -p "$dest/themes"
for theme in "$src/themes"/*.json; do
  [ -e "$theme" ] || continue
  name=$(basename "$theme")
  if [ ! -e "$dest/themes/$name" ]; then
    cp "$theme" "$dest/themes/$name"
    echo "installed: $dest/themes/$name"
  else
    echo "skipped (already exists): $dest/themes/$name"
  fi
done
