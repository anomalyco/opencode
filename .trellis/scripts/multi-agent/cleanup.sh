#!/bin/bash
# =============================================================================
# Multi-Agent Pipeline: Cleanup Worktree
# =============================================================================
# Usage:
#   ./cleanup.sh <branch-name>      Remove specific worktree
#   ./cleanup.sh --list             List all worktrees
#   ./cleanup.sh --merged           Remove merged worktrees
#   ./cleanup.sh --all              Remove all worktrees (with confirmation)
#
# Options:
#   -y, --yes                       Skip confirmation prompts
#   --keep-branch                   Don't delete the git branch
#
# This script:
# 1. Archives task directory to archive/{YYYY-MM}/
# 2. Removes agent from registry
# 3. Removes git worktree
# 4. Optionally deletes git branch
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../common/paths.sh"
source "$SCRIPT_DIR/../common/worktree.sh"
source "$SCRIPT_DIR/../common/developer.sh"
source "$SCRIPT_DIR/../common/task-queue.sh"
source "$SCRIPT_DIR/../common/task-utils.sh"
source "$SCRIPT_DIR/../common/registry.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

PROJECT_ROOT=$(get_repo_root)
SKIP_CONFIRM=false
KEEP_BRANCH=false

# =============================================================================
# Parse Arguments
# =============================================================================
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    -y|--yes)
      SKIP_CONFIRM=true
      shift
      ;;
    --keep-branch)
      KEEP_BRANCH=true
      shift
      ;;
    --list|--merged|--all)
      ACTION="${1#--}"
      shift
      ;;
    -*)
      log_error "Unknown option: $1"
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

# =============================================================================
# List Worktrees
# =============================================================================
cmd_list() {
  echo -e "${BLUE}=== Git Worktrees ===${NC}"
  echo ""

  cd "$PROJECT_ROOT"
  git worktree list

  echo ""

  # Show registry info
  local registry_file=$(registry_get_file "$PROJECT_ROOT")

  if [ -f "$registry_file" ]; then
    echo -e "${BLUE}=== Registered Agents ===${NC}"
    echo ""
    jq -r '.agents[] | "  \(.id): PID=\(.pid) [\(.worktree_path)]"' "$registry_file" 2>/dev/null || echo "  (none)"
    echo ""
  fi
}

# =============================================================================
# Archive Task (using common function)
# =============================================================================
archive_task() {
  local worktree_path="$1"

  # Find task directory from registry
  local task_dir=$(registry_get_task_dir "$worktree_path" "$PROJECT_ROOT")

  # Validate task path is safe
  if ! is_safe_task_path "$task_dir" "$PROJECT_ROOT" 2>/dev/null; then
    return 0
  fi

  local task_dir_abs="${PROJECT_ROOT}/${task_dir}"
  if [ ! -d "$task_dir_abs" ]; then
    return 0
  fi

  # Use common archive function
  local result=$(archive_task_complete "$task_dir_abs" "$PROJECT_ROOT")

  # Parse result and log
  echo "$result" | while IFS= read -r line; do
    case "$line" in
      task_completed:*)
        log_info "Completed task: ${line#task_completed:}"
        ;;
      archived_to:*)
        local dest="${line#archived_to:}"
        local task_name=$(basename "$dest")
        local month_dir=$(dirname "$dest")
        log_success "Archived task: $task_name -> $(basename "$month_dir")/"
        ;;
    esac
  done
}

# =============================================================================
# Cleanup from Registry Only (no worktree)
# =============================================================================
cleanup_registry_only() {
  local search="$1"

  # Find agent using registry function
  local agent_info=$(registry_search_agent "$search" "$PROJECT_ROOT")

  if [ -z "$agent_info" ]; then
    log_error "No agent found in registry matching: $search"
    exit 1
  fi

  local agent_id=$(echo "$agent_info" | jq -r '.id')
  local task_dir=$(echo "$agent_info" | jq -r '.task_dir')

  echo ""
  echo -e "${BLUE}=== Cleanup Agent (no worktree) ===${NC}"
  echo "  Agent ID:  $agent_id"
  echo "  Task Dir:  $task_dir"
  echo ""

  # Confirmation
  if [ "$SKIP_CONFIRM" != "true" ]; then
    if [ -t 0 ]; then
      read -p "Archive task and remove from registry? [y/N] " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Aborted"
        exit 0
      fi
    else
      log_error "Non-interactive mode detected. Use -y to skip confirmation."
      exit 1
    fi
  fi

  # 1. Archive task directory if exists
  # Validate task path is safe
  if ! is_safe_task_path "$task_dir" "$PROJECT_ROOT" 2>/dev/null; then
    log_warn "Invalid task_dir in registry, skipping archive"
  else
    local task_dir_abs="${PROJECT_ROOT}/${task_dir}"
    if [ -d "$task_dir_abs" ]; then
    local result=$(archive_task_complete "$task_dir_abs" "$PROJECT_ROOT")

    echo "$result" | while IFS= read -r line; do
      case "$line" in
        task_completed:*)
          log_info "Completed task: ${line#task_completed:}"
          ;;
        archived_to:*)
          local dest="${line#archived_to:}"
          local task_name=$(basename "$dest")
          log_success "Archived task: $task_name -> archive/$(basename "$(dirname "$dest")")/"
          ;;
      esac
    done
    fi
  fi

  # 2. Remove from registry
  registry_remove_by_id "$agent_id" "$PROJECT_ROOT"
  log_success "Removed from registry: $agent_id"

  log_success "Cleanup complete"
}

