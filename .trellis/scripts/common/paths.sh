#!/bin/bash
# Common path utilities for Trellis workflow
#
# Usage: source this file in other scripts
#   source "$(dirname "$0")/common/paths.sh"
#
# Provides:
#   get_repo_root          - Get repository root directory
#   get_developer          - Get developer name
#   get_workspace_dir      - Get developer workspace directory
#   get_tasks_dir          - Get tasks directory
#   get_active_journal_file - Get current journal file

# =============================================================================
# Path Constants (change here to rename directories)
# =============================================================================

# Directory names
DIR_WORKFLOW=".trellis"
DIR_WORKSPACE="workspace"
DIR_TASKS="tasks"
DIR_ARCHIVE="archive"
DIR_SPEC="spec"
DIR_SCRIPTS="scripts"

# File names
FILE_DEVELOPER=".developer"
FILE_CURRENT_TASK=".current-task"
FILE_TASK_JSON="task.json"
FILE_JOURNAL_PREFIX="journal-"

# =============================================================================
# Repository Root
# =============================================================================

get_repo_root() {
  # Find the nearest directory containing .trellis/ folder
  # This handles nested git repos correctly (e.g., test project inside another repo)
  local current="$PWD"

  while [[ "$current" != "/" ]]; do
    if [[ -d "$current/$DIR_WORKFLOW" ]]; then
      echo "$current"
      return
    fi
    current=$(dirname "$current")
  done

  # Fallback to current directory if no .trellis/ found
  echo "$PWD"
}

# =============================================================================
# Developer
# =============================================================================

get_developer() {
  local repo_root="${1:-$(get_repo_root)}"
  local dev_file="$repo_root/$DIR_WORKFLOW/$FILE_DEVELOPER"

  if [[ -f "$dev_file" ]]; then
    grep "^name=" "$dev_file" 2>/dev/null | cut -d'=' -f2
  fi
}

check_developer() {
  local developer=$(get_developer "$1")
  [[ -n "$developer" ]]
}

# =============================================================================
# Tasks Directory
# =============================================================================

get_tasks_dir() {
  local repo_root="${1:-$(get_repo_root)}"
  echo "$repo_root/$DIR_WORKFLOW/$DIR_TASKS"
}

# =============================================================================
# Workspace Directory
# =============================================================================

get_workspace_dir() {
  local repo_root="${1:-$(get_repo_root)}"
  local developer=$(get_developer "$repo_root")

  if [[ -n "$developer" ]]; then
    echo "$repo_root/$DIR_WORKFLOW/$DIR_WORKSPACE/$developer"
  fi
}

# =============================================================================
# Journal File
# =============================================================================

get_active_journal_file() {
  local repo_root="${1:-$(get_repo_root)}"
  local workspace_dir=$(get_workspace_dir "$repo_root")

  if [[ -z "$workspace_dir" ]] || [[ ! -d "$workspace_dir" ]]; then
    echo ""
    return
  fi

  local latest=""
  local highest=0
  for f in "$workspace_dir"/${FILE_JOURNAL_PREFIX}*.md; do
    if [[ -f "$f" ]]; then
      local num=$(basename "$f" | sed "s/${FILE_JOURNAL_PREFIX}//" | sed 's/\.md//')
      if [[ "$num" =~ ^[0-9]+$ ]] && [[ "$num" -gt "$highest" ]]; then
        highest=$num
        latest="$f"
      fi
    fi
  done

  if [[ -n "$latest" ]]; then
    echo "$latest"
  fi
}

count_lines() {
  local file="$1"
  if [[ -f "$file" ]]; then
    wc -l < "$file" | tr -d ' '
  else
    echo "0"
  fi
}

# =============================================================================
# Current Task Management
# =============================================================================

# Get .current-task file path
_get_current_task_file() {
  local repo_root="${1:-$(get_repo_root)}"
  echo "$repo_root/$DIR_WORKFLOW/$FILE_CURRENT_TASK"
}

# Get current task directory path (relative to repo_root)
get_current_task() {
  local repo_root="${1:-$(get_repo_root)}"
  local current_file=$(_get_current_task_file "$repo_root")

  if [[ -f "$current_file" ]]; then
    cat "$current_file" 2>/dev/null
  fi
}

# Get current task directory absolute path
get_current_task_abs() {
  local repo_root="${1:-$(get_repo_root)}"
  local relative=$(get_current_task "$repo_root")

  if [[ -n "$relative" ]]; then
    echo "$repo_root/$relative"
  fi
}

# Set current task
# Args: $1 - task directory path (relative to repo_root)
set_current_task() {
  local task_path="$1"
  local repo_root="${2:-$(get_repo_root)}"
  local current_file=$(_get_current_task_file "$repo_root")

  if [[ -z "$task_path" ]]; then
    echo "Error: task path is required" >&2
    return 1
  fi

  # Verify task directory exists
  local full_path="$repo_root/$task_path"
  if [[ ! -d "$full_path" ]]; then
    echo "Error: task directory not found: $task_path" >&2
    return 1
  fi

  echo "$task_path" > "$current_file"
}

# Clear current task
clear_current_task() {
  local repo_root="${1:-$(get_repo_root)}"
  local current_file=$(_get_current_task_file "$repo_root")

  if [[ -f "$current_file" ]]; then
    rm -f "$current_file"
  fi
}

# Check if has current task
has_current_task() {
  local current=$(get_current_task "$1")
  [[ -n "$current" ]]
}

# =============================================================================
# Task ID Generation
# =============================================================================

# Generate task ID based on date (MM-DD format)
# Returns: MM-DD (e.g., "01-21")
generate_task_date_prefix() {
  date +%m-%d
}
