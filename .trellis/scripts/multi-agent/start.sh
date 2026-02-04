#!/bin/bash
# =============================================================================
# Multi-Agent Pipeline: Start Worktree Agent
# =============================================================================
# Usage: ./start.sh <task-dir>
# Example: ./start.sh .trellis/tasks/01-21-my-task
#
# This script:
# 1. Creates worktree (if not exists) with dependency install
# 2. Copies environment files (from worktree.yaml config)
# 3. Sets .current-task in worktree
# 4. Starts claude agent in background
# 5. Registers agent to registry.json
#
# Prerequisites:
#   - task.json must exist with 'branch' field
#   - .claude/agents/dispatch.md must exist
#
# Configuration: .trellis/worktree.yaml
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../common/paths.sh"
source "$SCRIPT_DIR/../common/worktree.sh"
source "$SCRIPT_DIR/../common/developer.sh"
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

# =============================================================================
# Constants
# =============================================================================
PROJECT_ROOT=$(get_repo_root)
DISPATCH_MD_PATH=".claude/agents/dispatch.md"

# =============================================================================
# Parse Arguments
# =============================================================================
TASK_DIR=$1
if [ -z "$TASK_DIR" ]; then
  log_error "Task directory required"
  echo "Usage: $0 <task-dir>"
  echo "Example: $0 .trellis/tasks/01-21-my-task"
  exit 1
fi

