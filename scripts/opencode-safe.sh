#!/usr/bin/env bash
# Launch OpenCode Flatpak without watching all of $HOME (client-side workaround).
set -euo pipefail

REAL_HOME=$(cd "${HOME:?}" && pwd)
PROJECT_DIR="${OPENCODE_PROJECT:-$REAL_HOME}"
mkdir -p "$PROJECT_DIR"
PROJECT=$(cd "$PROJECT_DIR" && pwd)
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$REAL_HOME/.local/share/opencode-cfg}"
DESKTOP_STATE="$REAL_HOME/.var/app/ai.opencode.opencode/data/ai.opencode.desktop"
FLATPAK_APP="${OPENCODE_FLATPAK_APP:-ai.opencode.opencode}"

if [[ "$PROJECT" == "$REAL_HOME" || "$PROJECT" == "/" ]]; then
  echo "Set OPENCODE_PROJECT to a repository path, not \$HOME or /." >&2
  exit 1
fi

pkill -9 -f 'opencode-cli|OpenCode' 2>/dev/null || true

mkdir -p "$PROJECT/.local/bin"
if [[ -L "$PROJECT/.local" ]]; then
  rm "$PROJECT/.local"
  mkdir -p "$PROJECT/.local/bin"
fi
cat > "$PROJECT/.local/bin/opencode-cli" <<'EOF'
#!/usr/bin/env bash
if [[ -x /app/bin/opencode-cli ]]; then
  exec /app/bin/opencode-cli "$@"
fi
if command -v flatpak >/dev/null 2>&1; then
  exec flatpak run --command=opencode-cli ai.opencode.opencode "$@"
fi
exit 127
EOF
chmod +x "$PROJECT/.local/bin/opencode-cli"
ln -sfn "$REAL_HOME/.var" "$PROJECT/.var"

rm -f \
  "$DESKTOP_STATE"/opencode.workspace.-home-*.dat \
  "$DESKTOP_STATE"/opencode.workspace.L2hvbWUvanVz.*.dat \
  "$DESKTOP_STATE"/opencode.workspace.-.bo0mse.dat 2>/dev/null || true

python3 - "$DESKTOP_STATE/opencode.global.dat" "$PROJECT" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
project = sys.argv[2]
if not path.exists():
    raise SystemExit(0)

data = json.loads(path.read_text())
bad = {"/", str(pathlib.Path.home())}

server = json.loads(data.get("server", "{}"))
server["list"] = []
projects = [p for p in server.get("projects", {}).get("local", []) if p.get("worktree") not in bad]
if not any(p.get("worktree") == project for p in projects):
    projects = [{"worktree": project, "expanded": True}]
server["projects"] = {"local": projects}
server["lastProject"] = {"local": project}
data["server"] = json.dumps(server)

layout = json.loads(data.get("layout", "{}"))
sidebar = layout.get("sidebar", {})
workspaces = {k: v for k, v in sidebar.get("workspaces", {}).items() if k not in bad}
workspaces.setdefault(project, False)
sidebar["workspaces"] = workspaces
sidebar["workspacesDefault"] = False
layout["sidebar"] = sidebar
data["layout"] = json.dumps(layout)

page = json.loads(data.get("layout.page", "{}"))
page["workspaceOrder"] = {}
page["workspaceName"] = {}
page["workspaceBranchName"] = {}
page["workspaceExpanded"] = {}
data["layout.page"] = json.dumps(page)

path.write_text(json.dumps(data, indent=2) + "\n")
PY

env -u OPENAI_API_KEY -u OPENAI_BASE_URL \
  flatpak run \
    --env="HOME=$PROJECT" \
    --env="OPENCODE_CONFIG_DIR=$CONFIG_DIR" \
    --env="XDG_CONFIG_HOME=$REAL_HOME/.config" \
    --env="XDG_DATA_HOME=$REAL_HOME/.local/share" \
    --env="XDG_STATE_HOME=$REAL_HOME/.local/state" \
    --cwd="$PROJECT" \
    "$FLATPAK_APP" "$@"
