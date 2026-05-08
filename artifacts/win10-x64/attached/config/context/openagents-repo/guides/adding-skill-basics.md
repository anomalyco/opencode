<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Adding an OpenCode Skill (Basics)

**Prerequisites**: Load `plugins/context/capabilities/events_skills.md` first  
**Purpose**: Create an OpenCode skill directory and SKILL.md file

**Note**: This is for **OpenCode skills** (internal system). For **Claude Code Skills**, see `creating-skills.md`.

---

## Overview

Adding an OpenCode skill involves:
1. Creating skill directory structure
2. Creating SKILL.md file
3. Creating router script (optional)
4. Creating CLI implementation (optional)
5. Registering in registry (optional)
6. Testing

**Time**: ~10-15 minutes

---

## Step 1: Create Skill Directory

### Choose Skill Name

- **kebab-case**: `task-management`, `brand-guidelines`
- **Descriptive**: Clear indication of what skill provides
- **Short**: Max 3-4 words

### Create Structure

```bash
mkdir -p .opencode/skills/{skill-name}/scripts
```

**Standard structure**:
```
.opencode/skills/{skill-name}/
├── SKILL.md              # Required: Main skill documentation
├── router.sh             # Optional: CLI router script
└── scripts/
    └── skill-cli.ts      # Optional: CLI tool implementation
```

---

## Step 2: Create SKILL.md

### Frontmatter

```markdown
---
name: {skill-name}
description: Brief description of what the skill provides
---

# Skill Name

**Purpose**: What this skill helps users do

## What I do

- Feature 1
- Feature 2
- Feature 3

## How to use me

### Basic Commands

```bash
npx ts-node .opencode/skills/{skill-name}/scripts/skill-cli.ts command1
```

### Command Reference

| Command | Description |
|---------|-------------|
| `command1` | What command1 does |
| `command2` | What command2 does |
```

### Claude Code Skills (Optional)

For Claude Code Skills (`.claude/skills/`), add extra frontmatter:
- `allowed-tools` - Tool restrictions
- `context` + `agent` - Run in forked subagent
- `hooks` - Lifecycle events
- `user-invocable` - Hide from slash menu

See `creating-skills.md` for Claude Code Skills details.

---

## Step 3: Create Router Script (Optional)

For CLI-based skills:

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -eq 0 ]; then
    echo "Usage: bash router.sh <command> [options]"
    exit 1
fi

COMMAND="$1"
shift

case "$COMMAND" in
    help|--help|-h)
        echo "{Skill Name} - Description"
        echo "Commands: command1, command2, help"
        ;;
    command1|command2)
        npx ts-node "$SCRIPT_DIR/scripts/skill-cli.ts" "$COMMAND" "$@"
        ;;
    *)
        echo "Unknown command: $COMMAND"
        exit 1
        ;;
esac
```

```bash
chmod +x .opencode/skills/{skill-name}/router.sh
```

---

## Next Steps

- **CLI Implementation** → `adding-skill-implementation.md`
- **Complete Example** → `adding-skill-example.md`
- **Claude Code Skills** → `creating-skills.md`

---

## Related

- `creating-skills.md` - Claude Code Skills (different system)
- `adding-skill-implementation.md` - CLI and registry
- `adding-skill-example.md` - Task-management example
- `plugins/context/capabilities/events_skills.md` - Skills Plugin
