#!/bin/bash
# Create Bootstrap Task for First-Time Setup
#
# Creates a guided task to help users fill in project guidelines
# after initializing Trellis for the first time.
#
# Usage:
#   ./.trellis/scripts/create-bootstrap.sh [project-type]
#
# Arguments:
#   project-type: frontend | backend | fullstack (default: fullstack)
#
# Prerequisites:
#   - .trellis/.developer must exist (run init-developer.sh first)
#
# Creates:
#   .trellis/tasks/00-bootstrap-guidelines/
#     ├── task.json    # Task metadata
#     └── prd.md       # Task description and guidance

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common/paths.sh"
source "$SCRIPT_DIR/common/developer.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TASK_NAME="00-bootstrap-guidelines"

# Project type (default: fullstack)
PROJECT_TYPE="${1:-fullstack}"

# Validate project type
case "$PROJECT_TYPE" in
  frontend|backend|fullstack)
    ;;
  *)
    echo -e "${YELLOW}Unknown project type: $PROJECT_TYPE, defaulting to fullstack${NC}"
    PROJECT_TYPE="fullstack"
    ;;
esac

# =============================================================================
# PRD Content
# =============================================================================

write_prd_header() {
  cat << 'EOF'
# Bootstrap: Fill Project Development Guidelines

## Purpose

Welcome to Trellis! This is your first task.

AI agents use `.trellis/spec/` to understand YOUR project's coding conventions.
**Empty templates = AI writes generic code that doesn't match your project style.**

Filling these guidelines is a one-time setup that pays off for every future AI session.

---

## Your Task

Fill in the guideline files based on your **existing codebase**.
EOF
}

write_prd_backend_section() {
  cat << 'EOF'

### Backend Guidelines

| File | What to Document |
|------|------------------|
| `.trellis/spec/backend/directory-structure.md` | Where different file types go (routes, services, utils) |
| `.trellis/spec/backend/database-guidelines.md` | ORM, migrations, query patterns, naming conventions |
| `.trellis/spec/backend/error-handling.md` | How errors are caught, logged, and returned |
| `.trellis/spec/backend/logging-guidelines.md` | Log levels, format, what to log |
| `.trellis/spec/backend/quality-guidelines.md` | Code review standards, testing requirements |
EOF
}

write_prd_frontend_section() {
  cat << 'EOF'

### Frontend Guidelines

| File | What to Document |
|------|------------------|
| `.trellis/spec/frontend/directory-structure.md` | Component/page/hook organization |
| `.trellis/spec/frontend/component-guidelines.md` | Component patterns, props conventions |
| `.trellis/spec/frontend/hook-guidelines.md` | Custom hook naming, patterns |
| `.trellis/spec/frontend/state-management.md` | State library, patterns, what goes where |
| `.trellis/spec/frontend/type-safety.md` | TypeScript conventions, type organization |
| `.trellis/spec/frontend/quality-guidelines.md` | Linting, testing, accessibility |
EOF
}

write_prd_footer() {
  cat << 'EOF'

### Thinking Guides (Optional)

The `.trellis/spec/guides/` directory contains thinking guides that are already
filled with general best practices. You can customize them for your project if needed.

---

## How to Fill Guidelines

### Principle: Document Reality, Not Ideals

Write what your codebase **actually does**, not what you wish it did.
AI needs to match existing patterns, not introduce new ones.

### Steps

1. **Look at existing code** - Find 2-3 examples of each pattern
2. **Document the pattern** - Describe what you see
3. **Include file paths** - Reference real files as examples
4. **List anti-patterns** - What does your team avoid?

---

## Tips for Using AI

Ask AI to help analyze your codebase:

- "Look at my codebase and document the patterns you see"
- "Analyze my code structure and summarize the conventions"
- "Find error handling patterns and document them"

The AI will read your code and help you document it.

---

## Completion Checklist

- [ ] Guidelines filled for your project type
- [ ] At least 2-3 real code examples in each guideline
- [ ] Anti-patterns documented

When done:

```bash
./.trellis/scripts/task.sh finish
./.trellis/scripts/task.sh archive 00-bootstrap-guidelines
```

---

## Why This Matters

After completing this task:

1. AI will write code that matches your project style
2. Relevant `/trellis:before-*-dev` commands will inject real context
3. `/trellis:check-*` commands will validate against your actual standards
4. Future developers (human or AI) will onboard faster
EOF
}

