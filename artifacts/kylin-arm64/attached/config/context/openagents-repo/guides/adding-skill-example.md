<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Example: Task-Management Skill

**Purpose**: Complete example of creating an OpenCode skill

---

## Directory Structure

```bash
mkdir -p .opencode/skills/task-management/scripts
```

```
.opencode/skills/task-management/
├── SKILL.md
├── router.sh
└── scripts/
    └── task-cli.ts
```

---

## SKILL.md

```markdown
---
name: task-management
description: Task management CLI for tracking feature subtasks
---

# Task Management Skill

**Purpose**: Track and manage feature subtasks

## What I do

- Track task progress
- Show next eligible tasks
- Identify blocked tasks
- Mark completion
- Validate task integrity

## Usage

```bash
# Show all task statuses
npx ts-node .opencode/skills/task-management/scripts/task-cli.ts status

# Show next eligible tasks
npx ts-node .opencode/skills/task-management/scripts/task-cli.ts next

# Mark complete
npx ts-node .opencode/skills/task-management/scripts/task-cli.ts complete <feature> <seq> "summary"
```
```

---

## router.sh

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$1" in
    help|--help|-h)
        echo "Task Management Skill"
        echo "Usage: bash router.sh <command>"
        echo "Commands: status, next, blocked, complete, validate"
        ;;
    status|next|blocked|validate)
        npx ts-node "$SCRIPT_DIR/scripts/task-cli.ts" "$@"
        ;;
    complete)
        npx ts-node "$SCRIPT_DIR/scripts/task-cli.ts" "$@"
        ;;
    *)
        echo "Unknown command: $1"
        bash "$0" help
        ;;
esac
```

---

## task-cli.ts (Excerpt)

```typescript
#!/usr/bin/env ts-node

interface Task {
  id: string
  status: 'pending' | 'in_progress' | 'completed'
  title: string
}

async function main() {
  const command = process.argv[2] || 'help'
  
  switch (command) {
    case 'status':
      await showStatus()
      break
    case 'next':
      await showNext()
      break
    case 'complete':
      const [, , , feature, seq, summary] = process.argv
      await markComplete(feature, seq, summary)
      break
    default:
      showHelp()
  }
}

async function showStatus() {
  // Implementation
  console.log('Task status...')
}

async function showNext() {
  // Implementation
  console.log('Next tasks...')
}

async function markComplete(feature: string, seq: string, summary: string) {
  // Implementation
  console.log(`Completing ${feature} ${seq}: ${summary}`)
}

function showHelp() {
  console.log(`
Task Management CLI

Commands:
  status              Show all task statuses
  next                Show next eligible tasks
  blocked             Show blocked tasks
  complete <f> <s>    Mark task complete
  validate            Validate task integrity
`)
}

main().catch(console.error)
```

---

## Integration with Agents

Skills integrate with agents via:
- Event hooks (`tool.execute.before`, `tool.execute.after`)
- Skill content injection into conversation
- Output enhancement

Example agent prompt invoking skill:
```
Use the task-management skill to show current task status
```

---

## Related

- `adding-skill-basics.md` - Directory and SKILL.md setup
- `adding-skill-implementation.md` - CLI and registry
- `plugins/context/capabilities/events_skills.md` - Skills Plugin
