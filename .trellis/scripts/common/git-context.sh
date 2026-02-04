#!/bin/bash
# Git and Session Context utilities
#
# Usage:
#   ./.trellis/scripts/common/git-context.sh           # Full context output
#   ./.trellis/scripts/common/git-context.sh --json    # JSON format
#
# Or source in other scripts:
#   source "$(dirname "$0")/common/git-context.sh"

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$COMMON_DIR/paths.sh"
source "$COMMON_DIR/developer.sh"

# =============================================================================
# JSON Output
# =============================================================================

output_json() {
  local repo_root=$(get_repo_root)
  local developer=$(get_developer "$repo_root")
  local tasks_dir=$(get_tasks_dir "$repo_root")
  local journal_file=$(get_active_journal_file "$repo_root")
  local journal_lines=0
  local journal_relative=""

  if [[ -n "$journal_file" ]]; then
    journal_lines=$(count_lines "$journal_file")
    journal_relative="$DIR_WORKFLOW/$DIR_WORKSPACE/$developer/$(basename "$journal_file")"
  fi

  local branch=$(git branch --show-current 2>/dev/null || echo "unknown")
  local git_status=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  local is_clean="true"
  [[ "$git_status" != "0" ]] && is_clean="false"

  # Build commits JSON
  local commits_json="["
  local first=true
  while IFS= read -r line; do
    local hash=$(echo "$line" | cut -d' ' -f1)
    local msg=$(echo "$line" | cut -d' ' -f2-)
    msg=$(echo "$msg" | sed 's/"/\\"/g')
    if [[ "$first" == "true" ]]; then
      first=false
    else
      commits_json+=","
    fi
    commits_json+="{\"hash\":\"$hash\",\"message\":\"$msg\"}"
  done < <(git log --oneline -5 2>/dev/null || echo "")
  commits_json+="]"

  # Build tasks JSON
  local tasks_json="["
  first=true
  if [[ -d "$tasks_dir" ]]; then
    for d in "$tasks_dir"/*/; do
      if [[ -d "$d" ]] && [[ "$(basename "$d")" != "archive" ]]; then
        local task_json="$d/$FILE_TASK_JSON"
        if [[ -f "$task_json" ]]; then
          local dir_name=$(basename "$d")
          local name=$(jq -r '.name // .id // "unknown"' "$task_json" 2>/dev/null)
          local status=$(jq -r '.status // "unknown"' "$task_json" 2>/dev/null)
          if [[ "$first" == "true" ]]; then
            first=false
          else
            tasks_json+=","
          fi
          tasks_json+="{\"dir\":\"$dir_name\",\"name\":\"$name\",\"status\":\"$status\"}"
        fi
      fi
    done
  fi
  tasks_json+="]"

  cat << EOF
{
  "developer": "$developer",
  "git": {
    "branch": "$branch",
    "isClean": $is_clean,
    "uncommittedChanges": $git_status,
    "recentCommits": $commits_json
  },
  "tasks": {
    "active": $tasks_json,
    "directory": "$DIR_WORKFLOW/$DIR_TASKS"
  },
  "journal": {
    "file": "$journal_relative",
    "lines": $journal_lines,
    "nearLimit": $([ "$journal_lines" -gt 1800 ] && echo "true" || echo "false")
  }
}
EOF
}

# =============================================================================
# Text Output
# =============================================================================

output_text() {
  local repo_root=$(get_repo_root)
  local developer=$(get_developer "$repo_root")

  echo "========================================"
  echo "SESSION CONTEXT"
  echo "========================================"
  echo ""

  echo "## DEVELOPER"
  if [[ -z "$developer" ]]; then
    echo "ERROR: Not initialized. Run: ./$DIR_WORKFLOW/$DIR_SCRIPTS/init-developer.sh <name>"
    exit 1
  fi
  echo "Name: $developer"
  echo ""

  echo "## GIT STATUS"
  echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
  local status_count=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$status_count" == "0" ]]; then
    echo "Working directory: Clean"
  else
    echo "Working directory: $status_count uncommitted change(s)"
    echo ""
    echo "Changes:"
    git status --short 2>/dev/null | head -10
  fi
  echo ""

  echo "## RECENT COMMITS"
  git log --oneline -5 2>/dev/null || echo "(no commits)"
  echo ""

  echo "## CURRENT TASK"
  local current_task=$(get_current_task "$repo_root")
  if [[ -n "$current_task" ]]; then
    local current_task_dir="$repo_root/$current_task"
    local task_json="$current_task_dir/$FILE_TASK_JSON"
    echo "Path: $current_task"

    if [[ -f "$task_json" ]]; then
      if command -v jq &> /dev/null; then
        local t_name=$(jq -r '.name // .id // "unknown"' "$task_json")
        local t_status=$(jq -r '.status // "unknown"' "$task_json")
        local t_created=$(jq -r '.createdAt // "unknown"' "$task_json")
        local t_desc=$(jq -r '.description // ""' "$task_json")
        echo "Name: $t_name"
        echo "Status: $t_status"
        echo "Created: $t_created"
        if [[ -n "$t_desc" ]]; then
          echo "Description: $t_desc"
        fi
      fi
    fi

    # Check for prd.md
    if [[ -f "$current_task_dir/prd.md" ]]; then
      echo ""
      echo "[!] This task has prd.md - read it for task details"
    fi
  else
    echo "(none)"
  fi
  echo ""

  echo "## ACTIVE TASKS"
  local tasks_dir=$(get_tasks_dir "$repo_root")
  local task_count=0
  if [[ -d "$tasks_dir" ]]; then
    for d in "$tasks_dir"/*/; do
      if [[ -d "$d" ]] && [[ "$(basename "$d")" != "archive" ]]; then
        local dir_name=$(basename "$d")
        local t_json="$d/$FILE_TASK_JSON"
        local status="unknown"
        local assignee="-"
        if [[ -f "$t_json" ]] && command -v jq &> /dev/null; then
          status=$(jq -r '.status // "unknown"' "$t_json")
          assignee=$(jq -r '.assignee // "-"' "$t_json")
        fi
        echo "- $dir_name/ ($status) @$assignee"
        ((task_count++)) || true
      fi
    done
  fi
  if [[ $task_count -eq 0 ]]; then
    echo "(no active tasks)"
  fi
  echo "Total: $task_count active task(s)"
  echo ""

  echo "## MY TASKS (Assigned to me)"
  local my_task_count=0
  if [[ -d "$tasks_dir" ]]; then
    for d in "$tasks_dir"/*/; do
      if [[ -d "$d" ]] && [[ "$(basename "$d")" != "archive" ]]; then
        local t_json="$d/$FILE_TASK_JSON"
        if [[ -f "$t_json" ]] && command -v jq &> /dev/null; then
          local assignee=$(jq -r '.assignee // ""' "$t_json")
          local status=$(jq -r '.status // "planning"' "$t_json")
          if [[ "$assignee" == "$developer" ]] && [[ "$status" != "done" ]]; then
            local title=$(jq -r '.title // .name // "unknown"' "$t_json")
            local priority=$(jq -r '.priority // "P2"' "$t_json")
            echo "- [$priority] $title ($status)"
            ((my_task_count++)) || true
          fi
        fi
      fi
    done
  fi
  if [[ $my_task_count -eq 0 ]]; then
    echo "(no tasks assigned to you)"
  fi
  echo ""

  echo "## JOURNAL FILE"
  local journal_file=$(get_active_journal_file "$repo_root")
  if [[ -n "$journal_file" ]]; then
    local lines=$(count_lines "$journal_file")
    local relative="$DIR_WORKFLOW/$DIR_WORKSPACE/$developer/$(basename "$journal_file")"
    echo "Active file: $relative"
    echo "Line count: $lines / 2000"
    if [[ "$lines" -gt 1800 ]]; then
      echo "[!] WARNING: Approaching 2000 line limit!"
    fi
  else
    echo "No journal file found"
  fi
  echo ""

  echo "## PATHS"
  echo "Workspace: $DIR_WORKFLOW/$DIR_WORKSPACE/$developer/"
  echo "Tasks: $DIR_WORKFLOW/$DIR_TASKS/"
  echo "Spec: $DIR_WORKFLOW/$DIR_SPEC/"
  echo ""

  echo "========================================"
}

# =============================================================================
# Main Entry
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    --json|-j)
      output_json
      ;;
    --help|-h)
      echo "Get Session Context for AI Agent"
      echo ""
      echo "Usage:"
      echo "  $0           Output context in text format"
      echo "  $0 --json    Output context in JSON format"
      ;;
    *)
      output_text
      ;;
  esac
fi
