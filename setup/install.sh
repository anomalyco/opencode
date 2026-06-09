#!/usr/bin/env bash
# install Acompany SecureCode user-config templates into ~/.config/securecode/.
#
# What this does:
#   - copy securecode.json into ~/.config/securecode/    (preserves any existing one)
#   - copy tui.json into  ~/.config/securecode/         (preserves any existing one)
#   - copy themes/*.json into ~/.config/securecode/themes/ (preserves any existing one)
#   - seed ~/.local/state/securecode/kv.json with initial theme (only when missing)
#
# Branding (SecureCode wordmark / sidebar badge) is shipped inside the binary
# and does not need a separate plugin file. The bundled TUI theme that the
# initial kv.json seeds (`theme: "securecode"`) lives in `themes/` and is
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
  lsp_added=$(SECURECODE_CONF="$dest/securecode.json" node -e "
const fs = require('fs');
const p = process.env.SECURECODE_CONF;
try {
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (cfg.lsp !== undefined) { process.stdout.write('no'); process.exit(0); }
  cfg.lsp = { eslint: { disabled: true } };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  process.stdout.write('yes');
} catch (e) { process.stdout.write('no'); }
  " 2>/dev/null)
  if [ "$lsp_added" = "yes" ]; then
    echo "migrated: added lsp config (ESLint disabled) to $dest/securecode.json"
  fi
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

# 初期テーマを kv.json に書き込む (まだ存在しないときのみ)。
# /themes で切り替えた値もここに保存され、次回起動で読み込まれる。
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/securecode"
mkdir -p "$state_dir"
if [ ! -e "$state_dir/kv.json" ]; then
  printf '{"theme":"securecode"}\n' > "$state_dir/kv.json"
  echo "installed: $state_dir/kv.json (initial theme: securecode)"
else
  echo "skipped (already exists): $state_dir/kv.json"
fi
