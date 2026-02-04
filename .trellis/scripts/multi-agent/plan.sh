#!/bin/bash
# =============================================================================
# Multi-Agent Pipeline: Plan Agent Launcher
# =============================================================================
# Usage: ./plan.sh --name <task-name> --type <dev-type> --requirement "<requirement>"
#
# This script:
# 1. Creates task directory
# 2. Starts Plan Agent in background
# 3. Plan Agent produces fully configured task directory
#
# After completion, use start.sh to launch the Dispatch Agent.
#
# Prerequisites:
#   - .claude/agents/plan.md must exist
#   - Developer must be initialized
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../common/paths.sh"
source "$SCRIPT_DIR/../common/developer.sh"

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
PLAN_MD_PATH=".claude/agents/plan.md"

# =============================================================================
# Parse Arguments
# =============================================================================
TASK_NAME=""
DEV_TYPE=""
REQUIREMENT=""

show_usage() {
  cat << EOF
Usage: $0 --name <task-name> --type <dev-type> --requirement "<requirement>"

Arguments:
  --name, -n        Task name (e.g., user-auth, add-rate-limiting)
  --type, -t        Development type: backend | frontend | fullstack
  --requirement, -r Requirement description (quote if contains spaces)

Examples:
  $0 --name user-auth --type backend --requirement "Add JWT-based user authentication"
  $0 -n rate-limit -t backend -r "Add rate limiting to API endpoints"

The Plan Agent runs in background. Monitor with:
  tail -f <task-dir>/.plan-log
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --name|-n)
      TASK_NAME="$2"
      shift 2
      ;;
    --type|-t)
      DEV_TYPE="$2"
      shift 2
      ;;
    --requirement|-r)
      REQUIREMENT="$2"
      shift 2
      ;;
    --help|-h)
      show_usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      show_usage
      exit 1
      ;;
  esac
done

# =============================================================================
# Validation
# =============================================================================
if [ -z "$TASK_NAME" ]; then
  log_error "Task name is required (--name)"
  show_usage
  exit 1
fi

if [ -z "$DEV_TYPE" ]; then
  log_error "Development type is required (--type)"
  show_usage
  exit 1
fi

if [[ ! "$DEV_TYPE" =~ ^(backend|frontend|fullstack)$ ]]; then
  log_error "Invalid dev type: $DEV_TYPE (must be: backend, frontend, fullstack)"
  exit 1
fi

if [ -z "$REQUIREMENT" ]; then
  log_error "Requirement is required (--requirement)"
  show_usage
  exit 1
fi

PLAN_MD="${PROJECT_ROOT}/${PLAN_MD_PATH}"
if [ ! -f "$PLAN_MD" ]; then
  log_error "plan.md not found at ${PLAN_MD}"
  exit 1
fi

ensure_developer "$PROJECT_ROOT"

# =============================================================================
# Step 1: Create Task Directory
# =============================================================================
echo ""
echo -e "${BLUE}=== Multi-Agent Pipeline: Plan ===${NC}"
log_info "Task: ${TASK_NAME}"
log_info "Type: ${DEV_TYPE}"
log_info "Requirement: ${REQUIREMENT}"
echo ""

log_info "Step 1: Creating task directory..."

# Create task (use requirement as title, task name as slug)
TASK_DIR=$("$SCRIPT_DIR/../task.sh" create "$REQUIREMENT" --slug "$TASK_NAME")
TASK_DIR_ABS="${PROJECT_ROOT}/${TASK_DIR}"

log_success "Task directory: ${TASK_DIR}"

# =============================================================================
# Step 2: Prepare and Start Plan Agent
# =============================================================================
log_info "Step 2: Starting Plan Agent in background..."

LOG_FILE="${TASK_DIR_ABS}/.plan-log"
touch "$LOG_FILE"

# Create a temporary runner script (will be deleted after agent starts)
RUNNER_SCRIPT=$(mktemp)
cat > "$RUNNER_SCRIPT" << RUNNER_EOF
#!/bin/bash
cd "${PROJECT_ROOT}"

export PLAN_TASK_NAME="${TASK_NAME}"
export PLAN_DEV_TYPE="${DEV_TYPE}"
export PLAN_TASK_DIR="${TASK_DIR}"
export PLAN_REQUIREMENT="${REQUIREMENT}"

export https_proxy="\${AGENT_HTTPS_PROXY:-}"
export http_proxy="\${AGENT_HTTP_PROXY:-}"
export all_proxy="\${AGENT_ALL_PROXY:-}"
export CLAUDE_NON_INTERACTIVE=1

# Use --agent flag to load plan agent directly
claude -p --agent plan --dangerously-skip-permissions --output-format stream-json --verbose "Start planning for task: ${TASK_NAME}"

# Self-delete the runner script
rm -f "\$0"
RUNNER_EOF
chmod +x "$RUNNER_SCRIPT"

# Start agent in background
AGENT_HTTPS_PROXY="${https_proxy:-}" \
AGENT_HTTP_PROXY="${http_proxy:-}" \
AGENT_ALL_PROXY="${all_proxy:-}" \
nohup "$RUNNER_SCRIPT" > "$LOG_FILE" 2>&1 &
AGENT_PID=$!

log_success "Plan Agent started (PID: ${AGENT_PID})"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${GREEN}=== Plan Agent Running ===${NC}"
echo ""
echo "  Task:  $TASK_NAME"
echo "  Type:  $DEV_TYPE"
echo "  Dir:   $TASK_DIR"
echo "  Log:   $LOG_FILE"
echo "  PID:   $AGENT_PID"
echo ""
echo -e "${YELLOW}To monitor:${NC}"
echo "  tail -f $LOG_FILE"
echo ""
echo -e "${YELLOW}To check status:${NC}"
echo "  ps -p $AGENT_PID"
echo "  ls -la $TASK_DIR"
echo ""
echo -e "${YELLOW}After completion, run:${NC}"
echo "  ./.trellis/scripts/multi-agent/start.sh $TASK_DIR"
