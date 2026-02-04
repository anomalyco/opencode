#!/bin/bash
# Task Management Script for Multi-Agent Pipeline
#
# Usage:
#   ./.trellis/scripts/task.sh create "<title>" [--slug <name>] [--assignee <dev>] [--priority P0|P1|P2|P3]
#   ./.trellis/scripts/task.sh init-context <dir> <type>   # Initialize jsonl files
#   ./.trellis/scripts/task.sh add-context <dir> <file> <path> [reason] # Add jsonl entry
#   ./.trellis/scripts/task.sh validate <dir>              # Validate jsonl files
#   ./.trellis/scripts/task.sh list-context <dir>          # List jsonl entries
#   ./.trellis/scripts/task.sh start <dir>                 # Set as current task
#   ./.trellis/scripts/task.sh finish                      # Clear current task
#   ./.trellis/scripts/task.sh set-branch <dir> <branch>   # Set git branch
#   ./.trellis/scripts/task.sh set-scope <dir> <scope>     # Set scope for PR title
#   ./.trellis/scripts/task.sh create-pr [dir] [--dry-run] # Create PR from task
#   ./.trellis/scripts/task.sh archive <task-name>         # Archive completed task
#   ./.trellis/scripts/task.sh list                        # List active tasks
#   ./.trellis/scripts/task.sh list-archive [month]        # List archived tasks
#
# Task Directory Structure:
#   tasks/
#     ├── 01-21-my-task/
#     │   ├── task.json         # Metadata
#     │   ├── prd.md            # Requirements
#     │   ├── info.md           # Technical design (optional)
#     │   ├── implement.jsonl   # Implement agent context
#     │   ├── check.jsonl       # Check agent context
#     │   └── debug.jsonl       # Debug agent context
#     └── archive/
#         └── 2026-01/
#             └── 01-21-old-task/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common/paths.sh"
source "$SCRIPT_DIR/common/developer.sh"
source "$SCRIPT_DIR/common/task-queue.sh"
source "$SCRIPT_DIR/common/task-utils.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_ROOT=$(get_repo_root)

# Platform (claude | cursor), can be overridden via --platform flag
PLATFORM="claude"

# Get command file path based on platform
# Claude: .claude/commands/trellis/<name>.md
# Cursor: .cursor/commands/trellis-<name>.md
get_command_path() {
  local name="$1"
  if [[ "$PLATFORM" == "cursor" ]]; then
    echo ".cursor/commands/trellis-${name}.md"
  else
    echo ".claude/commands/trellis/${name}.md"
  fi
}

# =============================================================================
# Helper Functions
# =============================================================================

# Convert title to slug (only works with ASCII)
_slugify() {
  local result=$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//')
  echo "$result"
}

# =============================================================================
# jsonl Default Content Generators
# =============================================================================

get_implement_base() {
  cat << EOF
{"file": "$DIR_WORKFLOW/workflow.md", "reason": "Project workflow and conventions"}
{"file": "$DIR_WORKFLOW/$DIR_SPEC/shared/index.md", "reason": "Shared coding standards"}
EOF
}

get_implement_backend() {
  cat << EOF
{"file": "$DIR_WORKFLOW/$DIR_SPEC/backend/index.md", "reason": "Backend development guide"}
{"file": "$DIR_WORKFLOW/$DIR_SPEC/backend/api-module.md", "reason": "API module conventions"}
{"file": "$DIR_WORKFLOW/$DIR_SPEC/backend/quality.md", "reason": "Code quality requirements"}
EOF
}

get_implement_frontend() {
  cat << EOF
{"file": "$DIR_WORKFLOW/$DIR_SPEC/frontend/index.md", "reason": "Frontend development guide"}
{"file": "$DIR_WORKFLOW/$DIR_SPEC/frontend/components.md", "reason": "Component conventions"}
EOF
}

get_check_context() {
  local dev_type="$1"
  local finish_work=$(get_command_path "finish-work")
  local check_backend=$(get_command_path "check-backend")
  local check_frontend=$(get_command_path "check-frontend")

  cat << EOF
{"file": "${finish_work}", "reason": "Finish work checklist"}
{"file": "$DIR_WORKFLOW/$DIR_SPEC/shared/index.md", "reason": "Shared coding standards"}
EOF

  if [[ "$dev_type" == "backend" ]] || [[ "$dev_type" == "fullstack" ]]; then
    echo "{\"file\": \"${check_backend}\", \"reason\": \"Backend check spec\"}"
  fi
  if [[ "$dev_type" == "frontend" ]] || [[ "$dev_type" == "fullstack" ]]; then
    echo "{\"file\": \"${check_frontend}\", \"reason\": \"Frontend check spec\"}"
  fi
}

