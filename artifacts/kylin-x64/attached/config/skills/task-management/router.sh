#!/usr/bin/env bash
#############################################################################
# Task Management Skill Router
# Routes to task-cli.ts with proper path resolution and command handling
#############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_SCRIPT="$SCRIPT_DIR/scripts/task-cli.ts"
MIGRATE_SCRIPT="$SCRIPT_DIR/scripts/migrate-schema.ts"

# Show help
show_help() {
  cat << 'HELP'
📋 Task Management Skill
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage: router.sh [COMMAND] [OPTIONS]

COMMANDS:
  status [feature]              Show task status summary
  next [feature]                Show next eligible tasks
  parallel [feature]            Show parallelizable tasks
  deps <feature> <seq>          Show dependency tree
  blocked [feature]             Show blocked tasks
  complete <feature> <seq> "msg" Mark subtask complete
  validate [feature]            Validate JSON files
  context <feature>             Show bounded context breakdown
  contracts <feature>           Show contract dependencies
  migrate <feature> [options]   Migrate to enhanced schema
  help                          Show this help message

MIGRATION OPTIONS:
  --dry-run                     Preview migration changes
  --lines-only                  Add only line-number precision

EXAMPLES:
  ./router.sh status
  ./router.sh status my-feature
  ./router.sh next
  ./router.sh deps my-feature 05
  ./router.sh complete my-feature 05 "Implemented auth module"
  ./router.sh validate
  ./router.sh context my-feature
  ./router.sh contracts my-feature
  ./router.sh migrate my-feature
  ./router.sh migrate my-feature --dry-run

FEATURES:
  ✓ Track progress across all features
  ✓ Find next eligible tasks (dependencies satisfied)
  ✓ Identify blocked tasks
  ✓ Mark subtasks complete with summaries
  ✓ Validate task integrity
  ✓ Show bounded context breakdown
  ✓ Show contract dependencies
  ✓ Migrate to enhanced schema

For more info, see: .opencode/skills/task-management/SKILL.md
HELP
}

# Check if CLI script exists
if [ ! -f "$CLI_SCRIPT" ]; then
    echo "❌ Error: task-cli.ts not found at $CLI_SCRIPT"
    exit 1
fi

# Find project root
find_project_root() {
    local dir
    dir="$(pwd)"
    while [ "$dir" != "/" ]; do
        if [ -d "$dir/.git" ] || [ -f "$dir/package.json" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    pwd
    return 1
}

# Handle help
if [ "$1" = "help" ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# If no arguments, show help
if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

PROJECT_ROOT="$(find_project_root)"

# Route commands
case "$1" in
  migrate)
    cd "$PROJECT_ROOT" && npx ts-node "$MIGRATE_SCRIPT" "$@"
    ;;
  *)
    # Run the task CLI with all arguments
    cd "$PROJECT_ROOT" && npx ts-node "$CLI_SCRIPT" "$@"
    ;;
esac
