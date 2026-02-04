#!/bin/bash
# =============================================================================
# Multi-Agent Pipeline: Status Monitor
# =============================================================================
# Usage:
#   ./status.sh                     Show summary of all tasks (default)
#   ./status.sh -a <assignee>       Filter tasks by assignee
#   ./status.sh --list              List all worktrees and agents
#   ./status.sh --detail <task>     Detailed task status
#   ./status.sh --watch <task>      Watch agent log in real-time
#   ./status.sh --log <task>        Show recent log entries
#   ./status.sh --registry          Show agent registry
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../common/paths.sh"
source "$SCRIPT_DIR/../common/worktree.sh"
source "$SCRIPT_DIR/../common/developer.sh"
source "$SCRIPT_DIR/../common/phase.sh"
source "$SCRIPT_DIR/../common/task-queue.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

PROJECT_ROOT=$(get_repo_root)

# =============================================================================
# Parse Arguments
# =============================================================================
ACTION="summary"
TARGET=""
FILTER_ASSIGNEE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -a|--assignee)
      FILTER_ASSIGNEE="$2"
      shift 2
      ;;
    --list)
      ACTION="list"
      shift
      ;;
    --detail)
      ACTION="detail"
      TARGET="$2"
      shift 2
      ;;
    --watch)
      ACTION="watch"
      TARGET="$2"
      shift 2
      ;;
    --log)
      ACTION="log"
      TARGET="$2"
      shift 2
      ;;
    --progress)
      ACTION="progress"
      TARGET="$2"
      shift 2
      ;;
    --registry)
      ACTION="registry"
      shift
      ;;
    -h|--help)
      ACTION="help"
      shift
      ;;
    *)
      TARGET="$1"
      shift
      ;;
  esac
done

# =============================================================================
# Helper Functions
# =============================================================================

# Check if PID is running
is_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Get status color
status_color() {
  local status="$1"
  case "$status" in
    completed) echo "${GREEN}" ;;
    in_progress) echo "${BLUE}" ;;
    planning) echo "${YELLOW}" ;;
    *) echo "${DIM}" ;;
  esac
}

# Find agent by task name or ID
find_agent() {
  local search="$1"
  AGENTS_DIR=$(get_agents_dir)
  REGISTRY_FILE="${AGENTS_DIR}/registry.json"

  if [ ! -f "$REGISTRY_FILE" ]; then
    return 1
  fi

  # Try exact ID match first (use -c for compact single-line JSON output)
  local agent=$(jq -c --arg id "$search" '.agents[] | select(.id == $id)' "$REGISTRY_FILE" 2>/dev/null)

  # Try partial match on task_dir (use -c for compact single-line JSON output)
  if [ -z "$agent" ] || [ "$agent" = "null" ]; then
    agent=$(jq -c --arg search "$search" '[.agents[] | select(.task_dir | contains($search))] | first' "$REGISTRY_FILE" 2>/dev/null)
  fi

  echo "$agent"
}

# Get the last tool call from agent log
get_last_tool() {
  local log_file="$1"
  if [ ! -f "$log_file" ]; then
    echo ""
    return
  fi
  # Use tail -r on macOS, tac on Linux
  if command -v tac &>/dev/null; then
    tac "$log_file" 2>/dev/null | head -100 | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' 2>/dev/null | head -1
  else
    tail -r "$log_file" 2>/dev/null | head -100 | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' 2>/dev/null | head -1
  fi
}