get_debug_context() {
  local dev_type="$1"
  local check_backend=$(get_command_path "check-backend")
  local check_frontend=$(get_command_path "check-frontend")

  echo "{\"file\": \"$DIR_WORKFLOW/$DIR_SPEC/shared/index.md\", \"reason\": \"Shared coding standards\"}"

  if [[ "$dev_type" == "backend" ]] || [[ "$dev_type" == "fullstack" ]]; then
    echo "{\"file\": \"${check_backend}\", \"reason\": \"Backend check spec\"}"
  fi
  if [[ "$dev_type" == "frontend" ]] || [[ "$dev_type" == "fullstack" ]]; then
    echo "{\"file\": \"${check_frontend}\", \"reason\": \"Frontend check spec\"}"
  fi
}

# =============================================================================
# Task Operations
# =============================================================================

ensure_tasks_dir() {
  local tasks_dir=$(get_tasks_dir)
  local archive_dir="$tasks_dir/archive"

  if [[ ! -d "$tasks_dir" ]]; then
    mkdir -p "$tasks_dir"
    echo -e "${GREEN}Created tasks directory: $tasks_dir${NC}" >&2
  fi

  if [[ ! -d "$archive_dir" ]]; then
    mkdir -p "$archive_dir"
  fi
}

# =============================================================================
# Command: create
# =============================================================================

cmd_create() {
  local title=""
  local assignee=""
  local priority="P2"
  local slug=""
  local description=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --assignee|-a)
        assignee="$2"
        shift 2
        ;;
      --priority|-p)
        priority="$2"
        shift 2
        ;;
      --slug|-s)
        slug="$2"
        shift 2
        ;;
      --description|-d)
        description="$2"
        shift 2
        ;;
      -*)
        echo -e "${RED}Error: Unknown option $1${NC}" >&2
        exit 1
        ;;
      *)
        if [[ -z "$title" ]]; then
          title="$1"
        fi
        shift
        ;;
    esac
  done

  # Validate required fields
  if [[ -z "$title" ]]; then
    echo -e "${RED}Error: title is required${NC}" >&2
    echo "Usage: $0 create <title> [--assignee <dev>] [--priority P0|P1|P2|P3] [--slug <slug>]" >&2
    exit 1
  fi

  # Default assignee to current developer
  if [[ -z "$assignee" ]]; then
    assignee=$(get_developer "$REPO_ROOT")
    if [[ -z "$assignee" ]]; then
      echo -e "${RED}Error: No developer set. Run init-developer.sh first or use --assignee${NC}" >&2
      exit 1
    fi
  fi

  ensure_tasks_dir

  # Get current developer as creator
  local creator=$(get_developer "$REPO_ROOT")
  if [[ -z "$creator" ]]; then
    creator="$assignee"
  fi

  # Generate slug if not provided
  if [[ -z "$slug" ]]; then
    slug=$(_slugify "$title")
  fi

  # Validate slug
  if [[ -z "$slug" ]]; then
    echo -e "${RED}Error: could not generate slug from title${NC}" >&2
    exit 1
  fi

  # Create task directory with MM-DD-slug format
  local tasks_dir=$(get_tasks_dir)
  local date_prefix=$(generate_task_date_prefix)
  local dir_name="${date_prefix}-${slug}"
  local task_dir="$tasks_dir/$dir_name"
  local task_json="$task_dir/$FILE_TASK_JSON"

  if [[ -d "$task_dir" ]]; then
    echo -e "${YELLOW}Warning: Task directory already exists: $dir_name${NC}" >&2
  else
    mkdir -p "$task_dir"
  fi

  local today=$(date +%Y-%m-%d)
  # Record current branch as base_branch (PR target)
  local current_branch=$(git branch --show-current 2>/dev/null || echo "main")

  cat > "$task_json" << EOF
{
  "id": "$slug",
  "name": "$slug",
  "title": "$title",
  "description": "$description",
  "status": "planning",
  "dev_type": null,
  "scope": null,
  "priority": "$priority",
  "creator": "$creator",
  "assignee": "$assignee",
  "createdAt": "$today",
  "completedAt": null,
  "branch": null,
  "base_branch": "$current_branch",
  "worktree_path": null,
  "current_phase": 0,
  "next_action": [
    {"phase": 1, "action": "implement"},
    {"phase": 2, "action": "check"},
    {"phase": 3, "action": "finish"},
    {"phase": 4, "action": "create-pr"}
  ],
  "commit": null,
  "pr_url": null,
  "subtasks": [],
  "relatedFiles": [],
  "notes": ""
}
EOF

  echo -e "${GREEN}Created task: $dir_name${NC}" >&2
  echo -e "" >&2
  echo -e "${BLUE}Next steps:${NC}" >&2
  echo -e "  1. Create prd.md with requirements" >&2
  echo -e "  2. Run: $0 init-context <dir> <dev_type>" >&2
  echo -e "  3. Run: $0 start <dir>" >&2
  echo "" >&2

  # Output relative path for script chaining
  echo "$DIR_WORKFLOW/$DIR_TASKS/$dir_name"
}