write_prd() {
  local dir="$1"
  local project_type="$2"

  {
    write_prd_header

    case "$project_type" in
      frontend)
        write_prd_frontend_section
        ;;
      backend)
        write_prd_backend_section
        ;;
      fullstack)
        write_prd_backend_section
        write_prd_frontend_section
        ;;
    esac

    write_prd_footer
  } > "$dir/prd.md"
}

# =============================================================================
# Task JSON
# =============================================================================

write_task_json() {
  local dir="$1"
  local developer="$2"
  local project_type="$3"
  local today=$(date +%Y-%m-%d)

  # Generate subtasks based on project type
  local subtasks
  local related_files

  case "$project_type" in
    frontend)
      subtasks='[
    {"name": "Fill frontend guidelines", "status": "pending"},
    {"name": "Add code examples", "status": "pending"}
  ]'
      related_files='[
    ".trellis/spec/frontend/"
  ]'
      ;;
    backend)
      subtasks='[
    {"name": "Fill backend guidelines", "status": "pending"},
    {"name": "Add code examples", "status": "pending"}
  ]'
      related_files='[
    ".trellis/spec/backend/"
  ]'
      ;;
    fullstack)
      subtasks='[
    {"name": "Fill backend guidelines", "status": "pending"},
    {"name": "Fill frontend guidelines", "status": "pending"},
    {"name": "Add code examples", "status": "pending"}
  ]'
      related_files='[
    ".trellis/spec/backend/",
    ".trellis/spec/frontend/"
  ]'
      ;;
  esac

  cat > "$dir/task.json" << EOF
{
  "id": "$TASK_NAME",
  "name": "Bootstrap Guidelines",
  "description": "Fill in project development guidelines for AI agents",
  "status": "in_progress",
  "dev_type": "docs",
  "priority": "P1",
  "creator": "$developer",
  "assignee": "$developer",
  "createdAt": "$today",
  "completedAt": null,
  "commit": null,
  "subtasks": $subtasks,
  "relatedFiles": $related_files,
  "notes": "First-time setup task created by trellis init ($project_type project)"
}
EOF
}

# =============================================================================
# Main
# =============================================================================

main() {
  local repo_root=$(get_repo_root)
  local developer=$(get_developer "$repo_root")

  # Check developer initialized
  if [[ -z "$developer" ]]; then
    echo -e "${RED}Error: Developer not initialized${NC}"
    echo "Run: ./$DIR_WORKFLOW/$DIR_SCRIPTS/init-developer.sh <your-name>"
    exit 1
  fi

  local tasks_dir=$(get_tasks_dir "$repo_root")
  local task_dir="$tasks_dir/$TASK_NAME"
  local relative_path="$DIR_WORKFLOW/$DIR_TASKS/$TASK_NAME"

  # Check if already exists
  if [[ -d "$task_dir" ]]; then
    echo -e "${YELLOW}Bootstrap task already exists: $relative_path${NC}"
    exit 0
  fi

  # Create task directory
  mkdir -p "$task_dir"

  # Write files
  write_task_json "$task_dir" "$developer" "$PROJECT_TYPE"
  write_prd "$task_dir" "$PROJECT_TYPE"

  # Set as current task
  set_current_task "$relative_path" "$repo_root"

  # Silent output - init command handles user-facing messages
  # Only output the task path for programmatic use
  echo "$relative_path"
}

main "$@"
