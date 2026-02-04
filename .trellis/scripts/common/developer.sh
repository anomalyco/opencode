#!/bin/bash
# Developer management utilities
#
# Usage: source this file in other scripts
#   source "$(dirname "$0")/common/developer.sh"
#
# Provides:
#   init_developer     - Initialize developer
#   ensure_developer   - Ensure developer is initialized (exit if not)
#   show_developer_info - Show developer information

# Ensure paths.sh is loaded
if ! type get_repo_root &>/dev/null; then
  source "$(dirname "${BASH_SOURCE[0]}")/paths.sh"
fi

# =============================================================================
# Developer Initialization
# =============================================================================

init_developer() {
  local name="$1"
  local repo_root="${2:-$(get_repo_root)}"

  if [[ -z "$name" ]]; then
    echo "Error: developer name is required" >&2
    return 1
  fi

  local dev_file="$repo_root/$DIR_WORKFLOW/$FILE_DEVELOPER"
  local workspace_dir="$repo_root/$DIR_WORKFLOW/$DIR_WORKSPACE/$name"

  # Create .developer file
  cat > "$dev_file" << EOF
name=$name
initialized_at=$(date -Iseconds)
EOF

  # Create workspace directory structure
  mkdir -p "$workspace_dir"

  # Create initial journal file
  local journal_file="$workspace_dir/${FILE_JOURNAL_PREFIX}1.md"
  if [[ ! -f "$journal_file" ]]; then
    cat > "$journal_file" << JOURNAL_EOF
# Journal - $name (Part 1)

> AI development session journal
> Started: $(date +%Y-%m-%d)

---

JOURNAL_EOF
  fi

  # Create index.md with markers for auto-update
  local index_file="$workspace_dir/index.md"
  if [[ ! -f "$index_file" ]]; then
    cat > "$index_file" << INDEX_EOF
# Workspace Index - $name

> Journal tracking for AI development sessions.

---

## Current Status

<!-- @@@auto:current-status -->
- **Active File**: \`journal-1.md\`
- **Total Sessions**: 0
- **Last Active**: -
<!-- @@@/auto:current-status -->

---

## Active Documents

<!-- @@@auto:active-documents -->
| File | Lines | Status |
|------|-------|--------|
| \`journal-1.md\` | ~0 | Active |
<!-- @@@/auto:active-documents -->

---

## Session History

<!-- @@@auto:session-history -->
| # | Date | Title | Commits |
|---|------|-------|---------|
<!-- @@@/auto:session-history -->

---

## Notes

- Sessions are appended to journal files
- New journal file created when current exceeds 2000 lines
- Use \`add-session.sh\` to record sessions
INDEX_EOF
  fi

  echo "Developer initialized: $name"
  echo "  .developer file: $dev_file"
  echo "  Workspace dir: $workspace_dir"
}

ensure_developer() {
  local repo_root="${1:-$(get_repo_root)}"

  if ! check_developer "$repo_root"; then
    echo "Error: Developer not initialized." >&2
    echo "Run: ./.trellis/scripts/init-developer.sh <your-name>" >&2
    exit 1
  fi
}

show_developer_info() {
  local repo_root="${1:-$(get_repo_root)}"
  local developer=$(get_developer "$repo_root")

  if [[ -z "$developer" ]]; then
    echo "Developer: (not initialized)"
  else
    echo "Developer: $developer"
    echo "Workspace: $DIR_WORKFLOW/$DIR_WORKSPACE/$developer/"
    echo "Tasks: $DIR_WORKFLOW/$DIR_TASKS/"
  fi
}
