#!/bin/bash
# Task utility functions
#
# Usage: source this file in other scripts
#   source "$(dirname "$0")/common/task-utils.sh"
#
# Provides:
#   is_safe_task_path      - Validate task path is safe to operate on
#   find_task_by_name      - Find task directory by name
#   archive_task_dir       - Archive task to monthly directory

# Ensure dependencies are loaded
if ! type get_repo_root &>/dev/null; then
  echo "Error: paths.sh must be sourced before task-utils.sh" >&2
  exit 1
fi

# =============================================================================
# Path Safety
# =============================================================================

# Check if a relative task path is safe to operate on
# Args: task_path (relative), repo_root
# Returns: 0 if safe, 1 if dangerous
# Outputs: error message to stderr if unsafe
is_safe_task_path() {
  local task_path="$1"
  local repo_root="${2:-$(get_repo_root)}"

  # Check empty or null
  if [[ -z "$task_path" ]] || [[ "$task_path" = "null" ]]; then
    echo "Error: empty or null task path" >&2
    return 1
  fi

  # Reject absolute paths
  if [[ "$task_path" = /* ]]; then
    echo "Error: absolute path not allowed: $task_path" >&2
    return 1
  fi

  # Reject ".", "..", paths starting with "./" or "../", or containing ".."
  if [[ "$task_path" = "." ]] || [[ "$task_path" = ".." ]] || \
     [[ "$task_path" = "./" ]] || [[ "$task_path" == ./* ]] || \
     [[ "$task_path" == *".."* ]]; then
    echo "Error: path traversal not allowed: $task_path" >&2
    return 1
  fi

  # Final check: ensure resolved path is not the repo root
  local abs_path="${repo_root}/${task_path}"
  if [[ -e "$abs_path" ]]; then
    local resolved=$(realpath "$abs_path" 2>/dev/null)
    local root_resolved=$(realpath "$repo_root" 2>/dev/null)
    if [[ "$resolved" = "$root_resolved" ]]; then
      echo "Error: path resolves to repo root: $task_path" >&2
      return 1
    fi
  fi

  return 0
}

# =============================================================================
# Task Lookup
# =============================================================================

# Find task directory by name (exact or suffix match)
# Args: task_name, tasks_dir
# Returns: absolute path to task directory, or empty if not found
find_task_by_name() {
  local task_name="$1"
  local tasks_dir="$2"

  if [[ -z "$task_name" ]] || [[ -z "$tasks_dir" ]]; then
    return 1
  fi

  # Try exact match first
  local task_dir=$(find "$tasks_dir" -maxdepth 1 -type d -name "${task_name}" 2>/dev/null | head -1)

  # Try suffix match (e.g., "my-task" matches "01-21-my-task")
  if [[ -z "$task_dir" ]]; then
    task_dir=$(find "$tasks_dir" -maxdepth 1 -type d -name "*-${task_name}" 2>/dev/null | head -1)
  fi

  if [[ -n "$task_dir" ]] && [[ -d "$task_dir" ]]; then
    echo "$task_dir"
    return 0
  fi

  return 1
}

# =============================================================================
# Archive Operations
# =============================================================================

# Archive a task directory to archive/{YYYY-MM}/
# Args: task_dir_abs, [repo_root]
# Returns: 0 on success, 1 on error
# Outputs: archive destination path
archive_task_dir() {
  local task_dir_abs="$1"
  local repo_root="${2:-$(get_repo_root)}"

  if [[ ! -d "$task_dir_abs" ]]; then
    echo "Error: task directory not found: $task_dir_abs" >&2
    return 1
  fi

  # Get tasks directory (parent of the task)
  local tasks_dir=$(dirname "$task_dir_abs")
  local archive_dir="$tasks_dir/archive"
  local year_month=$(date +%Y-%m)
  local month_dir="$archive_dir/$year_month"

  # Create archive directory
  mkdir -p "$month_dir"

  # Move task to archive
  local task_name=$(basename "$task_dir_abs")
  mv "$task_dir_abs" "$month_dir/"

  # Output the destination
  echo "$month_dir/$task_name"
  return 0
}

# Complete archive workflow: archive directory
# Args: task_dir_abs, [repo_root]
# Returns: 0 on success
# Outputs: lines with status info
archive_task_complete() {
  local task_dir_abs="$1"
  local repo_root="${2:-$(get_repo_root)}"

  if [[ ! -d "$task_dir_abs" ]]; then
    echo "Error: task directory not found: $task_dir_abs" >&2
    return 1
  fi

  # Archive the directory
  local archive_dest
  if archive_dest=$(archive_task_dir "$task_dir_abs" "$repo_root"); then
    echo "archived_to:$archive_dest"
    return 0
  fi

  return 1
}