# =============================================================================
# Command: init-context
# =============================================================================

cmd_init_context() {
  local target_dir=""
  local dev_type=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --platform)
        PLATFORM="$2"
        shift 2
        ;;
      -*)
        echo -e "${RED}Error: Unknown option $1${NC}"
        exit 1
        ;;
      *)
        if [[ -z "$target_dir" ]]; then
          target_dir="$1"
        elif [[ -z "$dev_type" ]]; then
          dev_type="$1"
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$target_dir" ]] || [[ -z "$dev_type" ]]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 init-context <task-dir> <dev_type> [--platform claude|cursor]"
    echo "  dev_type: backend | frontend | fullstack | test | docs"
    echo "  --platform: claude (default) | cursor"
    exit 1
  fi

  # Support relative paths
  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  if [[ ! -d "$target_dir" ]]; then
    echo -e "${RED}Error: Directory not found: $target_dir${NC}"
    exit 1
  fi

  echo -e "${BLUE}=== Initializing Agent Context Files ===${NC}"
  echo -e "Target dir: $target_dir"
  echo -e "Dev type: $dev_type"
  echo ""

  # implement.jsonl
  echo -e "${CYAN}Creating implement.jsonl...${NC}"
  local implement_file="$target_dir/implement.jsonl"
  {
    get_implement_base
    case "$dev_type" in
      backend|test) get_implement_backend ;;
      frontend) get_implement_frontend ;;
      fullstack)
        get_implement_backend
        get_implement_frontend
        ;;
    esac
  } > "$implement_file"
  echo -e "  ${GREEN}✓${NC} $(wc -l < "$implement_file" | tr -d ' ') entries"

  # check.jsonl
  echo -e "${CYAN}Creating check.jsonl...${NC}"
  local check_file="$target_dir/check.jsonl"
  get_check_context "$dev_type" > "$check_file"
  echo -e "  ${GREEN}✓${NC} $(wc -l < "$check_file" | tr -d ' ') entries"

  # debug.jsonl
  echo -e "${CYAN}Creating debug.jsonl...${NC}"
  local debug_file="$target_dir/debug.jsonl"
  get_debug_context "$dev_type" > "$debug_file"
  echo -e "  ${GREEN}✓${NC} $(wc -l < "$debug_file" | tr -d ' ') entries"

  echo ""
  echo -e "${GREEN}✓ All context files created${NC}"
  echo -e ""
  echo -e "${BLUE}Next steps:${NC}"
  echo -e "  1. Add task-specific specs: $0 add-context <dir> <jsonl> <path>"
  echo -e "  2. Set as current: $0 start <dir>"
}

# =============================================================================
# Command: add-context
# =============================================================================

cmd_add_context() {
  local target_dir="$1"
  local jsonl_name="$2"
  local path="$3"
  local reason="${4:-Added manually}"

  if [[ -z "$target_dir" ]] || [[ -z "$jsonl_name" ]] || [[ -z "$path" ]]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 add-context <task-dir> <jsonl-file> <path> [reason]"
    echo "  jsonl-file: implement | check | debug (or full filename)"
    exit 1
  fi

  # Support relative paths
  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  # Support shorthand
  if [[ "$jsonl_name" != *.jsonl ]]; then
    jsonl_name="${jsonl_name}.jsonl"
  fi

  local jsonl_file="$target_dir/$jsonl_name"
  local full_path="$REPO_ROOT/$path"
  local entry_type="file"

  if [[ -d "$full_path" ]]; then
    entry_type="directory"
    [[ "$path" != */ ]] && path="$path/"
  elif [[ ! -f "$full_path" ]]; then
    echo -e "${RED}Error: Path not found: $path${NC}"
    exit 1
  fi

  # Check if already exists
  if [[ -f "$jsonl_file" ]] && grep -q "\"$path\"" "$jsonl_file" 2>/dev/null; then
    echo -e "${YELLOW}Warning: Entry already exists for $path${NC}"
    exit 0
  fi

  # Add entry
  if [[ "$entry_type" == "directory" ]]; then
    echo "{\"file\": \"$path\", \"type\": \"directory\", \"reason\": \"$reason\"}" >> "$jsonl_file"
  else
    echo "{\"file\": \"$path\", \"reason\": \"$reason\"}" >> "$jsonl_file"
  fi

  echo -e "${GREEN}Added $entry_type: $path${NC}"
}

