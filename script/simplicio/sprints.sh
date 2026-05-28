#!/usr/bin/env bash
# Sprints board — minimum-viable mirror of Jira / Azure DevOps / GitHub Issues.
# REQUIREMENT R3. Uses whichever credentials are configured; surfaces a unified
# Kanban-style view. For actual delivery use `sendsprint run <source> <sprint>`.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

# Color helpers
B='\033[1m'; G='\033[1;32m'; Y='\033[1;33m'; C='\033[1;36m'; R='\033[1;31m'; X='\033[0m'

print_header() {
  printf '\n%b═══ SimplicioCode • Sprints Board ═══%b\n' "$C" "$X"
  printf 'source: %s   |   spec: docs/EVOLUTION.md → R3\n' "${1:-all configured}"
  # Show the active Simplicio1 tier + plan when bun is available.
  if command -v bun >/dev/null 2>&1 && [[ -f "$REPO_ROOT/script/simplicio/which-tier.ts" ]]; then
    local tier_line
    tier_line=$(bun "$REPO_ROOT/script/simplicio/which-tier.ts" 2>/dev/null | grep "Active tier" | tr -s " ")
    [[ -n "$tier_line" ]] && printf '%s\n' "$tier_line"
  fi
  printf 'plan: %s\n\n' "${SIMPLICIO_PLAN:-free}"
}

print_columns() {
  printf '%b TO DO              IN PROGRESS         REVIEW              DONE%b\n' "$B" "$X"
  printf '%b ─────              ───────────         ──────              ────%b\n' "$B" "$X"
}

# ---- GitHub (always available via gh-like API; uses repo from .simplicio/config.json) ----
fetch_github() {
  command -v gh >/dev/null 2>&1 || return 0
  local repo
  repo="$(grep -oE '"repo":\s*"[^"]+"' "$REPO_ROOT/.simplicio/config.json" 2>/dev/null \
    | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
  [[ -n "$repo" ]] || return 0
  printf '\n%b[GitHub %s — open issues]%b\n' "$G" "$repo" "$X"
  gh issue list -R "$repo" --state open --limit 20 2>/dev/null \
    | awk -F'\t' '{printf "  #%s  %s  [%s]\n", $1, $3, $4}' || true
}

# ---- Jira (env-gated) ----
fetch_jira() {
  [[ -n "${JIRA_URL:-}" && -n "${JIRA_EMAIL:-}" && -n "${JIRA_API_TOKEN:-}" ]] || return 0
  printf '\n%b[Jira %s — active sprint]%b\n' "$Y" "$JIRA_URL" "$X"
  curl -sS -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
    "$JIRA_URL/rest/api/3/search?jql=sprint%20in%20openSprints()&fields=summary,status&maxResults=20" \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);
[print(f"  {i[\"key\"]}  {i[\"fields\"][\"summary\"]}  [{i[\"fields\"][\"status\"][\"name\"]}]")
 for i in d.get("issues",[])]' 2>/dev/null || printf '  (jira fetch failed)\n'
}

# ---- Azure DevOps (env-gated) ----
fetch_azdo() {
  [[ -n "${AZDO_ORG:-}" && -n "${AZDO_PROJECT:-}" && -n "${AZDO_PAT:-}" ]] || return 0
  printf '\n%b[Azure DevOps %s/%s — current iteration]%b\n' "$Y" "$AZDO_ORG" "$AZDO_PROJECT" "$X"
  curl -sS -u ":$AZDO_PAT" \
    "https://dev.azure.com/$AZDO_ORG/$AZDO_PROJECT/_apis/work/teamsettings/iterations?api-version=7.0&\$timeframe=current" \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);
[print(f"  {it[\"name\"]}  ({it[\"attributes\"][\"startDate\"][:10]}→{it[\"attributes\"][\"finishDate\"][:10]})")
 for it in d.get("value",[])]' 2>/dev/null || printf '  (azdo fetch failed)\n'
}

# ---- Local .specs/sprints/ board ----
fetch_local() {
  local sprints_dir="$REPO_ROOT/.specs/sprints"
  [[ -d "$sprints_dir" ]] || return 0
  printf '\n%b[Local • .specs/sprints/]%b\n' "$C" "$X"
  find "$sprints_dir" -maxdepth 2 -name "*.task.md" -o -name "SPRINT.md" 2>/dev/null \
    | sed "s|$sprints_dir/||" \
    | sort \
    | head -30 \
    | awk '{printf "  %s\n", $0}'
}

# ---- Main ----
SOURCE="${1:-all}"
print_header "$SOURCE"

case "$SOURCE" in
  github)    fetch_github ;;
  jira)      fetch_jira ;;
  azuredevops|azdo) fetch_azdo ;;
  local)     fetch_local ;;
  all|*)
    fetch_local
    fetch_github
    fetch_jira
    fetch_azdo
    ;;
esac

printf '\n%bTo deliver a card:%b   bash script/simplicio/flow.sh --sprint <source> <sprint-id>\n' "$B" "$X"
printf '%bTo watch unattended:%b sendsprint watch\n\n' "$B" "$X"
