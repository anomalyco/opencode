#!/bin/bash
# Add a new session to journal file and update index.md
#
# Usage:
#   ./.trellis/scripts/add-session.sh --title "Title" --commit "hash" --summary "Summary"
#   echo "content" | ./.trellis/scripts/add-session.sh --title "Title" --commit "hash"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common/paths.sh"
source "$SCRIPT_DIR/common/developer.sh"

MAX_LINES=2000
TODAY=$(date +%Y-%m-%d)

# Ensure developer is initialized
ensure_developer

DEVELOPER=$(get_developer)
REPO_ROOT=$(get_repo_root)
DEV_DIR="$REPO_ROOT/$DIR_WORKFLOW/$DIR_WORKSPACE/$DEVELOPER"
INDEX_FILE="$DEV_DIR/index.md"

# =============================================================================
# Helper Functions
# =============================================================================

get_latest_journal_info() {
  local latest_file=""
  local latest_num=-1  # Start at -1 so journal-0.md can be detected (0 > -1)

  for f in "$DEV_DIR"/${FILE_JOURNAL_PREFIX}*.md; do
    if [[ -f "$f" ]]; then
      local num=$(basename "$f" | sed "s/${FILE_JOURNAL_PREFIX}\([0-9]*\)\.md/\1/")
      if [[ "$num" -gt "$latest_num" ]]; then
        latest_num=$num
        latest_file="$f"
      fi
    fi
  done

  if [[ -n "$latest_file" ]]; then
    local lines=$(wc -l < "$latest_file" | tr -d ' ')
    echo "$latest_file:$latest_num:$lines"
  else
    echo ":0:0"
  fi
}

get_current_session() {
  local line=$(grep "Total Sessions" "$INDEX_FILE" 2>/dev/null | head -1)
  echo "$line" | sed 's/.*: //' | tr -d ' '
}

count_journal_files() {
  local result=""
  local journal_info=$(get_latest_journal_info)
  local active_num=$(echo "$journal_info" | cut -d: -f2)
  local active_file="${FILE_JOURNAL_PREFIX}$active_num.md"

  for f in $(ls -v "$DEV_DIR"/${FILE_JOURNAL_PREFIX}*.md 2>/dev/null | sort -t- -k2 -n -r); do
    if [[ -f "$f" ]]; then
      local filename=$(basename "$f")
      local lines=$(wc -l < "$f" | tr -d ' ')

      local status="Archived"
      if [[ "$filename" == "$active_file" ]]; then
        status="Active"
      fi

      result="${result}| \`$filename\` | ~$lines | $status |
"
    fi
  done
  echo "$result" | sed '/^$/d'
}