# =============================================================================
# Cleanup Single Worktree
# =============================================================================
cleanup_worktree() {
  local branch="$1"

  cd "$PROJECT_ROOT"

  # Find worktree path for branch
  # porcelain format: worktree line comes BEFORE branch line, so use -B2
  local worktree_info=$(git worktree list --porcelain | grep -B2 "branch refs/heads/$branch" | head -3)
  local worktree_path=$(echo "$worktree_info" | grep "^worktree " | cut -d' ' -f2-)

  if [ -z "$worktree_path" ]; then
    # No worktree found, try to cleanup from registry only
    log_warn "No worktree found for: $branch"
    log_info "Trying to cleanup from registry..."
    cleanup_registry_only "$branch"
    return
  fi

  echo ""
  echo -e "${BLUE}=== Cleanup Worktree ===${NC}"
  echo "  Branch:   $branch"
  echo "  Worktree: $worktree_path"
  echo ""

  # Confirmation
  if [ "$SKIP_CONFIRM" != "true" ]; then
    # Check if running interactively
    if [ -t 0 ]; then
      read -p "Remove this worktree? [y/N] " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Aborted"
        exit 0
      fi
    else
      log_error "Non-interactive mode detected. Use -y to skip confirmation."
      exit 1
    fi
  fi

  # 1. Archive task
  archive_task "$worktree_path"

  # 2. Remove from registry
  registry_remove_by_worktree "$worktree_path" "$PROJECT_ROOT"
  log_info "Removed from registry"

  # 3. Remove worktree
  log_info "Removing worktree..."
  git worktree remove "$worktree_path" --force 2>/dev/null || rm -rf "$worktree_path"
  log_success "Worktree removed"

  # 4. Delete branch (optional)
  if [ "$KEEP_BRANCH" != "true" ]; then
    log_info "Deleting branch..."
    git branch -D "$branch" 2>/dev/null || log_warn "Could not delete branch (may be checked out elsewhere)"
  fi

  log_success "Cleanup complete for: $branch"
}

# =============================================================================
# Cleanup Merged Worktrees
# =============================================================================
cmd_merged() {
  cd "$PROJECT_ROOT"

  local main_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

  echo -e "${BLUE}=== Finding Merged Worktrees ===${NC}"
  echo ""

  local merged_branches=$(git branch --merged "$main_branch" | grep -v "^\*" | grep -v "$main_branch" | tr -d ' ')

  if [ -z "$merged_branches" ]; then
    log_info "No merged branches found"
    exit 0
  fi

  local worktree_branches=""
  while IFS= read -r branch; do
    if git worktree list | grep -q "\[$branch\]"; then
      worktree_branches="$worktree_branches $branch"
      echo "  - $branch"
    fi
  done <<< "$merged_branches"

  if [ -z "$worktree_branches" ]; then
    log_info "No merged worktrees found"
    exit 0
  fi

  echo ""

  if [ "$SKIP_CONFIRM" != "true" ]; then
    if [ -t 0 ]; then
      read -p "Remove these merged worktrees? [y/N] " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Aborted"
        exit 0
      fi
    else
      log_error "Non-interactive mode detected. Use -y to skip confirmation."
      exit 1
    fi
  fi

  for branch in $worktree_branches; do
    cleanup_worktree "$branch"
  done
}

# =============================================================================
# Cleanup All Worktrees
# =============================================================================
cmd_all() {
  cd "$PROJECT_ROOT"

  echo -e "${BLUE}=== All Worktrees ===${NC}"
  echo ""

  local worktrees=$(git worktree list --porcelain | grep "^worktree " | grep -v "$PROJECT_ROOT$" | cut -d' ' -f2-)

  if [ -z "$worktrees" ]; then
    log_info "No worktrees to remove"
    exit 0
  fi

  while IFS= read -r wt; do
    echo "  - $wt"
  done <<< "$worktrees"

  echo ""

  if [ "$SKIP_CONFIRM" != "true" ]; then
    if [ -t 0 ]; then
      echo -e "${RED}WARNING: This will remove ALL worktrees!${NC}"
      read -p "Are you sure? [y/N] " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Aborted"
        exit 0
      fi
    else
      log_error "Non-interactive mode detected. Use -y to skip confirmation."
      exit 1
    fi
  fi

  while IFS= read -r wt; do
    local branch=$(git worktree list | grep "$wt" | awk '{print $NF}' | tr -d '[]')
    if [ -n "$branch" ]; then
      cleanup_worktree "$branch"
    fi
  done <<< "$worktrees"
}

# =============================================================================
# Main
# =============================================================================
case "${ACTION:-}" in
  list)
    cmd_list
    ;;
  merged)
    cmd_merged
    ;;
  all)
    cmd_all
    ;;
  *)
    if [ ${#POSITIONAL_ARGS[@]} -eq 0 ]; then
      echo "Usage:"
      echo "  $0 <branch-name>      Remove specific worktree"
      echo "  $0 --list             List all worktrees"
      echo "  $0 --merged           Remove merged worktrees"
      echo "  $0 --all              Remove all worktrees"
      echo ""
      echo "Options:"
      echo "  -y, --yes             Skip confirmation"
      echo "  --keep-branch         Don't delete git branch"
      exit 1
    fi
    cleanup_worktree "${POSITIONAL_ARGS[0]}"
    ;;
esac
