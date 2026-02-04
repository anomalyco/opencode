#!/bin/bash
# Worktree utilities for Multi-Agent Pipeline
#
# Usage: source this file in multi-agent scripts
#   source "$(dirname "$0")/../common/worktree.sh"
#
# Provides:
#   get_worktree_config         - Get worktree.yaml path
#   get_worktree_base_dir       - Get worktree storage directory
#   get_worktree_copy_files     - Get files to copy list
#   get_worktree_post_create_hooks - Get post-create hooks
#   get_agents_dir              - Get agents registry directory
#
# Requires: paths.sh (for get_repo_root)

# Ensure paths.sh is loaded
if ! type get_repo_root &>/dev/null; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  source "$SCRIPT_DIR/paths.sh"
fi

# =============================================================================
# Worktree Configuration
# =============================================================================

# Worktree config file relative path (relative to repo root)
WORKTREE_CONFIG_PATH="$DIR_WORKFLOW/worktree.yaml"

# Get worktree.yaml config file path
# Args: $1 - repo_root (optional)
# Returns: absolute path to config file
get_worktree_config() {
  local repo_root="${1:-$(get_repo_root)}"
  echo "$repo_root/$WORKTREE_CONFIG_PATH"
}

# Read simple value from worktree.yaml
# Args: $1 - key, $2 - config_file (optional)
# Returns: value
_yaml_get_value() {
  local key="$1"
  local config="${2:-$(get_worktree_config)}"
  grep "^${key}:" "$config" 2>/dev/null | sed "s/^${key}:[[:space:]]*//" | tr -d '"' | tr -d "'"
}

# Read list from worktree.yaml
# Args: $1 - section, $2 - config_file (optional)
# Returns: list items (one per line)
_yaml_get_list() {
  local section="$1"
  local config="${2:-$(get_worktree_config)}"
  local in_section=0

  while IFS= read -r line; do
    if [[ "$line" =~ ^${section}: ]]; then
      in_section=1
      continue
    fi

    if [ $in_section -eq 1 ]; then
      # Exit when encountering new top-level key
      if [[ "$line" =~ ^[a-z_]+: ]] && [[ ! "$line" =~ ^[[:space:]] ]]; then
        break
      fi
      # Read list item
      if [[ "$line" =~ ^[[:space:]]*-[[:space:]](.+)$ ]]; then
        echo "${BASH_REMATCH[1]}" | tr -d '"' | tr -d "'"
      fi
    fi
  done < "$config"
}

# Get worktree base directory
# Args: $1 - repo_root (optional)
# Returns: absolute path to worktree base directory
get_worktree_base_dir() {
  local repo_root="${1:-$(get_repo_root)}"
  local config=$(get_worktree_config "$repo_root")
  local worktree_dir=$(_yaml_get_value "worktree_dir" "$config")

  # Default value
  if [ -z "$worktree_dir" ]; then
    worktree_dir="../worktrees"
  fi

  # Handle relative path
  if [[ "$worktree_dir" == ../* ]] || [[ "$worktree_dir" == ./* ]]; then
    # Relative to repo_root
    echo "$repo_root/$worktree_dir"
  else
    # Absolute path
    echo "$worktree_dir"
  fi
}

# Get files to copy list
# Args: $1 - repo_root (optional)
# Returns: file list (one per line)
get_worktree_copy_files() {
  local repo_root="${1:-$(get_repo_root)}"
  local config=$(get_worktree_config "$repo_root")
  _yaml_get_list "copy" "$config"
}

# Get post_create hooks
# Args: $1 - repo_root (optional)
# Returns: command list (one per line)
get_worktree_post_create_hooks() {
  local repo_root="${1:-$(get_repo_root)}"
  local config=$(get_worktree_config "$repo_root")
  _yaml_get_list "post_create" "$config"
}

# =============================================================================
# Agents Registry
# =============================================================================

# Get agents directory for current developer
# Args: $1 - repo_root (optional)
# Returns: absolute path to agents directory
get_agents_dir() {
  local repo_root="${1:-$(get_repo_root)}"
  local workspace_dir=$(get_workspace_dir "$repo_root")

  if [[ -n "$workspace_dir" ]]; then
    echo "$workspace_dir/.agents"
  fi
}
