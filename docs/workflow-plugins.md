# Workflow Plugins

Workflow plugins extend CoBuilder with slash commands and agent prompts organized as a directory.

## Directory Layout

```
~/.config/opencode/workflows/
└── my-workflow/
    ├── WORKFLOW.md        # Required manifest
    ├── commands/          # Slash commands (*.md files)
    ├── agents/            # Agent prompts (*.md files, optional)
    └── hooks/             # Lifecycle hooks (reserved for future use)
```

## WORKFLOW.md Format

Every plugin must have a `WORKFLOW.md` at its root with YAML frontmatter:

```markdown
---
name: my-workflow
version: 1.0.0
description: What this workflow does
commands:
  - my-command
---

# My Workflow

Optional markdown body — appears as documentation.
```

## CLI Commands

```bash
# Install from built-in alias
cobuilder workflow add gsd

# Install from GitHub URL
cobuilder workflow add https://github.com/org/my-workflow

# List installed workflows
cobuilder workflow list

# Remove a workflow
cobuilder workflow remove gsd
```

## Built-in Aliases

| Alias | Repository |
|-------|-----------|
| `gsd` | https://github.com/CobuilderLabs/gsd-workflow |
| `ralph-loop` | https://github.com/CobuilderLabs/ralph-loop-workflow |
| `gstack` | https://github.com/CobuilderLabs/gstack-workflow |

## How Commands Are Loaded

When a workflow is installed, its path is added to `workflow.paths` in `~/.config/opencode/opencode.json`.
On the next startup, CoBuilder scans `commands/**/*.md` in each registered path and makes them
available as slash commands in the TUI.

Note: Restart CoBuilder after installing a workflow to activate its commands.

## Hooks (Future)

The `hooks/` directory is reserved for lifecycle hooks in a future release. Creating it in your plugin
is safe — no hooks are executed in the current version. hooks are reserved for future use.
