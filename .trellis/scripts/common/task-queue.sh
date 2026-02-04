#!/bin/bash
# Task queue utility functions
#
# Usage: source this file in other scripts
#   source "$(dirname "$0")/common/task-queue.sh"
#
# Provides:
#   list_pending_tasks     - List tasks with pending status
#   get_task_stats         - Get P0/P1/P2/P3 counts

# Ensure paths.sh is loaded
if ! type get_repo_root &>/dev/null; then
  echo "Error: paths.sh must be sourced before task-queue.sh" >&2
  exit 1
fi

# =============================================================================
# Public Functions
# =============================================================================

# List tasks by status
# Args: [filter_status]
# Output: formatted list to stdout
list_tasks_by_status() {
  local filter_status="${1:-}"
  local repo_root="${2:-$(get_repo_root)}"

  local tasks_dir=$(get_tasks_dir "$repo_root")

  if [[ ! -d "$tasks_dir" ]]; then
    return 0
  fi

  for d in "$tasks_dir"/*/; do
    if [[ -d "$d" ]] && [[ "$(basename "$d")" != "archive" ]]; then
      local task_json="$d/$FILE_TASK_JSON"
      if [[ -f "$task_json" ]]; then
        local id=$(jq -r '.id' "$task_json")
        local title=$(jq -r '.title // .name' "$task_json")
        local priority=$(jq -r '.priority // "P2"' "$task_json")
        local status=$(jq -r '.status // "planning"' "$task_json")
        local assignee=$(jq -r '.assignee // "-"' "$task_json")

        # Apply filter
        if [[ -n "$filter_status" ]] && [[ "$status" != "$filter_status" ]]; then
          continue
        fi

        echo "$priority|$id|$title|$status|$assignee"
      fi
    fi
  done
}

# List pending tasks
list_pending_tasks() {
  list_tasks_by_status "planning" "$@"
}

# List tasks assigned to a specific developer
# Args: developer_name, [filter_status], [repo_root]
# Output: formatted list to stdout
list_tasks_by_assignee() {
  local assignee="$1"
  local filter_status="${2:-}"
  local repo_root="${3:-$(get_repo_root)}"

  local tasks_dir=$(get_tasks_dir "$repo_root")

  if [[ ! -d "$tasks_dir" ]]; then
    return 0
  fi

  for d in "$tasks_dir"/*/; do
    if [[ -d "$d" ]] && [[ "$(basename "$d")" != "archive" ]]; then
      local task_json="$d/$FILE_TASK_JSON"
      if [[ -f "$task_json" ]]; then
        local id=$(jq -r '.id' "$task_json")
        local title=$(jq -r '.title // .name' "$task_json")
        local priority=$(jq -r '.priority // "P2"' "$task_json")
        local status=$(jq -r '.status // "planning"' "$task_json")
        local task_assignee=$(jq -r '.assignee // "-"' "$task_json")

        # Apply assignee filter
        if [[ "$task_assignee" != "$assignee" ]]; then
          continue
        fi

        # Apply status filter
        if [[ -n "$filter_status" ]] && [[ "$status" != "$filter_status" ]]; then
          continue
        fi

        echo "$priority|$id|$title|$status|$task_assignee"
      fi
    fi
  done
}

# List my tasks (current developer)
# Args: [filter_status], [repo_root]
list_my_tasks() {
  local filter_status="${1:-}"
  local repo_root="${2:-$(get_repo_root)}"
  local developer=$(get_developer "$repo_root")

  if [[ -z "$developer" ]]; then
    echo "Error: Developer not set" >&2
    return 1
  fi

  list_tasks_by_assignee "$developer" "$filter_status" "$repo_root"
}

# Get task statistics
# Output: "P0:N P1:N P2:N P3:N Total:N"
get_task_stats() {
  local repo_root="${1:-$(get_repo_root)}"
  local tasks_dir=$(get_tasks_dir "$repo_root")

  local p0=0 p1=0 p2=0 p3=0 total=0

  if [[ -d "$tasks_dir" ]]; then
    for d in "$tasks_dir"/*/; do
      if [[ -d "$d" ]] && [[ "$(basename "$d")" != "archive" ]]; then
        local task_json="$d/$FILE_TASK_JSON"
        if [[ -f "$task_json" ]]; then
          local priority=$(jq -r '.priority // "P2"' "$task_json" 2>/dev/null)
          case "$priority" in
            P0) ((p0++)) ;;
            P1) ((p1++)) ;;
            P2) ((p2++)) ;;
            P3) ((p3++)) ;;
          esac
          ((total++))
        fi
      fi
    done
  fi

  echo "P0:$p0 P1:$p1 P2:$p2 P3:$p3 Total:$total"
}