# =============================================================================
# Command: validate
# =============================================================================

validate_jsonl() {
  local jsonl_file="$1"
  local file_name=$(basename "$jsonl_file")
  local errors=0
  local line_num=0

  if [[ ! -f "$jsonl_file" ]]; then
    echo -e "  ${YELLOW}$file_name: not found (skipped)${NC}"
    return 0
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_num=$((line_num + 1))
    [[ -z "$line" ]] && continue

    if ! echo "$line" | jq -e . > /dev/null 2>&1; then
      echo -e "  ${RED}$file_name:$line_num: Invalid JSON${NC}"
      errors=$((errors + 1))
      continue
    fi

    local file_path=$(echo "$line" | jq -r '.file // empty')
    local entry_type=$(echo "$line" | jq -r '.type // "file"')

    if [[ -z "$file_path" ]]; then
      echo -e "  ${RED}$file_name:$line_num: Missing 'file' field${NC}"
      errors=$((errors + 1))
      continue
    fi

    local full_path="$REPO_ROOT/$file_path"
    if [[ "$entry_type" == "directory" ]]; then
      if [[ ! -d "$full_path" ]]; then
        echo -e "  ${RED}$file_name:$line_num: Directory not found: $file_path${NC}"
        errors=$((errors + 1))
      fi
    else
      if [[ ! -f "$full_path" ]]; then
        echo -e "  ${RED}$file_name:$line_num: File not found: $file_path${NC}"
        errors=$((errors + 1))
      fi
    fi
  done < "$jsonl_file"

  if [[ $errors -eq 0 ]]; then
    echo -e "  ${GREEN}$file_name: ✓ ($line_num entries)${NC}"
  else
    echo -e "  ${RED}$file_name: ✗ ($errors errors)${NC}"
  fi

  return $errors
}

cmd_validate() {
  local target_dir="$1"

  if [[ -z "$target_dir" ]]; then
    echo -e "${RED}Error: task directory required${NC}"
    exit 1
  fi

  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  echo -e "${BLUE}=== Validating Context Files ===${NC}"
  echo -e "Target dir: $target_dir"
  echo ""

  local total_errors=0
  for jsonl_file in "$target_dir"/{implement,check,debug}.jsonl; do
    validate_jsonl "$jsonl_file"
    total_errors=$((total_errors + $?))
  done

  echo ""
  if [[ $total_errors -eq 0 ]]; then
    echo -e "${GREEN}✓ All validations passed${NC}"
  else
    echo -e "${RED}✗ Validation failed ($total_errors errors)${NC}"
    exit 1
  fi
}

# =============================================================================
# Command: list-context
# =============================================================================

cmd_list_context() {
  local target_dir="$1"

  if [[ -z "$target_dir" ]]; then
    echo -e "${RED}Error: task directory required${NC}"
    exit 1
  fi

  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  echo -e "${BLUE}=== Context Files ===${NC}"
  echo ""

  for jsonl_file in "$target_dir"/{implement,check,debug}.jsonl; do
    local file_name=$(basename "$jsonl_file")
    [[ ! -f "$jsonl_file" ]] && continue

    echo -e "${CYAN}[$file_name]${NC}"

    local count=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" ]] && continue

      local file_path=$(echo "$line" | jq -r '.file // "?"')
      local entry_type=$(echo "$line" | jq -r '.type // "file"')
      local reason=$(echo "$line" | jq -r '.reason // "-"')
      count=$((count + 1))

      if [[ "$entry_type" == "directory" ]]; then
        echo -e "  ${GREEN}$count.${NC} [DIR] $file_path"
      else
        echo -e "  ${GREEN}$count.${NC} $file_path"
      fi
      echo -e "     ${YELLOW}→${NC} $reason"
    done < "$jsonl_file"

    echo ""
  done
}

# =============================================================================
# Command: start / finish
# =============================================================================

