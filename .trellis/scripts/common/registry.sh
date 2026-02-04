#!/bin/bash
# Registry utility functions for multi-agent pipeline
#
# Usage: source this file in other scripts
#   source "$(dirname "$0")/common/registry.sh"
#
# Provides:
#   registry_get_file        - Get registry file path
#   registry_get_agent_by_id - Find agent by ID
#   registry_get_agent_by_worktree - Find agent by worktree path
#   registry_get_task_dir - Get task dir for a worktree
#   registry_remove_by_id    - Remove agent by ID
#   registry_remove_by_worktree - Remove agent by worktree path
#   registry_add_agent       - Add agent to registry

# Ensure dependencies are loaded
if ! type get_repo_root &>/dev/null; then
  echo "Error: paths.sh must be sourced before registry.sh" >&2
  exit 1
fi

if ! type get_agents_dir &>/dev/null; then
  echo "Error: developer.sh must be sourced before registry.sh" >&2
  exit 1
fi

# =============================================================================
# Registry File Access
# =============================================================================

# Get registry file path
# Args: [repo_root]
# Returns: path to registry.json
registry_get_file() {
  local repo_root="${1:-$(get_repo_root)}"
  local agents_dir=$(get_agents_dir "$repo_root")
  echo "${agents_dir}/registry.json"
}

# Ensure registry file exists with valid structure
# Args: [repo_root]
_ensure_registry() {
  local repo_root="${1:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")
  local agents_dir=$(dirname "$registry_file")

  mkdir -p "$agents_dir"

  if [[ ! -f "$registry_file" ]]; then
    echo '{"agents":[]}' > "$registry_file"
  fi
}

# =============================================================================
# Agent Lookup
# =============================================================================

# Get agent by ID
# Args: agent_id, [repo_root]
# Returns: agent JSON object (compact), or empty if not found
registry_get_agent_by_id() {
  local agent_id="$1"
  local repo_root="${2:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")

  if [[ ! -f "$registry_file" ]]; then
    return 1
  fi

  local agent=$(jq -c --arg id "$agent_id" '.agents[] | select(.id == $id)' "$registry_file" 2>/dev/null)

  if [[ -n "$agent" ]] && [[ "$agent" != "null" ]]; then
    echo "$agent"
    return 0
  fi

  return 1
}

# Get agent by worktree path
# Args: worktree_path, [repo_root]
# Returns: agent JSON object (compact), or empty if not found
registry_get_agent_by_worktree() {
  local worktree_path="$1"
  local repo_root="${2:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")

  if [[ ! -f "$registry_file" ]]; then
    return 1
  fi

  local agent=$(jq -c --arg path "$worktree_path" '.agents[] | select(.worktree_path == $path)' "$registry_file" 2>/dev/null)

  if [[ -n "$agent" ]] && [[ "$agent" != "null" ]]; then
    echo "$agent"
    return 0
  fi

  return 1
}

# Search agent by ID or task_dir containing search term
# Args: search_term, [repo_root]
# Returns: first matching agent JSON object (compact), or empty if not found
registry_search_agent() {
  local search="$1"
  local repo_root="${2:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")

  if [[ ! -f "$registry_file" ]]; then
    return 1
  fi

  local agent=$(jq -c --arg search "$search" \
    '[.agents[] | select(.id == $search or (.task_dir | contains($search)))] | first' \
    "$registry_file" 2>/dev/null)

  if [[ -n "$agent" ]] && [[ "$agent" != "null" ]]; then
    echo "$agent"
    return 0
  fi

  return 1
}

# Get task directory for a worktree
# Args: worktree_path, [repo_root]
# Returns: task_dir value, or empty if not found
registry_get_task_dir() {
  local worktree_path="$1"
  local repo_root="${2:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")

  if [[ ! -f "$registry_file" ]]; then
    return 1
  fi

  local task_dir=$(jq -r --arg path "$worktree_path" \
    '.agents[] | select(.worktree_path == $path) | .task_dir' \
    "$registry_file" 2>/dev/null)

  if [[ -n "$task_dir" ]] && [[ "$task_dir" != "null" ]]; then
    echo "$task_dir"
    return 0
  fi

  return 1
}

# =============================================================================
# Agent Modification
# =============================================================================

# Remove agent by ID
# Args: agent_id, [repo_root]
# Returns: 0 on success
registry_remove_by_id() {
  local agent_id="$1"
  local repo_root="${2:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")

  if [[ ! -f "$registry_file" ]]; then
    return 0
  fi

  local updated=$(jq --arg id "$agent_id" \
    '.agents = [.agents[] | select(.id != $id)]' \
    "$registry_file")

  echo "$updated" | jq '.' > "$registry_file"
  return 0
}

# Remove agent by worktree path
# Args: worktree_path, [repo_root]
# Returns: 0 on success
registry_remove_by_worktree() {
  local worktree_path="$1"
  local repo_root="${2:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")

  if [[ ! -f "$registry_file" ]]; then
    return 0
  fi

  local updated=$(jq --arg path "$worktree_path" \
    '.agents = [.agents[] | select(.worktree_path != $path)]' \
    "$registry_file")

  echo "$updated" | jq '.' > "$registry_file"
  return 0
}

# Add agent to registry (replaces if same ID exists)
# Args: agent_id, worktree_path, pid, task_dir, [repo_root]
# Returns: 0 on success
registry_add_agent() {
  local agent_id="$1"
  local worktree_path="$2"
  local pid="$3"
  local task_dir="$4"
  local repo_root="${5:-$(get_repo_root)}"

  _ensure_registry "$repo_root"
  local registry_file=$(registry_get_file "$repo_root")

  local started_at=$(date -Iseconds)

  # Remove existing agent with same ID
  local registry=$(jq --arg id "$agent_id" \
    '.agents = [.agents[] | select(.id != $id)]' \
    "$registry_file")

  # Create new agent record
  local new_agent=$(jq -n \
    --arg id "$agent_id" \
    --arg worktree "$worktree_path" \
    --arg pid "$pid" \
    --arg started_at "$started_at" \
    --arg task_dir "$task_dir" \
    '{
      id: $id,
      worktree_path: $worktree,
      pid: ($pid | tonumber),
      started_at: $started_at,
      task_dir: $task_dir
    }')

  # Add to registry
  echo "$registry" | jq --argjson agent "$new_agent" '.agents += [$agent]' > "$registry_file"
  return 0
}

# List all agents
# Args: [repo_root]
# Returns: JSON array of agents
registry_list_agents() {
  local repo_root="${1:-$(get_repo_root)}"
  local registry_file=$(registry_get_file "$repo_root")

  if [[ ! -f "$registry_file" ]]; then
    echo '[]'
    return 0
  fi

  jq '.agents' "$registry_file"
}