create_new_journal_file() {
  local num=$1
  local prev_num=$((num - 1))
  local new_file="$DEV_DIR/${FILE_JOURNAL_PREFIX}$num.md"

  cat > "$new_file" << EOF
# Journal - $DEVELOPER (Part $num)

> Continuation from \`${FILE_JOURNAL_PREFIX}$prev_num.md\` (archived at ~$MAX_LINES lines)
> Started: $TODAY

---

EOF
  echo "$new_file"
}

generate_session_content() {
  local session_num=$1
  local title=$2
  local commit=$3
  local summary=$4
  local extra_content=$5

  local commit_table=""
  if [[ -n "$commit" && "$commit" != "-" ]]; then
    commit_table="| Hash | Message |
|------|---------|"
    IFS=',' read -ra COMMITS <<< "$commit"
    for c in "${COMMITS[@]}"; do
      c=$(echo "$c" | tr -d ' ')
      commit_table="$commit_table
| \`$c\` | (see git log) |"
    done
  else
    commit_table="(No commits - planning session)"
  fi

  cat << EOF

## Session $session_num: $title

**Date**: $TODAY
**Task**: $title

### Summary

$summary

### Main Changes

$extra_content

### Git Commits

$commit_table

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
EOF
}

# =============================================================================
# Update Index.md
# =============================================================================

update_index() {
  local title="$1"
  local commit="$2"
  local new_session="$3"
  local active_file="$4"

  # Format commit for display
  local commit_display="-"
  if [[ -n "$commit" && "$commit" != "-" ]]; then
    commit_display=$(echo "$commit" | sed 's/,/, /g' | sed 's/\([a-f0-9]\{7,\}\)/`\1`/g')
  fi

  local files_table=$(count_journal_files)

  echo "Updating index.md for session $new_session..."
  echo "  Title: $title"
  echo "  Commit: $commit_display"
  echo "  Active File: $active_file"
  echo ""

  if ! grep -q "@@@auto:current-status" "$INDEX_FILE"; then
    echo "Error: Markers not found in index.md. Please ensure markers exist." >&2
    exit 1
  fi

  local tmp_file=$(mktemp)

  local in_current_status=false
  local in_active_documents=false
  local in_session_history=false
  local header_written=false

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == *"@@@auto:current-status"* ]]; then
      echo "$line" >> "$tmp_file"
      in_current_status=true
      echo "- **Active File**: \`$active_file\`" >> "$tmp_file"
      echo "- **Total Sessions**: $new_session" >> "$tmp_file"
      echo "- **Last Active**: $TODAY" >> "$tmp_file"
      continue
    fi

    if [[ "$line" == *"@@@/auto:current-status"* ]]; then
      in_current_status=false
      echo "$line" >> "$tmp_file"
      continue
    fi

    if [[ "$line" == *"@@@auto:active-documents"* ]]; then
      echo "$line" >> "$tmp_file"
      in_active_documents=true
      echo "| File | Lines | Status |" >> "$tmp_file"
      echo "|------|-------|--------|" >> "$tmp_file"
      echo "$files_table" >> "$tmp_file"
      continue
    fi

    if [[ "$line" == *"@@@/auto:active-documents"* ]]; then
      in_active_documents=false
      echo "$line" >> "$tmp_file"
      continue
    fi

    if [[ "$line" == *"@@@auto:session-history"* ]]; then
      echo "$line" >> "$tmp_file"
      in_session_history=true
      header_written=false
      continue
    fi

    if [[ "$line" == *"@@@/auto:session-history"* ]]; then
      in_session_history=false
      echo "$line" >> "$tmp_file"
      continue
    fi

    if $in_current_status; then
      continue
    fi

    if $in_active_documents; then
      continue
    fi

    if $in_session_history; then
      echo "$line" >> "$tmp_file"
      if [[ "$line" == "|---"* ]] && ! $header_written; then
        echo "| $new_session | $TODAY | $title | $commit_display |" >> "$tmp_file"
        header_written=true
      fi
      continue
    fi

    echo "$line" >> "$tmp_file"
  done < "$INDEX_FILE"

  mv "$tmp_file" "$INDEX_FILE"

  echo "[OK] Updated index.md successfully!"
}

# =============================================================================
# Main Function
# =============================================================================

add_session() {
  local title=""
  local commit="-"
  local summary="(Add summary)"
  local content_file=""
  local extra_content="(Add details)"

  while [[ $# -gt 0 ]]; do
    case $1 in
      --title)
        title="$2"
        shift 2
        ;;
      --commit)
        commit="$2"
        shift 2
        ;;
      --summary)
        summary="$2"
        shift 2
        ;;
      --content-file)
        content_file="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  if [[ -z "$title" ]]; then
    echo "Error: --title is required" >&2
    echo "Usage: $0 --title \"Session Title\" [--commit \"hash1,hash2\"] [--summary \"Brief summary\"]" >&2
    exit 1
  fi

  if [[ -n "$content_file" && -f "$content_file" ]]; then
    extra_content=$(cat "$content_file")
  elif [[ ! -t 0 ]]; then
    extra_content=$(cat)
  fi

  local journal_info=$(get_latest_journal_info)
  local current_file=$(echo "$journal_info" | cut -d: -f1)
  local current_num=$(echo "$journal_info" | cut -d: -f2)
  local current_lines=$(echo "$journal_info" | cut -d: -f3)
  local current_session=$(get_current_session)
  local new_session=$((current_session + 1))

  local session_content=$(generate_session_content "$new_session" "$title" "$commit" "$summary" "$extra_content")
  local content_lines=$(echo "$session_content" | wc -l | tr -d ' ')

  echo "========================================" >&2
  echo "ADD SESSION" >&2
  echo "========================================" >&2
  echo "" >&2
  echo "Session: $new_session" >&2
  echo "Title: $title" >&2
  echo "Commit: $commit" >&2
  echo "" >&2
  echo "Current journal file: ${FILE_JOURNAL_PREFIX}$current_num.md" >&2
  echo "Current lines: $current_lines" >&2
  echo "New content lines: $content_lines" >&2
  echo "Total after append: $((current_lines + content_lines))" >&2
  echo "" >&2

  local target_file="$current_file"
  local target_num=$current_num

  if [[ $((current_lines + content_lines)) -gt $MAX_LINES ]]; then
    target_num=$((current_num + 1))
    echo "[!] Exceeds $MAX_LINES lines, creating ${FILE_JOURNAL_PREFIX}$target_num.md" >&2
    target_file=$(create_new_journal_file "$target_num")
    echo "Created: $target_file" >&2
  fi

  echo "$session_content" >> "$target_file"
  echo "[OK] Appended session to $(basename "$target_file")" >&2

  echo "" >&2

  # Update index.md directly
  local active_file="${FILE_JOURNAL_PREFIX}$target_num.md"
  update_index "$title" "$commit" "$new_session" "$active_file"

  echo "" >&2
  echo "========================================" >&2
  echo "[OK] Session $new_session added successfully!" >&2
  echo "========================================" >&2
  echo "" >&2
  echo "Files updated:" >&2
  echo "  - $(basename "$target_file")" >&2
  echo "  - index.md" >&2
}

show_help() {
  echo "Usage: $0 --title \"Title\" [options]"
  echo ""
  echo "Add a new session to journal file and update index.md automatically."
  echo ""
  echo "Options:"
  echo "  --title TEXT       Session title (required)"
  echo "  --commit HASHES    Comma-separated commit hashes (optional)"
  echo "  --summary TEXT     Brief summary of the session (optional)"
  echo "  --content-file     Path to file with detailed content (optional)"
  echo ""
  echo "You can also pipe content via stdin:"
  echo "  echo \"Details\" | $0 --title \"Title\" --commit \"abc123\""
  echo ""
  echo "Examples:"
  echo "  $0 --title \"Fix login bug\" --commit \"abc1234\" --summary \"Fixed auth issue\""
}

# =============================================================================
# Main Entry
# =============================================================================

case "${1:-}" in
  --help|-h|help)
    show_help
    ;;
  *)
    add_session "$@"
    ;;
esac