cmd_start() {
  local task_dir="$1"

  if [[ -z "$task_dir" ]]; then
    echo -e "${RED}Error: task directory required${NC}"
    exit 1
  fi

  # Convert to relative path
  if [[ "$task_dir" = /* ]]; then
    task_dir="${task_dir#$REPO_ROOT/}"
  fi

  # Verify directory exists
  if [[ ! -d "$REPO_ROOT/$task_dir" ]]; then
    echo -e "${RED}Error: Task directory not found: $task_dir${NC}"
    exit 1
  fi

  set_current_task "$task_dir"
  echo -e "${GREEN}✓ Current task set to: $task_dir${NC}"
  echo ""
  echo -e "${BLUE}The hook will now inject context from this task's jsonl files.${NC}"
}

cmd_finish() {
  local current=$(get_current_task)

  if [[ -z "$current" ]]; then
    echo -e "${YELLOW}No current task set${NC}"
    exit 0
  fi

  clear_current_task
  echo -e "${GREEN}✓ Cleared current task (was: $current)${NC}"
}

# =============================================================================
# Command: archive
# =============================================================================

cmd_archive() {
  local task_name="$1"

  if [[ -z "$task_name" ]]; then
    echo -e "${RED}Error: Task name is required${NC}" >&2
    echo "Usage: $0 archive <task-name>" >&2
    exit 1
  fi

  local tasks_dir=$(get_tasks_dir)

  # Find task directory using common function
  local task_dir=$(find_task_by_name "$task_name" "$tasks_dir")

  if [[ -z "$task_dir" ]] || [[ ! -d "$task_dir" ]]; then
    echo -e "${RED}Error: Task not found: $task_name${NC}" >&2
    echo "Active tasks:" >&2
    cmd_list >&2
    exit 1
  fi

  local dir_name=$(basename "$task_dir")
  local task_json="$task_dir/$FILE_TASK_JSON"

  # Update status before archiving
  local today=$(date +%Y-%m-%d)
  if [[ -f "$task_json" ]] && command -v jq &> /dev/null; then
    local temp_file=$(mktemp)
    jq --arg date "$today" '.status = "completed" | .completedAt = $date' "$task_json" > "$temp_file"
    mv "$temp_file" "$task_json"
  fi

  # Clear if current task
  local current=$(get_current_task)
  if [[ "$current" == *"$dir_name"* ]]; then
    clear_current_task
  fi

  # Use common archive function
  local result=$(archive_task_complete "$task_dir" "$REPO_ROOT")
  local archive_dest=""

  echo "$result" | while IFS= read -r line; do
    case "$line" in
      archived_to:*)
        archive_dest="${line#archived_to:}"
        local year_month=$(basename "$(dirname "$archive_dest")")
        echo -e "${GREEN}Archived: $dir_name -> archive/$year_month/${NC}" >&2
        ;;
    esac
  done

  # Return the archive path
  local year_month=$(date +%Y-%m)
  echo "$DIR_WORKFLOW/$DIR_TASKS/$DIR_ARCHIVE/$year_month/$dir_name"
}

# =============================================================================
# Command: list
# =============================================================================

cmd_list() {
  local filter_mine=false
  local filter_status=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mine|-m)
        filter_mine=true
        shift
        ;;
      --status|-s)
        filter_status="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  local tasks_dir=$(get_tasks_dir)
  local current_task=$(get_current_task)
  local developer=$(get_developer "$REPO_ROOT")

  if [[ "$filter_mine" == "true" ]]; then
    if [[ -z "$developer" ]]; then
      echo -e "${RED}Error: No developer set. Run init-developer.sh first${NC}" >&2
      exit 1
    fi
    echo -e "${BLUE}My tasks (assignee: $developer):${NC}"
  else
    echo -e "${BLUE}All active tasks:${NC}"
  fi
  echo ""

  local count=0

  for d in "$tasks_dir"/*/; do
    if [[ -d "$d" ]] && [[ "$(basename "$d")" != "archive" ]]; then
      local dir_name=$(basename "$d")
      local task_json="$d/$FILE_TASK_JSON"
      local status="unknown"
      local assignee="-"
      local relative_path="$DIR_WORKFLOW/$DIR_TASKS/$dir_name"

      if [[ -f "$task_json" ]] && command -v jq &> /dev/null; then
        status=$(jq -r '.status // "unknown"' "$task_json")
        assignee=$(jq -r '.assignee // "-"' "$task_json")
      fi

      # Apply --mine filter
      if [[ "$filter_mine" == "true" ]] && [[ "$assignee" != "$developer" ]]; then
        continue
      fi

      # Apply --status filter
      if [[ -n "$filter_status" ]] && [[ "$status" != "$filter_status" ]]; then
        continue
      fi

      local marker=""
      if [[ "$relative_path" == "$current_task" ]]; then
        marker=" ${GREEN}<- current${NC}"
      fi

      if [[ "$filter_mine" == "true" ]]; then
        echo -e "  - $dir_name/ ($status)$marker"
      else
        echo -e "  - $dir_name/ ($status) [${CYAN}$assignee${NC}]$marker"
      fi
      ((count++))
    fi
  done

  if [[ $count -eq 0 ]]; then
    if [[ "$filter_mine" == "true" ]]; then
      echo "  (no tasks assigned to you)"
    else
      echo "  (no active tasks)"
    fi
  fi

  echo ""
  echo "Total: $count task(s)"
}

# =============================================================================
# Command: list-archive
# =============================================================================

cmd_list_archive() {
  local month="$1"

  local tasks_dir=$(get_tasks_dir)
  local archive_dir="$tasks_dir/archive"

  echo -e "${BLUE}Archived tasks:${NC}"
  echo ""

  if [[ -n "$month" ]]; then
    local month_dir="$archive_dir/$month"
    if [[ -d "$month_dir" ]]; then
      echo "[$month]"
      for d in "$month_dir"/*/; do
        if [[ -d "$d" ]]; then
          echo "  - $(basename "$d")/"
        fi
      done
    else
      echo "  No archives for $month"
    fi
  else
    for month_dir in "$archive_dir"/*/; do
      if [[ -d "$month_dir" ]]; then
        local month_name=$(basename "$month_dir")
        local count=$(find "$month_dir" -maxdepth 1 -type d ! -name "$(basename "$month_dir")" | wc -l | tr -d ' ')
        echo "[$month_name] - $count task(s)"
      fi
    done
  fi
}

# =============================================================================
# Command: set-branch
# =============================================================================

cmd_set_branch() {
  local target_dir="$1"
  local branch="$2"

  if [[ -z "$target_dir" ]] || [[ -z "$branch" ]]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 set-branch <task-dir> <branch-name>"
    echo "Example: $0 set-branch <dir> task/my-task"
    exit 1
  fi

  # Support relative paths
  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  local task_json="$target_dir/$FILE_TASK_JSON"
  if [[ ! -f "$task_json" ]]; then
    echo -e "${RED}Error: task.json not found at $target_dir${NC}"
    exit 1
  fi

  # Update branch field
  jq --arg branch "$branch" '.branch = $branch' "$task_json" > "${task_json}.tmp"
  mv "${task_json}.tmp" "$task_json"

  echo -e "${GREEN}✓ Branch set to: $branch${NC}"
  echo ""
  echo -e "${BLUE}Now you can start the multi-agent pipeline:${NC}"
  echo "  ./.trellis/scripts/multi-agent/start.sh $1"
}

# =============================================================================
# Command: set-base-branch
# =============================================================================

cmd_set_base_branch() {
  local target_dir="$1"
  local base_branch="$2"

  if [[ -z "$target_dir" ]] || [[ -z "$base_branch" ]]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 set-base-branch <task-dir> <base-branch>"
    echo "Example: $0 set-base-branch <dir> develop"
    echo ""
    echo "This sets the target branch for PR (the branch your feature will merge into)."
    exit 1
  fi

  # Support relative paths
  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  local task_json="$target_dir/$FILE_TASK_JSON"
  if [[ ! -f "$task_json" ]]; then
    echo -e "${RED}Error: task.json not found at $target_dir${NC}"
    exit 1
  fi

  # Update base_branch field
  jq --arg base "$base_branch" '.base_branch = $base' "$task_json" > "${task_json}.tmp"
  mv "${task_json}.tmp" "$task_json"

  echo -e "${GREEN}✓ Base branch set to: $base_branch${NC}"
  echo -e "  PR will target: $base_branch"
}

# =============================================================================
# Command: set-scope
# =============================================================================

cmd_set_scope() {
  local target_dir="$1"
  local scope="$2"

  if [[ -z "$target_dir" ]] || [[ -z "$scope" ]]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 set-scope <task-dir> <scope>"
    echo "Example: $0 set-scope <dir> api"
    exit 1
  fi

  # Support relative paths
  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  local task_json="$target_dir/$FILE_TASK_JSON"
  if [[ ! -f "$task_json" ]]; then
    echo -e "${RED}Error: task.json not found at $target_dir${NC}"
    exit 1
  fi

  # Update scope field
  jq --arg scope "$scope" '.scope = $scope' "$task_json" > "${task_json}.tmp"
  mv "${task_json}.tmp" "$task_json"

  echo -e "${GREEN}✓ Scope set to: $scope${NC}"
}

# =============================================================================
# Command: create-pr
# =============================================================================

cmd_create_pr() {
  local target_dir=""
  local dry_run=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        dry_run=true
        shift
        ;;
      *)
        if [[ -z "$target_dir" ]]; then
          target_dir="$1"
        fi
        shift
        ;;
    esac
  done

  # Get task directory
  if [[ -z "$target_dir" ]]; then
    target_dir=$(get_current_task)
    if [[ -z "$target_dir" ]]; then
      echo -e "${RED}Error: No task directory specified and no current task set${NC}"
      echo "Usage: $0 create-pr [task-dir] [--dry-run]"
      exit 1
    fi
  fi

  # Support relative paths
  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$REPO_ROOT/$target_dir"
  fi

  local task_json="$target_dir/$FILE_TASK_JSON"
  if [[ ! -f "$task_json" ]]; then
    echo -e "${RED}Error: task.json not found at $target_dir${NC}"
    exit 1
  fi

  echo -e "${BLUE}=== Create PR ===${NC}"
  if [[ "$dry_run" == "true" ]]; then
    echo -e "${YELLOW}[DRY-RUN MODE] No actual changes will be made${NC}"
  fi
  echo ""

  # Read task config
  local task_name=$(jq -r '.name' "$task_json")
  local base_branch=$(jq -r '.base_branch // "main"' "$task_json")
  local scope=$(jq -r '.scope // "core"' "$task_json")
  local dev_type=$(jq -r '.dev_type // "feature"' "$task_json")

  # Map dev_type to commit prefix
  local commit_prefix
  case "$dev_type" in
    feature|frontend|backend|fullstack) commit_prefix="feat" ;;
    bugfix|fix) commit_prefix="fix" ;;
    refactor) commit_prefix="refactor" ;;
    docs) commit_prefix="docs" ;;
    test) commit_prefix="test" ;;
    *) commit_prefix="feat" ;;
  esac

  echo -e "Task: ${task_name}"
  echo -e "Base branch: ${base_branch}"
  echo -e "Scope: ${scope}"
  echo -e "Commit prefix: ${commit_prefix}"
  echo ""

  # Get current branch
  local current_branch=$(git branch --show-current)
  echo -e "Current branch: ${current_branch}"

  # Check for changes
  echo -e "${YELLOW}Checking for changes...${NC}"

  # Stage changes (even in dry-run to detect what would be committed)
  git add -A
  # Exclude workspace and temp files
  git reset "$DIR_WORKFLOW/$DIR_WORKSPACE/" 2>/dev/null || true
  git reset .agent-log .agent-runner.sh 2>/dev/null || true

  # Check if there are staged changes
  if git diff --cached --quiet 2>/dev/null; then
    echo -e "${YELLOW}No staged changes to commit${NC}"

    # Check for unpushed commits
    local unpushed=$(git log "origin/${current_branch}..HEAD" --oneline 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    if [[ "$unpushed" -eq 0 ]] 2>/dev/null; then
      # In dry-run, also reset the staging
      if [[ "$dry_run" == "true" ]]; then
        git reset HEAD >/dev/null 2>&1 || true
      fi
      echo -e "${RED}No changes to create PR${NC}"
      exit 1
    fi
    echo -e "Found ${unpushed} unpushed commit(s)"
  else
    # Commit changes
    echo -e "${YELLOW}Committing changes...${NC}"
    local commit_msg="${commit_prefix}(${scope}): ${task_name}"

    if [[ "$dry_run" == "true" ]]; then
      echo -e "[DRY-RUN] Would commit with message: ${commit_msg}"
      echo -e "[DRY-RUN] Staged files:"
      git diff --cached --name-only | sed 's/^/  - /'
    else
      git commit -m "$commit_msg"
      echo -e "${GREEN}Committed: ${commit_msg}${NC}"
    fi
  fi

  # Push to remote
  echo -e "${YELLOW}Pushing to remote...${NC}"
  if [[ "$dry_run" == "true" ]]; then
    echo -e "[DRY-RUN] Would push to: origin/${current_branch}"
  else
    git push -u origin "$current_branch"
    echo -e "${GREEN}Pushed to origin/${current_branch}${NC}"
  fi

  # Create PR
  echo -e "${YELLOW}Creating PR...${NC}"
  local pr_title="${commit_prefix}(${scope}): ${task_name}"
  local pr_url=""

  if [[ "$dry_run" == "true" ]]; then
    echo -e "[DRY-RUN] Would create PR:"
    echo -e "  Title: ${pr_title}"
    echo -e "  Base:  ${base_branch}"
    echo -e "  Head:  ${current_branch}"
    if [[ -f "$target_dir/prd.md" ]]; then
      echo -e "  Body:  (from prd.md)"
    fi
    pr_url="https://github.com/example/repo/pull/DRY-RUN"
  else
    # Check if PR already exists
    local existing_pr=$(gh pr list --head "$current_branch" --base "$base_branch" --json url --jq '.[0].url' 2>/dev/null || echo "")

    if [[ -n "$existing_pr" ]]; then
      echo -e "${YELLOW}PR already exists: ${existing_pr}${NC}"
      pr_url="$existing_pr"
    else
      # Read PRD as PR body
      local pr_body=""
      if [[ -f "$target_dir/prd.md" ]]; then
        pr_body=$(cat "$target_dir/prd.md")
      fi

      # Create PR
      pr_url=$(gh pr create \
        --draft \
        --base "$base_branch" \
        --title "$pr_title" \
        --body "$pr_body" \
        2>&1)

      echo -e "${GREEN}PR created: ${pr_url}${NC}"
    fi
  fi

  # Update task.json
  echo -e "${YELLOW}Updating task status...${NC}"
  if [[ "$dry_run" == "true" ]]; then
    echo -e "[DRY-RUN] Would update task.json:"
    echo -e "  status: review"
    echo -e "  pr_url: ${pr_url}"
    echo -e "  current_phase: (set to create-pr phase)"
  else
    # Find the phase number for create-pr action
    local create_pr_phase=$(jq -r '.next_action[] | select(.action == "create-pr") | .phase // 4' "$task_json")
    jq --arg url "$pr_url" --argjson phase "$create_pr_phase" \
      '.status = "review" | .pr_url = $url | .current_phase = $phase' "$task_json" > "${task_json}.tmp"
    mv "${task_json}.tmp" "$task_json"
    echo -e "${GREEN}Task status updated to 'review', phase ${create_pr_phase}${NC}"
  fi

  # In dry-run, reset the staging area
  if [[ "$dry_run" == "true" ]]; then
    git reset HEAD >/dev/null 2>&1 || true
  fi

  echo ""
  echo -e "${GREEN}=== PR Created Successfully ===${NC}"
  echo -e "PR URL: ${pr_url}"
  echo -e "Target: ${base_branch}"
  echo -e "Source: ${current_branch}"
}