# Get the last assistant text from agent log
get_last_message() {
  local log_file="$1"
  local max_len="${2:-100}"
  if [ ! -f "$log_file" ]; then
    echo ""
    return
  fi
  local text
  # Use tail -r on macOS, tac on Linux
  if command -v tac &>/dev/null; then
    text=$(tac "$log_file" 2>/dev/null | head -100 | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' 2>/dev/null | head -1)
  else
    text=$(tail -r "$log_file" 2>/dev/null | head -100 | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' 2>/dev/null | head -1)
  fi
  if [ -n "$text" ] && [ "$text" != "null" ]; then
    echo "${text:0:$max_len}"
  fi
}

# Get recent task notifications from agent log
# Looks for async_launched tasks and infers completion from current_phase
get_recent_tasks() {
  local log_file="$1"
  local count="${2:-5}"
  local current_phase="${3:-0}"
  if [ ! -f "$log_file" ]; then
    return
  fi
  # Get async_launched tasks with phase number extracted from description
  tail -500 "$log_file" 2>/dev/null | jq -r --argjson current_phase "$current_phase" '
    select(.type=="user" and .tool_use_result.status == "async_launched" and .tool_use_result.description != null) |
    .tool_use_result.description as $desc |
    # Extract phase number from "Phase N:" pattern
    ($desc | capture("Phase (?<num>[0-9]+)") | .num | tonumber) as $phase_num |
    # If current_phase > this phase, it is completed
    (if $phase_num < $current_phase then "completed" else "async_launched" end) as $status |
    "\($status)|\($desc)"
  ' 2>/dev/null | tail -"$count"
}

# =============================================================================
# Commands
# =============================================================================

cmd_help() {
  cat << EOF
Multi-Agent Pipeline: Status Monitor

Usage:
  $0                         Show summary of all tasks
  $0 -a <assignee>           Filter tasks by assignee
  $0 --list                  List all worktrees and agents
  $0 --detail <task>         Detailed task status
  $0 --progress <task>       Quick progress view with recent activity
  $0 --watch <task>          Watch agent log in real-time
  $0 --log <task>            Show recent log entries
  $0 --registry              Show agent registry

Examples:
  $0 -a john
  $0 --detail my-task
  $0 --progress my-task
  $0 --watch 01-16-worktree-support
  $0 --log worktree-support
EOF
}

cmd_list() {
  echo -e "${BLUE}=== Git Worktrees ===${NC}"
  echo ""
  cd "$PROJECT_ROOT"
  git worktree list
  echo ""

  echo -e "${BLUE}=== Registered Agents ===${NC}"
  echo ""

  AGENTS_DIR=$(get_agents_dir)
  REGISTRY_FILE="${AGENTS_DIR}/registry.json"

  if [ ! -f "$REGISTRY_FILE" ]; then
    echo "  (no registry found)"
    return
  fi

  local agents=$(jq -r '.agents[]' "$REGISTRY_FILE" 2>/dev/null)
  if [ -z "$agents" ]; then
    echo "  (no agents registered)"
    return
  fi

  jq -r '.agents[] | "\(.id)|\(.pid)|\(.worktree_path)|\(.started_at)"' "$REGISTRY_FILE" 2>/dev/null | while IFS='|' read -r id pid wt started; do
    local status_icon
    if is_running "$pid"; then
      status_icon="${GREEN}●${NC}"
    else
      status_icon="${RED}○${NC}"
    fi
    echo -e "  $status_icon $id (PID: $pid)"
    echo -e "    ${DIM}Worktree: $wt${NC}"
    echo -e "    ${DIM}Started:  $started${NC}"
    echo ""
  done
}

# Calculate elapsed time from ISO timestamp
calc_elapsed() {
  local started="$1"
  if [ -z "$started" ] || [ "$started" = "null" ]; then
    echo "N/A"
    return
  fi

  # Parse started time (handle both formats: with and without timezone)
  local start_epoch
  if command -v gdate &>/dev/null; then
    start_epoch=$(gdate -d "$started" +%s 2>/dev/null)
  else
    # Try to parse ISO format
    start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${started%%+*}" +%s 2>/dev/null || date -d "$started" +%s 2>/dev/null)
  fi

  if [ -z "$start_epoch" ]; then
    echo "N/A"
    return
  fi

  local now_epoch=$(date +%s)
  local elapsed=$((now_epoch - start_epoch))

  if [ $elapsed -lt 60 ]; then
    echo "${elapsed}s"
  elif [ $elapsed -lt 3600 ]; then
    echo "$((elapsed / 60))m $((elapsed % 60))s"
  else
    echo "$((elapsed / 3600))h $((elapsed % 3600 / 60))m"
  fi
}

# Note: get_phase_info is now in common/phase.sh

# Count modified files in worktree
count_modified_files() {
  local worktree="$1"
  if [ -d "$worktree" ]; then
    cd "$worktree" && git status --short 2>/dev/null | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

cmd_summary() {
  ensure_developer

  local tasks_dir=$(get_tasks_dir)
  if [ ! -d "$tasks_dir" ]; then
    echo "No tasks directory found"
    exit 0
  fi

  AGENTS_DIR=$(get_agents_dir)
  REGISTRY_FILE="${AGENTS_DIR}/registry.json"

  # Count running agents
  local running_count=0
  local total_agents=0
  if [ -f "$REGISTRY_FILE" ]; then
    total_agents=$(jq -r '.agents | length' "$REGISTRY_FILE" 2>/dev/null || echo "0")
    while read -r pid; do
      is_running "$pid" && ((running_count++))
    done < <(jq -r '.agents[].pid' "$REGISTRY_FILE" 2>/dev/null)
  fi

  # Task queue stats
  local task_stats=$(get_task_stats "$PROJECT_ROOT")

  echo -e "${BLUE}=== Multi-Agent Status ===${NC}"
  echo -e "  Agents:  ${GREEN}${running_count}${NC} running / ${total_agents} registered"
  echo -e "  Tasks:   ${task_stats}"
  echo ""

  # Use temp files for grouping (compatible with old bash)
  local tmp_dir=$(mktemp -d)
  local running_file="$tmp_dir/running"
  local stopped_file="$tmp_dir/stopped"
  local tasks_file="$tmp_dir/tasks"
  touch "$running_file" "$stopped_file" "$tasks_file"

  local has_running_agent=false

  for d in "$tasks_dir"/*/; do
    [ ! -d "$d" ] && continue
    [[ "$(basename "$d")" == "archive" ]] && continue

    local name=$(basename "$d")
    local task_json="$d/task.json"
    local status="unknown"
    local assignee="unassigned"
    local priority="P2"

    if [ -f "$task_json" ]; then
      status=$(jq -r '.status // "unknown"' "$task_json")
      assignee=$(jq -r '.assignee // "unassigned"' "$task_json")
      priority=$(jq -r '.priority // "P2"' "$task_json")
    fi

    # Filter by assignee if specified
    if [ -n "$FILTER_ASSIGNEE" ] && [ "$assignee" != "$FILTER_ASSIGNEE" ]; then
      continue
    fi

    # Check agent status
    local agent_info=""
    local pid=""
    local worktree=""
    local started=""
    local is_agent_running=false

    if [ -f "$REGISTRY_FILE" ]; then
      agent_info=$(jq -c --arg name "$name" '[.agents[] | select(.task_dir | contains($name))] | first' "$REGISTRY_FILE" 2>/dev/null)
      if [ -n "$agent_info" ] && [ "$agent_info" != "null" ]; then
        pid=$(echo "$agent_info" | jq -r '.pid')
        worktree=$(echo "$agent_info" | jq -r '.worktree_path')
        started=$(echo "$agent_info" | jq -r '.started_at')
        if is_running "$pid"; then
          is_agent_running=true
          has_running_agent=true
        fi
      fi
    fi

    local color=$(status_color "$status")

    # Color priority
    local priority_color="${NC}"
    case "$priority" in
      P0) priority_color="${RED}" ;;
      P1) priority_color="${YELLOW}" ;;
      P2) priority_color="${BLUE}" ;;
    esac

    if [ "$is_agent_running" = true ]; then
      # Running agent
      local task_dir_rel=$(echo "$agent_info" | jq -r '.task_dir')
      local worktree_task_json="$worktree/$task_dir_rel/task.json"
      local phase_source="$task_json"
      [ -f "$worktree_task_json" ] && phase_source="$worktree_task_json"

      local phase_info=$(get_phase_info "$phase_source")
      local elapsed=$(calc_elapsed "$started")
      local modified=$(count_modified_files "$worktree")
      local branch=$(jq -r '.branch // "N/A"' "$phase_source" 2>/dev/null)
      local log_file="$worktree/.agent-log"
      local last_tool=$(get_last_tool "$log_file")

      {
        echo -e "${GREEN}▶${NC} ${CYAN}${name}${NC} ${GREEN}[running]${NC} ${priority_color}[${priority}]${NC} @${assignee}"
        echo -e "  Phase:    ${phase_info}"
        echo -e "  Elapsed:  ${elapsed}"
        echo -e "  Branch:   ${DIM}${branch}${NC}"
        echo -e "  Modified: ${modified} file(s)"
        [ -n "$last_tool" ] && echo -e "  Activity: ${YELLOW}${last_tool}${NC}"
        echo -e "  PID:      ${DIM}${pid}${NC}"
        echo ""
      } >> "$running_file"

    elif [ -n "$agent_info" ] && [ "$agent_info" != "null" ]; then
      # Stopped agent - check if completed or interrupted
      local task_dir_rel=$(echo "$agent_info" | jq -r '.task_dir')
      local worktree_task_json="$worktree/$task_dir_rel/task.json"
      local worktree_status="unknown"
      if [ -f "$worktree_task_json" ]; then
        worktree_status=$(jq -r '.status // "unknown"' "$worktree_task_json")
      fi

      if [ "$worktree_status" = "completed" ]; then
        # Agent completed successfully
        {
          echo -e "${GREEN}✓${NC} ${name} ${GREEN}[completed]${NC}"
          echo ""
        } >> "$stopped_file"
      else
        # Agent was interrupted/blocked
        {
          local session_id_file="${worktree}/.session-id"
          local log_file="$worktree/.agent-log"
          local last_msg=$(get_last_message "$log_file" 150)

          if [ -f "$session_id_file" ]; then
            local session_id=$(cat "$session_id_file")
            echo -e "${RED}○${NC} ${name} ${RED}[stopped]${NC}"
            if [ -n "$last_msg" ]; then
              echo -e "${DIM}\"${last_msg}\"${NC}"
            fi
            echo -e "${YELLOW}cd ${worktree} && claude --resume ${session_id}${NC}"
          else
            echo -e "${RED}○${NC} ${name} ${RED}[stopped]${NC} ${DIM}(no session-id)${NC}"
          fi
          echo ""
        } >> "$stopped_file"
      fi

    else
      # Normal task - store with assignee + priority_order + status_order + date for sorting
      # Priority order: P0=0, P1=1, P2=2, P3=3 (lower = higher priority)
      local priority_order="2"
      case "$priority" in
        P0) priority_order="0" ;;
        P1) priority_order="1" ;;
        P2) priority_order="2" ;;
        P3) priority_order="3" ;;
      esac
      # Status order: in_progress=0, planning=1, completed=2 (lower = show first)
      local status_order="1"
      case "$status" in
        in_progress) status_order="0" ;;
        planning) status_order="1" ;;
        completed) status_order="2" ;;
      esac
      # Extract date from name (MM-DD) for sorting, use reverse for desc
      # Name format: MM-DD-xxx, extract MM-DD part and invert for desc sort
      local date_part=$(echo "$name" | grep -oE '^[0-9]{2}-[0-9]{2}' || echo "00-00")
      echo -e "${assignee}\t${priority_order}\t${status_order}\t${date_part}\t${color}●${NC} ${name} (${status}) ${priority_color}[${priority}]${NC}" >> "$tasks_file"
    fi
  done

  # Output running agents first
  if [ -s "$running_file" ]; then
    echo -e "${CYAN}Running Agents:${NC}"
    cat "$running_file"
  fi

  # Output stopped agents
  if [ -s "$stopped_file" ]; then
    echo -e "${RED}Stopped Agents:${NC}"
    cat "$stopped_file"
  fi

  # Separator between agents and tasks
  if [ -s "$running_file" ] || [ -s "$stopped_file" ]; then
    if [ -s "$tasks_file" ]; then
      echo -e "${DIM}───────────────────────────────────────${NC}"
      echo ""
    fi
  fi

  # Output tasks grouped by assignee, sorted by priority > status > date(desc)
  if [ -s "$tasks_file" ]; then
    local current_assignee=""
    # Sort: assignee(asc), priority(asc), status(asc), date(desc/reverse)
    sort -t$'\t' -k1,1 -k2,2n -k3,3n -k4,4r "$tasks_file" | while IFS=$'\t' read -r assignee priority_order status_order date_part task_line; do
      if [ "$assignee" != "$current_assignee" ]; then
        [ -n "$current_assignee" ] && echo ""
        echo -e "${CYAN}@${assignee}:${NC}"
        current_assignee="$assignee"
      fi
      echo -e "  $task_line"
    done
  fi

  # Cleanup
  rm -rf "$tmp_dir"

  if [ "$has_running_agent" = true ]; then
    echo ""
    echo -e "${DIM}─────────────────────────────────────${NC}"
    echo -e "${DIM}Use --progress <name> for quick activity view${NC}"
    echo -e "${DIM}Use --detail <name> for more info${NC}"
  fi
  echo ""
}

cmd_progress() {
  if [ -z "$TARGET" ]; then
    echo "Usage: $0 --progress <task>"
    exit 1
  fi

  local agent=$(find_agent "$TARGET")
  if [ -z "$agent" ] || [ "$agent" = "null" ]; then
    echo "Agent not found: $TARGET"
    exit 1
  fi

  local id=$(echo "$agent" | jq -r '.id')
  local pid=$(echo "$agent" | jq -r '.pid')
  local worktree=$(echo "$agent" | jq -r '.worktree_path')
  local task_dir=$(echo "$agent" | jq -r '.task_dir')
  local started=$(echo "$agent" | jq -r '.started_at')
  local log_file="$worktree/.agent-log"

  if [ ! -f "$log_file" ]; then
    echo "Log file not found: $log_file"
    exit 1
  fi

  # Get phase info from worktree's task.json
  local worktree_task_json="$worktree/$task_dir/task.json"
  local phase_info="N/A"
  local current_phase=0
  if [ -f "$worktree_task_json" ]; then
    phase_info=$(get_phase_info "$worktree_task_json")
    current_phase=$(jq -r '.current_phase // 0' "$worktree_task_json")
  fi

  local elapsed=$(calc_elapsed "$started")
  local modified=$(count_modified_files "$worktree")

  # Check if running
  local status_str
  if is_running "$pid"; then
    status_str="${GREEN}running${NC}"
  else
    status_str="${RED}stopped${NC}"
  fi

  echo ""
  echo -e "${BLUE}=== Progress: ${id} ===${NC}"
  echo ""

  # Basic info (like summary)
  echo -e "${CYAN}Status:${NC}"
  echo -e "  State:    ${status_str}"
  echo -e "  Phase:    ${phase_info}"
  echo -e "  Elapsed:  ${elapsed}"
  echo -e "  Modified: ${modified} file(s)"
  echo ""

  # Recent task notifications
  echo -e "${CYAN}Recent Tasks:${NC}"
  local has_tasks=false
  while IFS='|' read -r status summary; do
    [ -z "$status" ] && continue
    has_tasks=true
    local icon
    case "$status" in
      completed) icon="${GREEN}✓${NC}" ;;
      failed) icon="${RED}✗${NC}" ;;
      async_launched) icon="${BLUE}▶${NC}" ;;
      *) icon="${YELLOW}○${NC}" ;;
    esac
    echo -e "  ${icon} ${summary}"
  done < <(get_recent_tasks "$log_file" 5 "$current_phase")

  if [ "$has_tasks" = false ]; then
    echo -e "  ${DIM}(no task notifications yet)${NC}"
  fi
  echo ""

  # Current activity
  echo -e "${CYAN}Current Activity:${NC}"
  local last_tool=$(get_last_tool "$log_file")
  if [ -n "$last_tool" ]; then
    echo -e "  Tool: ${YELLOW}${last_tool}${NC}"
  else
    echo -e "  ${DIM}(no recent tool calls)${NC}"
  fi
  echo ""

  # Last message
  echo -e "${CYAN}Last Message:${NC}"
  local last_msg=$(get_last_message "$log_file" 200)
  if [ -n "$last_msg" ]; then
    echo -e "  \"${last_msg}...\""
  else
    echo -e "  ${DIM}(no recent messages)${NC}"
  fi
  echo ""
}

cmd_detail() {
  if [ -z "$TARGET" ]; then
    echo "Usage: $0 --detail <task>"
    exit 1
  fi

  local agent=$(find_agent "$TARGET")
  if [ -z "$agent" ] || [ "$agent" = "null" ]; then
    echo "Agent not found: $TARGET"
    exit 1
  fi

  local id=$(echo "$agent" | jq -r '.id')
  local pid=$(echo "$agent" | jq -r '.pid')
  local worktree=$(echo "$agent" | jq -r '.worktree_path')
  local task_dir=$(echo "$agent" | jq -r '.task_dir')
  local started=$(echo "$agent" | jq -r '.started_at')

  # Check for session-id
  local session_id=""
  local session_id_file="${worktree}/.session-id"
  if [ -f "$session_id_file" ]; then
    session_id=$(cat "$session_id_file")
  fi

  echo -e "${BLUE}=== Agent Detail: $id ===${NC}"
  echo ""
  echo "  ID:        $id"
  echo "  PID:       $pid"
  echo "  Session:   ${session_id:-N/A}"
  echo "  Worktree:  $worktree"
  echo "  Task Dir:  $task_dir"
  echo "  Started:   $started"
  echo ""

  # Status
  if is_running "$pid"; then
    echo -e "  Status:    ${GREEN}Running${NC}"
  else
    echo -e "  Status:    ${RED}Stopped${NC}"
    if [ -n "$session_id" ]; then
      echo ""
      echo -e "  ${YELLOW}Resume:${NC} cd ${worktree} && claude --resume ${session_id}"
    fi
  fi

  # Task info
  local task_json="$PROJECT_ROOT/$task_dir/task.json"
  if [ -f "$task_json" ]; then
    echo ""
    echo -e "${BLUE}=== Task Info ===${NC}"
    echo ""
    local status=$(jq -r '.status // "unknown"' "$task_json")
    local branch=$(jq -r '.branch // "N/A"' "$task_json")
    local base=$(jq -r '.base_branch // "N/A"' "$task_json")
    echo "  Status:      $status"
    echo "  Branch:      $branch"
    echo "  Base Branch: $base"
  fi

  # Git changes
  if [ -d "$worktree" ]; then
    echo ""
    echo -e "${BLUE}=== Git Changes ===${NC}"
    echo ""
    cd "$worktree"
    local changes=$(git status --short 2>/dev/null | head -10)
    if [ -n "$changes" ]; then
      echo "$changes" | sed 's/^/  /'
      local total=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
      if [ "$total" -gt 10 ]; then
        echo "  ... and $((total - 10)) more"
      fi
    else
      echo "  (no changes)"
    fi
  fi

  echo ""
}

cmd_watch() {
  if [ -z "$TARGET" ]; then
    echo "Usage: $0 --watch <task>"
    exit 1
  fi

  local agent=$(find_agent "$TARGET")
  if [ -z "$agent" ] || [ "$agent" = "null" ]; then
    echo "Agent not found: $TARGET"
    exit 1
  fi

  local worktree=$(echo "$agent" | jq -r '.worktree_path')
  local log_file="$worktree/.agent-log"

  if [ ! -f "$log_file" ]; then
    echo "Log file not found: $log_file"
    exit 1
  fi

  echo -e "${BLUE}Watching:${NC} $log_file"
  echo -e "${DIM}Press Ctrl+C to stop${NC}"
  echo ""

  tail -f "$log_file"
}

cmd_log() {
  if [ -z "$TARGET" ]; then
    echo "Usage: $0 --log <task>"
    exit 1
  fi

  local agent=$(find_agent "$TARGET")
  if [ -z "$agent" ] || [ "$agent" = "null" ]; then
    echo "Agent not found: $TARGET"
    exit 1
  fi

  local worktree=$(echo "$agent" | jq -r '.worktree_path')
  local log_file="$worktree/.agent-log"

  if [ ! -f "$log_file" ]; then
    echo "Log file not found: $log_file"
    exit 1
  fi

  echo -e "${BLUE}=== Recent Log: $TARGET ===${NC}"
  echo ""

  # Parse and format JSON log entries
  tail -50 "$log_file" | while IFS= read -r line; do
    local type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
    [ -z "$type" ] && continue

    case "$type" in
      system)
        local subtype=$(echo "$line" | jq -r '.subtype // ""' 2>/dev/null)
        echo -e "${CYAN}[SYSTEM]${NC} $subtype"
        ;;
      user)
        local content=$(echo "$line" | jq -r '.message.content // empty' 2>/dev/null)
        if [ -n "$content" ] && [ "$content" != "null" ]; then
          echo -e "${GREEN}[USER]${NC} ${content:0:200}"
        fi
        ;;
      assistant)
        # Extract text or tool use
        local text=$(echo "$line" | jq -r '.message.content[0].text // empty' 2>/dev/null)
        local tool=$(echo "$line" | jq -r '.message.content[0].name // empty' 2>/dev/null)

        if [ -n "$text" ] && [ "$text" != "null" ]; then
          # Truncate long text
          local display="${text:0:300}"
          [ ${#text} -gt 300 ] && display="$display..."
          echo -e "${BLUE}[ASSISTANT]${NC} $display"
        elif [ -n "$tool" ] && [ "$tool" != "null" ]; then
          echo -e "${YELLOW}[TOOL]${NC} $tool"
        fi
        ;;
      result)
        local tool_name=$(echo "$line" | jq -r '.tool // "unknown"' 2>/dev/null)
        echo -e "${DIM}[RESULT]${NC} $tool_name completed"
        ;;
    esac
  done
}

cmd_registry() {
  AGENTS_DIR=$(get_agents_dir)
  REGISTRY_FILE="${AGENTS_DIR}/registry.json"

  echo -e "${BLUE}=== Agent Registry ===${NC}"
  echo ""
  echo "File: $REGISTRY_FILE"
  echo ""

  if [ -f "$REGISTRY_FILE" ]; then
    jq '.' "$REGISTRY_FILE"
  else
    echo "(registry not found)"
  fi
}

# =============================================================================
# Main
# =============================================================================
case "$ACTION" in
  help)
    cmd_help
    ;;
  list)
    cmd_list
    ;;
  summary)
    cmd_summary
    ;;
  progress)
    cmd_progress
    ;;
  detail)
    cmd_detail
    ;;
  watch)
    cmd_watch
    ;;
  log)
    cmd_log
    ;;
  registry)
    cmd_registry
    ;;
esac