# Normalize paths
if [[ "$TASK_DIR" = /* ]]; then
  TASK_DIR_RELATIVE="${TASK_DIR#$PROJECT_ROOT/}"
  TASK_DIR_ABS="$TASK_DIR"
else
  TASK_DIR_RELATIVE="$TASK_DIR"
  TASK_DIR_ABS="${PROJECT_ROOT}/${TASK_DIR}"
fi

TASK_JSON="${TASK_DIR_ABS}/$FILE_TASK_JSON"

# =============================================================================
# Validation
# =============================================================================
if [ ! -f "$TASK_JSON" ]; then
  log_error "task.json not found at ${TASK_JSON}"
  exit 1
fi

DISPATCH_MD="${PROJECT_ROOT}/${DISPATCH_MD_PATH}"
if [ ! -f "$DISPATCH_MD" ]; then
  log_error "dispatch.md not found at ${DISPATCH_MD}"
  exit 1
fi

CONFIG_FILE=$(get_worktree_config "$PROJECT_ROOT")
if [ ! -f "$CONFIG_FILE" ]; then
  log_error "worktree.yaml not found at ${CONFIG_FILE}"
  exit 1
fi

# =============================================================================
# Read Task Config
# =============================================================================
echo ""
echo -e "${BLUE}=== Multi-Agent Pipeline: Start ===${NC}"
log_info "Task: ${TASK_DIR_ABS}"

BRANCH=$(jq -r '.branch' "$TASK_JSON")
TASK_NAME=$(jq -r '.name' "$TASK_JSON")
TASK_STATUS=$(jq -r '.status' "$TASK_JSON")
WORKTREE_PATH=$(jq -r '.worktree_path // empty' "$TASK_JSON")
CONFIGURED_BASE_BRANCH=$(jq -r '.base_branch // empty' "$TASK_JSON")

# Check if task was rejected
if [ "$TASK_STATUS" = "rejected" ]; then
  log_error "Task was rejected by Plan Agent"
  if [ -f "${TASK_DIR_ABS}/REJECTED.md" ]; then
    echo ""
    echo -e "${YELLOW}Rejection reason:${NC}"
    cat "${TASK_DIR_ABS}/REJECTED.md"
  fi
  echo ""
  log_info "To retry, delete this directory and run plan.sh again with revised requirements"
  exit 1
fi

# Check if prd.md exists (plan completed successfully)
if [ ! -f "${TASK_DIR_ABS}/prd.md" ]; then
  log_error "prd.md not found - Plan Agent may not have completed"
  log_info "Check plan log: ${TASK_DIR_ABS}/.plan-log"
  exit 1
fi

if [ -z "$BRANCH" ] || [ "$BRANCH" = "null" ]; then
  log_error "branch field not set in task.json"
  log_info "Please set branch field first, e.g.:"
  log_info "  jq '.branch = \"task/my-task\"' task.json > tmp && mv tmp task.json"
  exit 1
fi

log_info "Branch: ${BRANCH}"
log_info "Name: ${TASK_NAME}"

# =============================================================================
# Step 1: Create Worktree (if not exists)
# =============================================================================
if [ -z "$WORKTREE_PATH" ] || [ ! -d "$WORKTREE_PATH" ]; then
  log_info "Step 1: Creating worktree..."

  # Determine base_branch (PR target)
  # Priority: 1) task.json configured value, 2) current branch
  if [ -n "$CONFIGURED_BASE_BRANCH" ]; then
    BASE_BRANCH="$CONFIGURED_BASE_BRANCH"
    log_info "Base branch (from task.json): ${BASE_BRANCH}"
  else
    BASE_BRANCH=$(git -C "$PROJECT_ROOT" branch --show-current)
    log_info "Base branch (current branch): ${BASE_BRANCH}"
  fi

  # Calculate worktree path
  WORKTREE_BASE=$(get_worktree_base_dir "$PROJECT_ROOT")
  mkdir -p "$WORKTREE_BASE"
  WORKTREE_BASE="$(cd "$WORKTREE_BASE" && pwd)"
  WORKTREE_PATH="${WORKTREE_BASE}/${BRANCH}"

  # Create parent directory
  mkdir -p "$(dirname "$WORKTREE_PATH")"
  cd "$PROJECT_ROOT"

  # Create branch if not exists
  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    log_info "Branch exists, checking out..."
    git worktree add "$WORKTREE_PATH" "$BRANCH"
  else
    log_info "Creating new branch: $BRANCH"
    git worktree add -b "$BRANCH" "$WORKTREE_PATH"
  fi

  log_success "Worktree created: ${WORKTREE_PATH}"

  # Update task.json with worktree_path and base_branch
  jq --arg path "$WORKTREE_PATH" --arg base "$BASE_BRANCH" \
    '.worktree_path = $path | .base_branch = $base' "$TASK_JSON" > "${TASK_JSON}.tmp"
  mv "${TASK_JSON}.tmp" "$TASK_JSON"

  # ----- Copy environment files -----
  log_info "Copying environment files..."
  cd "$WORKTREE_PATH"

  COPY_LIST=$(get_worktree_copy_files "$PROJECT_ROOT")
  COPY_COUNT=0

  while IFS= read -r item; do
    [ -z "$item" ] && continue

    SOURCE="${PROJECT_ROOT}/${item}"
    TARGET="${WORKTREE_PATH}/${item}"

    if [ -f "$SOURCE" ]; then
      mkdir -p "$(dirname "$TARGET")"
      cp "$SOURCE" "$TARGET"
      ((COPY_COUNT++))
    fi
  done <<< "$COPY_LIST"

  if [ $COPY_COUNT -gt 0 ]; then
    log_success "Copied $COPY_COUNT file(s)"
  fi

  # ----- Copy task directory (may not be committed yet) -----
  log_info "Copying task directory..."
  TASK_TARGET_DIR="${WORKTREE_PATH}/${TASK_DIR_RELATIVE}"
  mkdir -p "$(dirname "$TASK_TARGET_DIR")"
  cp -r "$TASK_DIR_ABS" "$(dirname "$TASK_TARGET_DIR")/"
  log_success "Task directory copied to worktree"

  # ----- Run post_create hooks -----
  log_info "Running post_create hooks..."

  POST_CREATE=$(get_worktree_post_create_hooks "$PROJECT_ROOT")
  HOOK_COUNT=0

  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue

    log_info "  Running: $cmd"
    if eval "$cmd"; then
      ((HOOK_COUNT++))
    else
      log_error "Hook failed: $cmd"
      exit 1
    fi
  done <<< "$POST_CREATE"

  if [ $HOOK_COUNT -gt 0 ]; then
    log_success "Ran $HOOK_COUNT hook(s)"
  fi

else
  log_info "Step 1: Using existing worktree: ${WORKTREE_PATH}"
fi

# =============================================================================
# Step 2: Set .current-task in Worktree
# =============================================================================
log_info "Step 2: Setting current task in worktree..."

mkdir -p "${WORKTREE_PATH}/$DIR_WORKFLOW"
echo "$TASK_DIR_RELATIVE" > "${WORKTREE_PATH}/$DIR_WORKFLOW/$FILE_CURRENT_TASK"
log_success "Current task set: ${TASK_DIR_RELATIVE}"

# =============================================================================
# Step 3: Prepare and Start Claude Agent
# =============================================================================
log_info "Step 3: Starting Claude agent..."

# Update task status
jq '.status = "in_progress"' "$TASK_JSON" > "${TASK_JSON}.tmp"
mv "${TASK_JSON}.tmp" "$TASK_JSON"

cd "$WORKTREE_PATH"

LOG_FILE="${WORKTREE_PATH}/.agent-log"
RUNNER_SCRIPT="${WORKTREE_PATH}/.agent-runner.sh"
SESSION_ID_FILE="${WORKTREE_PATH}/.session-id"

touch "$LOG_FILE"

# Generate session ID for resume support
SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "$SESSION_ID" > "$SESSION_ID_FILE"
log_info "Session ID: ${SESSION_ID}"

# Create runner script (uses --agent flag to load dispatch agent directly)
cat > "$RUNNER_SCRIPT" << RUNNER_EOF
#!/bin/bash
cd "\$(dirname "\$0")"
export https_proxy="\${AGENT_HTTPS_PROXY:-}"
export http_proxy="\${AGENT_HTTP_PROXY:-}"
export all_proxy="\${AGENT_ALL_PROXY:-}"
export CLAUDE_NON_INTERACTIVE=1

claude -p --agent dispatch --session-id "${SESSION_ID}" --dangerously-skip-permissions --output-format stream-json --verbose "Start the pipeline"
RUNNER_EOF
chmod +x "$RUNNER_SCRIPT"

# Start agent in background
AGENT_HTTPS_PROXY="${https_proxy:-}" \
AGENT_HTTP_PROXY="${http_proxy:-}" \
AGENT_ALL_PROXY="${all_proxy:-}" \
nohup "$RUNNER_SCRIPT" > "$LOG_FILE" 2>&1 &
AGENT_PID=$!

log_success "Agent started with PID: ${AGENT_PID}"

# =============================================================================
# Step 4: Register to Registry (in main repo, not worktree)
# =============================================================================
log_info "Step 4: Registering agent to registry..."

# Generate agent ID
TASK_ID=$(jq -r '.id // empty' "$TASK_JSON")
if [ -z "$TASK_ID" ]; then
  TASK_ID=$(echo "$BRANCH" | sed 's/\//-/g')
fi

# Use common registry function
registry_add_agent "$TASK_ID" "$WORKTREE_PATH" "$AGENT_PID" "$TASK_DIR_RELATIVE" "$PROJECT_ROOT"

log_success "Agent registered: ${TASK_ID}"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${GREEN}=== Agent Started ===${NC}"
echo ""
echo "  ID:        $TASK_ID"
echo "  PID:       $AGENT_PID"
echo "  Session:   $SESSION_ID"
echo "  Worktree:  $WORKTREE_PATH"
echo "  Task:      $TASK_DIR_RELATIVE"
echo "  Log:       $LOG_FILE"
echo "  Registry:  $(registry_get_file "$PROJECT_ROOT")"
echo ""
echo -e "${YELLOW}To monitor:${NC} tail -f $LOG_FILE"
echo -e "${YELLOW}To stop:${NC}    kill $AGENT_PID"
echo -e "${YELLOW}To resume:${NC}  cd $WORKTREE_PATH && claude --resume $SESSION_ID"