# =============================================================================
# Help
# =============================================================================

show_usage() {
  cat << EOF
Task Management Script for Multi-Agent Pipeline

Usage:
  $0 create <title>                     Create new task directory
  $0 init-context <dir> <type> [--platform claude|cursor]  Initialize jsonl files
  $0 add-context <dir> <jsonl> <path> [reason]  Add entry to jsonl
  $0 validate <dir>                     Validate jsonl files
  $0 list-context <dir>                 List jsonl entries
  $0 start <dir>                        Set as current task
  $0 finish                             Clear current task
  $0 set-branch <dir> <branch>          Set git branch for multi-agent
  $0 set-scope <dir> <scope>            Set scope for PR title
  $0 create-pr [dir] [--dry-run]        Create PR from task
  $0 archive <task-name>                Archive completed task
  $0 list [--mine] [--status <status>]  List tasks
  $0 list-archive [YYYY-MM]             List archived tasks

Arguments:
  dev_type: backend | frontend | fullstack | test | docs

List options:
  --mine, -m           Show only tasks assigned to current developer
  --status, -s <s>     Filter by status (planning, in_progress, review, completed)

Examples:
  $0 create "Add login feature" --slug add-login
  $0 init-context .trellis/tasks/01-21-add-login backend
  $0 init-context .trellis/tasks/01-21-add-login frontend --platform cursor
  $0 add-context <dir> implement .trellis/spec/backend/auth.md "Auth guidelines"
  $0 set-branch <dir> task/add-login
  $0 start .trellis/tasks/01-21-add-login
  $0 create-pr                          # Uses current task
  $0 create-pr <dir> --dry-run          # Preview without changes
  $0 finish
  $0 archive add-login
  $0 list                               # List all active tasks
  $0 list --mine                        # List my tasks only
  $0 list --mine --status in_progress   # List my in-progress tasks
EOF
}

# =============================================================================
# Main Entry
# =============================================================================

case "${1:-}" in
  create)
    shift
    cmd_create "$@"
    ;;
  init-context)
    shift
    cmd_init_context "$@"
    ;;
  add-context)
    cmd_add_context "$2" "$3" "$4" "$5"
    ;;
  validate)
    cmd_validate "$2"
    ;;
  list-context)
    cmd_list_context "$2"
    ;;
  start)
    cmd_start "$2"
    ;;
  finish)
    cmd_finish
    ;;
  set-branch)
    cmd_set_branch "$2" "$3"
    ;;
  set-base-branch)
    cmd_set_base_branch "$2" "$3"
    ;;
  set-scope)
    cmd_set_scope "$2" "$3"
    ;;
  create-pr)
    # Delegate to multi-agent/create-pr.sh
    shift
    "$SCRIPT_DIR/multi-agent/create-pr.sh" "$@"
    ;;
  archive)
    cmd_archive "$2"
    ;;
  list)
    shift
    cmd_list "$@"
    ;;
  list-archive)
    cmd_list_archive "$2"
    ;;
  -h|--help|help)
    show_usage
    ;;
  *)
    show_usage
    exit 1
    ;;
esac
