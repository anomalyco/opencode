#!/bin/bash

# Experiment Worktree Manager
# Creates, cleans up, and manages worktrees for optimization experiments.
# Each experiment gets an isolated worktree with copied shared resources.
#
# Usage:
#   experiment-worktree.sh create <spec_name> <exp_index> <base_branch> [shared_file ...]
#   experiment-worktree.sh cleanup <spec_name> <exp_index>
#   experiment-worktree.sh cleanup-all <spec_name>
#   experiment-worktree.sh count
#
# Worktrees are created at: .worktrees/optimize-<spec>-exp-<NNN>/
# Branches are named: optimize-exp/<spec>/exp-<NNN>

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo -e "${RED}Error: Not in a git repository${NC}" >&2
  exit 1
}

WORKTREE_DIR="$GIT_ROOT/.worktrees"

experiment_branch_name() {
  local spec_name="${1:?Error: spec_name required}"
  local padded_index="${2:?Error: padded_index required}"

  # Keep experiment refs outside optimize/<spec> so they do not collide
  # with the long-lived optimization branch namespace.
  echo "optimize-exp/${spec_name}/exp-${padded_index}"
}

ensure_worktree_exclude() {
  local exclude_file
  exclude_file=$(git rev-parse --git-path info/exclude)

  mkdir -p "$(dirname "$exclude_file")"

  if ! grep -q "^\.worktrees$" "$exclude_file" 2>/dev/null; then
    echo ".worktrees" >> "$exclude_file"
  fi
}

is_registered_worktree() {
  local worktree_path="${1:?Error: worktree_path required}"

  git worktree list --porcelain | awk -v target="$worktree_path" '
    $1 == "worktree" && $2 == target { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

is_branch_checked_out() {
  local branch_name="${1:?Error: branch_name required}"
  local branch_ref="refs/heads/$branch_name"

  git worktree list --porcelain | awk -v target="$branch_ref" '
    $1 == "branch" && $2 == target { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

reset_worktree_to_base() {
  local worktree_path="${1:?Error: worktree_path required}"
  local branch_name="${2:?Error: branch_name required}"
  local base_branch="${3:?Error: base_branch required}"
  local current_branch

  current_branch=$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  if [[ "$current_branch" != "$branch_name" ]]; then
    echo -e "${RED}Error: Existing worktree is on unexpected branch: ${current_branch:-detached} (expected $branch_name)${NC}" >&2
    echo -e "${RED}Clean up the stale worktree before rerunning this experiment.${NC}" >&2
    return 1
  fi

  echo -e "${YELLOW}Resetting existing experiment worktree to base: $branch_name -> $base_branch${NC}" >&2
  git -C "$worktree_path" reset --hard "$base_branch" >/dev/null
  git -C "$worktree_path" clean -fdx >/dev/null
}

# Create an experiment worktree
create_worktree() {
  local spec_name="${1:?Error: spec_name required}"
  local exp_index="${2:?Error: exp_index required}"
  local base_branch="${3:?Error: base_branch required}"
  shift 3

  local padded_index
  padded_index=$(printf "%03d" "$exp_index")
  local worktree_name="optimize-${spec_name}-exp-${padded_index}"
  local branch_name
  branch_name=$(experiment_branch_name "$spec_name" "$padded_index")
  local worktree_path="$WORKTREE_DIR/$worktree_name"

  # Check if worktree already exists
  if [[ -d "$worktree_path" ]]; then
    if ! git -C "$worktree_path" rev-parse --is-inside-work-tree >/dev/null 2>&1 || \
       ! is_registered_worktree "$worktree_path"; then
      echo -e "${RED}Error: Existing path is not a valid registered git worktree: $worktree_path${NC}" >&2
      echo -e "${RED}Remove or repair that directory before rerunning the experiment.${NC}" >&2
      return 1
    fi

    echo -e "${YELLOW}Worktree already exists: $worktree_path${NC}" >&2
    reset_worktree_to_base "$worktree_path" "$branch_name" "$base_branch"
  else
    mkdir -p "$WORKTREE_DIR"
    ensure_worktree_exclude

    # Create worktree from the base branch
    if ! git worktree add -b "$branch_name" "$worktree_path" "$base_branch" --quiet 2>/dev/null; then
      if git show-ref --verify --quiet "refs/heads/$branch_name"; then
        if is_branch_checked_out "$branch_name"; then
          echo -e "${RED}Error: Existing experiment branch is already checked out: $branch_name${NC}" >&2
          echo -e "${RED}Clean up the stale worktree before rerunning this experiment.${NC}" >&2
          return 1
        fi

        echo -e "${YELLOW}Resetting existing experiment branch to base: $branch_name -> $base_branch${NC}" >&2
        git branch -f "$branch_name" "$base_branch" >/dev/null
        git worktree add "$worktree_path" "$branch_name" --quiet
      else
        echo -e "${RED}Error: Failed to create worktree for $branch_name from $base_branch${NC}" >&2
        return 1
      fi
    fi
  fi

  # Copy .env files from main repo
  for f in "$GIT_ROOT"/.env*; do
    if [[ -f "$f" ]]; then
      local basename
      basename=$(basename "$f")
      if [[ "$basename" != ".env.example" ]]; then
        cp "$f" "$worktree_path/$basename"
      fi
    fi
  done

  # Copy shared files
  for shared_file in "$@"; do
    if [[ -f "$GIT_ROOT/$shared_file" ]]; then
      local dir
      dir=$(dirname "$worktree_path/$shared_file")
      mkdir -p "$dir"
      cp "$GIT_ROOT/$shared_file" "$worktree_path/$shared_file"
    elif [[ -d "$GIT_ROOT/$shared_file" ]]; then
      local dir
      dir=$(dirname "$worktree_path/$shared_file")
      mkdir -p "$dir"
      rm -rf "$worktree_path/$shared_file"
      cp -R "$GIT_ROOT/$shared_file" "$worktree_path/$shared_file"
    fi
  done

  echo "$worktree_path"
}

# Clean up a single experiment worktree
cleanup_worktree() {
  local spec_name="${1:?Error: spec_name required}"
  local exp_index="${2:?Error: exp_index required}"

  local padded_index
  padded_index=$(printf "%03d" "$exp_index")
  local worktree_name="optimize-${spec_name}-exp-${padded_index}"
  local branch_name
  branch_name=$(experiment_branch_name "$spec_name" "$padded_index")
  local worktree_path="$WORKTREE_DIR/$worktree_name"

  if [[ -d "$worktree_path" ]]; then
    git worktree remove "$worktree_path" --force 2>/dev/null || {
      # If worktree remove fails, try manual cleanup
      rm -rf "$worktree_path" 2>/dev/null || true
      git worktree prune 2>/dev/null || true
    }
  fi

  # Delete the experiment branch
  git branch -D "$branch_name" 2>/dev/null || true

  echo -e "${GREEN}Cleaned up: $worktree_name${NC}" >&2
}

# Clean up all experiment worktrees for a spec
cleanup_all() {
  local spec_name="${1:?Error: spec_name required}"
  local prefix="optimize-${spec_name}-exp-"
  local count=0

  if [[ ! -d "$WORKTREE_DIR" ]]; then
    echo -e "${YELLOW}No worktrees directory found${NC}" >&2
    return 0
  fi

  for worktree_path in "$WORKTREE_DIR"/${prefix}*; do
    if [[ -d "$worktree_path" ]]; then
      local worktree_name
      worktree_name=$(basename "$worktree_path")
      # Extract index from name
      local index_str="${worktree_name#$prefix}"

      git worktree remove "$worktree_path" --force 2>/dev/null || {
        rm -rf "$worktree_path" 2>/dev/null || true
      }

      # Delete the branch
      local branch_name
      branch_name=$(experiment_branch_name "$spec_name" "$index_str")
      git branch -D "$branch_name" 2>/dev/null || true

      count=$((count + 1))
    fi
  done

  git worktree prune 2>/dev/null || true

  # Clean up empty worktree directory
  if [[ -d "$WORKTREE_DIR" ]] && [[ -z "$(ls -A "$WORKTREE_DIR" 2>/dev/null)" ]]; then
    rmdir "$WORKTREE_DIR" 2>/dev/null || true
  fi

  echo -e "${GREEN}Cleaned up $count experiment worktree(s) for $spec_name${NC}" >&2
}

# Count total worktrees (for budget check)
count_worktrees() {
  local count=0
  if [[ -d "$WORKTREE_DIR" ]]; then
    for worktree_path in "$WORKTREE_DIR"/*; do
      if [[ -d "$worktree_path" ]] && [[ -e "$worktree_path/.git" ]]; then
        count=$((count + 1))
      fi
    done
  fi
  echo "$count"
}

# Main
main() {
  local command="${1:-help}"

  case "$command" in
    create)
      shift
      create_worktree "$@"
      ;;
    cleanup)
      shift
      cleanup_worktree "$@"
      ;;
    cleanup-all)
      shift
      cleanup_all "$@"
      ;;
    count)
      count_worktrees
      ;;
    help)
      cat << 'EOF'
Experiment Worktree Manager

Usage:
  experiment-worktree.sh create <spec_name> <exp_index> <base_branch> [shared_file ...]
  experiment-worktree.sh cleanup <spec_name> <exp_index>
  experiment-worktree.sh cleanup-all <spec_name>
  experiment-worktree.sh count

Commands:
  create       Create an experiment worktree with copied shared files
  cleanup      Remove a single experiment worktree and its branch
  cleanup-all  Remove all experiment worktrees for a spec
  count        Count total active worktrees (for budget checking)

Worktrees:  .worktrees/optimize-<spec>-exp-<NNN>/
Branches:   optimize-exp/<spec>/exp-<NNN>
EOF
      ;;
    *)
      echo -e "${RED}Unknown command: $command${NC}" >&2
      exit 1
      ;;
  esac
}

main "$@"
