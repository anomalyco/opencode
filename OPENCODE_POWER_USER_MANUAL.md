# OpenCode Power User Manual

A comprehensive guide to mastering OpenCode - the open source AI coding agent for the terminal.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Concepts](#core-concepts)
3. [TUI Interface](#tui-interface)
4. [CLI Commands](#cli-commands)
5. [Configuration](#configuration)
6. [Agents](#agents)
7. [Custom Commands](#custom-commands)
8. [Skills & Plugins](#skills--plugins)
9. [MCP Servers](#mcp-servers)
10. [Rules & Instructions](#rules--instructions)
11. [Advanced Workflows](#advanced-workflows)
12. [Tips & Tricks](#tips--tricks)

---

## Quick Start

### Installation

```bash
# Recommended - always up to date
brew install anomalyco/tap/opencode

# Other options
curl -fsSL https://opencode.ai/install | bash
npm i -g opencode-ai@latest
scoop install opencode              # Windows
paru -S opencode-bin                # Arch Linux
nix run nixpkgs#opencode            # Nix
```

### First Run

```bash
cd /path/to/your/project
opencode
```

This launches the interactive TUI. OpenCode will:
1. Detect your project structure
2. Initialize LSP for code intelligence
3. Start in **build** mode (full access agent)

### Non-Interactive Mode

```bash
# Quick one-off questions
opencode -p "Explain the authentication flow in this codebase"

# JSON output for scripting
opencode -p "List all TODO comments" -f json

# Quiet mode (minimal output)
opencode -p "Fix the typo in README.md" -q
```

---

## Core Concepts

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         OpenCode                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐         │
│  │   TUI   │   │   CLI   │   │ Desktop │   │   API   │         │
│  └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘         │
│       └─────────────┴─────────────┴─────────────┘               │
│                          │                                       │
│              ┌───────────▼───────────┐                          │
│              │     HTTP Server       │                          │
│              │       (Hono)          │                          │
│              └───────────┬───────────┘                          │
│                          │                                       │
│       ┌──────────────────┼──────────────────┐                   │
│       ▼                  ▼                  ▼                   │
│  ┌─────────┐       ┌─────────┐       ┌─────────┐               │
│  │ Session │       │  Agent  │       │Provider │               │
│  │ Manager │       │ System  │       │  Layer  │               │
│  └─────────┘       └─────────┘       └─────────┘               │
│       │                  │                  │                   │
│       └──────────────────┼──────────────────┘                   │
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │    Tool Registry      │                          │
│              │ (bash, edit, read...) │                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Purpose |
|-----------|---------|
| **Session** | A conversation thread with full history |
| **Agent** | Personality + permissions + model selection |
| **Provider** | LLM backend (Anthropic, OpenAI, Google, etc.) |
| **Tool** | Action the AI can take (edit files, run bash, etc.) |
| **MCP Server** | External tool integration via Model Context Protocol |

---

## TUI Interface

### Launching the TUI

```bash
opencode          # Interactive mode
opencode tui      # Explicit TUI command
opencode attach   # Attach to running backend
```

### Leader Key System

OpenCode uses a **leader key** to avoid terminal conflicts. Default: `Ctrl+X`

Most shortcuts require: `Leader` → `Key`

### Essential Keybindings

| Shortcut | Action |
|----------|--------|
| `Ctrl+X` `N` | New session |
| `Ctrl+X` `S` | Session list |
| `Ctrl+X` `H` | Help / command palette |
| `Ctrl+P` | Command palette (searchable) |
| `Tab` | Toggle between Build/Plan mode |
| `Ctrl+C` | Cancel current operation |
| `Ctrl+D` | Exit |
| `@` | Fuzzy file search |
| `/` | Slash command |

### Input Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+A` | Move to start of line |
| `Ctrl+E` | Move to end of line |
| `Alt+B` | Move word backward |
| `Alt+F` | Move word forward |
| `Ctrl+W` | Delete word backward |
| `Alt+D` | Delete word forward |
| `Ctrl+U` | Delete to start of line |
| `Ctrl+K` | Delete to end of line |

### Modes

| Mode | Description |
|------|-------------|
| **Build** | Full access - can edit files, run commands |
| **Plan** | Read-only - analyzes and suggests without making changes |

Toggle with `Tab` key.

### File Attachment

Use `@` to fuzzy search and attach files to your message:

```
@src/auth/  → Attaches all files in auth directory
@*.ts       → Attach TypeScript files
@README     → Fuzzy matches README.md
```

---

## CLI Commands

### Primary Commands

```bash
# Start interactive TUI
opencode

# Run with prompt (non-interactive)
opencode run "your message here"
opencode -p "your message here"      # shorthand

# Continue last session
opencode -c "follow up message"
opencode --continue

# Resume specific session
opencode -s SESSION_ID "message"
opencode --session abc123
```

### Session Management

```bash
# List sessions
opencode session list

# Export session
opencode export SESSION_ID

# Import session
opencode import SESSION_FILE
```

### Model & Provider

```bash
# List available models
opencode models

# Use specific model
opencode -m anthropic/claude-sonnet-4-5 "message"
opencode --model openai/gpt-4o "message"

# Authentication
opencode auth login PROVIDER
opencode auth logout PROVIDER
opencode auth status
```

### Agent Commands

```bash
# List agents
opencode agent list

# Create custom agent
opencode agent create

# Use specific agent
opencode --agent plan "analyze this codebase"
```

### MCP Server Management

```bash
# List MCP servers
opencode mcp list

# Authenticate MCP server
opencode mcp auth SERVER_NAME
```

### Utility Commands

```bash
# Update OpenCode
opencode upgrade
opencode upgrade --version 0.5.0    # specific version

# Uninstall
opencode uninstall

# Generate stats
opencode stats

# Start server only (for remote access)
opencode serve --port 4096
```

### Output Formats

```bash
# Default (styled terminal output)
opencode -p "explain this"

# JSON (for scripting)
opencode -p "list functions" -f json

# Quiet (minimal)
opencode -p "fix typo" -q
```

---

## Configuration

### Config File Locations

Config files are merged in this order (later overrides earlier):

1. **Remote** - `https://your-org/.well-known/opencode` (organizational defaults)
2. **Global** - `~/.config/opencode/opencode.json` (user preferences)
3. **Custom** - `$OPENCODE_CONFIG` environment variable
4. **Project** - `./opencode.json` (project root)
5. **Inline** - `$OPENCODE_CONFIG_CONTENT` environment variable

### Basic Configuration

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",

  // Default model
  "model": "anthropic/claude-sonnet-4-5",

  // Theme
  "theme": "opencode",

  // Auto-update behavior: true | false | "notify"
  "autoupdate": true,

  // Default agent
  "default_agent": "build"
}
```

### Provider Configuration

```jsonc
{
  "provider": {
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      }
    },
    "openai": {
      "npm": "@ai-sdk/openai",
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}",
        "baseURL": "https://api.openai.com/v1"
      }
    },
    "ollama": {
      "npm": "ollama-ai-provider",
      "options": {
        "baseURL": "http://localhost:11434/api"
      }
    }
  }
}
```

### Keybind Configuration

```jsonc
{
  "keybinds": {
    "leader": "ctrl+x",
    "new_session": "n",
    "session_list": "s",
    "help": "h",
    "command_palette": "ctrl+p"
  }
}
```

### Tool Configuration

```jsonc
{
  "tools": {
    // Disable specific tools
    "bash": false,

    // Configure tool behavior
    "edit": {
      "enabled": true
    }
  }
}
```

### LSP Configuration

```jsonc
{
  "lsp": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"]
    },
    "python": {
      "disabled": true
    }
  }
}
```

### Scroll Settings

```jsonc
{
  "scroll_speed": 3,
  "scroll_acceleration": true
}
```

### Environment Variable Substitution

Use `{env:VAR}` for sensitive values:

```jsonc
{
  "provider": {
    "custom": {
      "options": {
        "apiKey": "{env:MY_API_KEY}",
        "orgId": "{env:MY_ORG_ID}"
      }
    }
  }
}
```

---

## Agents

### Built-in Agents

| Agent | Mode | Description |
|-------|------|-------------|
| **build** | Primary | Default full-access agent for development |
| **plan** | Primary | Read-only for analysis and planning |
| **general** | Subagent | Complex searches and multi-step tasks |

### Switching Agents

```bash
# Via CLI flag
opencode --agent plan "analyze the architecture"

# In TUI
# Press Tab to toggle build/plan
# Use @general in message to invoke subagent
```

### Custom Agent (JSON)

```jsonc
// opencode.json
{
  "agent": {
    "reviewer": {
      "description": "Code review specialist",
      "model": "anthropic/claude-sonnet-4-5",
      "temperature": 0.3,
      "prompt": "You are a thorough code reviewer...",
      "permission": [
        { "glob": ["bash(**)"], "action": "deny" },
        { "glob": ["read(**)"], "action": "allow" }
      ]
    }
  }
}
```

### Custom Agent (Markdown)

Create `~/.config/opencode/agent/reviewer.md` or `.opencode/agent/reviewer.md`:

```markdown
---
description: Code review specialist
model: anthropic/claude-sonnet-4-5
temperature: 0.3
---

You are a thorough code reviewer focused on:
- Security vulnerabilities
- Performance issues
- Code maintainability
- Best practices

Always explain your reasoning and provide specific line references.
```

### Agent Permissions

```jsonc
{
  "permission": [
    // Allow all reads
    { "glob": ["read(**)"], "action": "allow" },

    // Allow edits only in src/
    { "glob": ["edit(src/**)"], "action": "allow" },
    { "glob": ["edit(**)"], "action": "deny" },

    // Ask before running bash
    { "glob": ["bash(**)"], "action": "ask" },

    // Deny dangerous commands
    { "glob": ["bash(rm -rf*)", "bash(sudo*)"], "action": "deny" }
  ]
}
```

---

## Custom Commands

Custom commands are reusable prompts saved as Markdown files.

### Location

- Global: `~/.config/opencode/command/`
- Project: `.opencode/command/`

### Basic Command

Create `.opencode/command/test.md`:

```markdown
---
description: Run tests for current file
---

Run the tests for the current file and fix any failures.
Make sure all tests pass before finishing.
```

Usage: `/test` in TUI or `opencode --command test`

### Command with Arguments

Create `.opencode/command/review.md`:

```markdown
---
description: Review specific file or directory
---

Review the following code for issues: $ARGUMENTS

Focus on:
- Security vulnerabilities
- Performance problems
- Code smells
```

Usage: `/review src/auth/login.ts`

### Command with Shell Output

Use `!` to embed command output:

```markdown
---
description: Commit with conventional message
---

Create a commit based on the current changes.

## Current Status
!`git status --short`

## Staged Changes
!`git diff --cached`

Write a conventional commit message (feat:, fix:, docs:, etc.)
```

### Command Configuration Options

```markdown
---
description: My command description
model: anthropic/claude-sonnet-4-5    # Override model
subtask: true                          # Run as background subtask
agent: plan                            # Use specific agent
---
```

### Override Built-in Commands

Create a command with the same name as a built-in to override it:

`.opencode/command/init.md` overrides `/init`

---

## Skills & Plugins

### Skills

Skills are directory-based capability bundles.

**Location:**
- Global: `~/.config/opencode/skill/` or `~/.opencode/skills/`
- Project: `.opencode/skill/`

**Structure:**
```
.opencode/skill/
└── database/
    ├── SKILL.md           # Required
    ├── schema.sql         # Supporting files
    └── migrations/
```

**SKILL.md format:**
```markdown
---
name: Database Expert
description: PostgreSQL schema design and optimization
---

You have expertise in PostgreSQL database design.
Refer to the schema.sql file for the current database structure.

Always consider:
- Index optimization
- Query performance
- Data integrity constraints
```

### Plugins

Plugins extend OpenCode with custom tools and hooks.

**Location:**
- Global: `~/.config/opencode/plugin/`
- Project: `.opencode/plugin/`

**Basic Plugin:**

```typescript
// .opencode/plugin/logger.ts
export default function loggerPlugin(ctx) {
  return {
    hooks: {
      "tool.execute.before": async ({ tool }, { args }) => {
        console.log(`Executing tool: ${tool}`, args)
      },
      "tool.execute.after": async ({ tool }, result) => {
        console.log(`Tool completed: ${tool}`, result)
      }
    }
  }
}
```

**Available Hooks:**
- `tool.execute.before` - Before any tool runs
- `tool.execute.after` - After tool completes
- `chat.params` - Modify LLM parameters
- `chat.headers` - Add custom headers
- `experimental.chat.system.transform` - Transform system prompt

**Register in config:**
```jsonc
{
  "plugin": [
    ".opencode/plugin/logger.ts"
  ]
}
```

---

## MCP Servers

Model Context Protocol servers add external tools to OpenCode.

### Configuration

```jsonc
// opencode.json
{
  "mcp": {
    // Local server (stdio)
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
    },

    // Local with environment variables
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
      }
    },

    // Remote server
    "my-remote": {
      "type": "remote",
      "url": "https://mcp.example.com/sse",
      "headers": {
        "Authorization": "Bearer {env:MCP_TOKEN}"
      }
    }
  }
}
```

### Popular MCP Servers

| Server | Purpose | Install |
|--------|---------|---------|
| `@modelcontextprotocol/server-filesystem` | File system access | `npx -y @modelcontextprotocol/server-filesystem` |
| `@modelcontextprotocol/server-github` | GitHub integration | `npx -y @modelcontextprotocol/server-github` |
| `@modelcontextprotocol/server-postgres` | PostgreSQL queries | `npx -y @modelcontextprotocol/server-postgres` |
| `@modelcontextprotocol/server-playwright` | Browser automation | `npx -y @modelcontextprotocol/server-playwright` |
| `@modelcontextprotocol/server-memory` | Persistent memory | `npx -y @modelcontextprotocol/server-memory` |

### Authentication

```bash
# OAuth for remote servers
opencode mcp auth my-remote

# Tokens stored in ~/.local/share/opencode/mcp-auth.json
```

### Timeout Configuration

```jsonc
{
  "mcp": {
    "slow-server": {
      "command": "my-slow-server",
      "timeout": 30000  // 30 seconds (default: 5000ms)
    }
  }
}
```

---

## Rules & Instructions

### AGENTS.md Files

Provide persistent context and instructions to the AI.

**Locations (all are loaded):**
- Project root: `./AGENTS.md`
- Any subdirectory: `src/auth/AGENTS.md`
- Nested: `packages/api/src/AGENTS.md`

**How it works:** When reading a file, OpenCode loads AGENTS.md from all parent directories into context.

**Example `AGENTS.md`:**

```markdown
## Project Overview
This is a Next.js 14 application using the App Router.

## Key Conventions
- Use server components by default
- Client components must have "use client" directive
- All API routes are in app/api/

## Important Paths
- Authentication: src/lib/auth/
- Database: src/lib/db/
- Components: src/components/

## Testing
Run tests with: `bun test`
Integration tests require: `docker compose up -d`

## Common Gotchas
- The `user` table uses UUID, not auto-increment
- Always use `getServerSession()` not `getSession()` in server components
```

### Instructions Config

```jsonc
// opencode.json
{
  "instructions": [
    "AGENTS.md",
    ".opencode/rules/*.md",
    "docs/ai-context.md"
  ]
}
```

### Per-Message Instructions

In TUI, use system prompt syntax:

```
[system: Focus only on security implications]
Review the authentication code
```

---

## Advanced Workflows

### Multi-Session Parallel Work

```bash
# Terminal 1 - Backend work
cd backend && opencode

# Terminal 2 - Frontend work
cd frontend && opencode

# Terminal 3 - Attach to either
opencode attach --port 4096
```

### Scripting with OpenCode

```bash
#!/bin/bash
# auto-fix.sh - Auto-fix linting errors

ERRORS=$(npm run lint 2>&1)

if [ -n "$ERRORS" ]; then
  opencode -p "Fix these linting errors:\n$ERRORS" -q
  npm run lint
fi
```

### Git Workflow Integration

Create `.opencode/command/pr.md`:

```markdown
---
description: Create PR with AI-generated description
---

Create a pull request for the current branch.

## Branch Info
!`git branch --show-current`

## Commits
!`git log main..HEAD --oneline`

## Changes
!`git diff main...HEAD --stat`

Generate a clear PR title and description summarizing these changes.
Then run: gh pr create --title "TITLE" --body "DESCRIPTION"
```

### Session Sharing

```bash
# Share current session
/share

# Share via CLI
opencode session share SESSION_ID
```

Generates a shareable link for collaboration/debugging.

### Remote Development

```bash
# On remote machine
opencode serve --port 4096

# On local machine
opencode attach http://remote-host:4096

# Or via SSH tunnel
ssh -L 4096:localhost:4096 user@remote
opencode attach http://localhost:4096
```

---

## Tips & Tricks

### 1. Use Plan Mode First

Before making changes to unfamiliar code:
```
Tab → Switch to Plan mode
"Explain how the payment flow works"
Tab → Switch to Build mode
"Now refactor the payment validation"
```

### 2. Leverage @-mentions

```
@src/          # Attach entire directory
@package.json  # Single file
@*.test.ts     # Glob pattern
@general       # Invoke general subagent
```

### 3. Undo/Redo

```
/undo    # Revert last AI changes
/redo    # Restore reverted changes
```

### 4. Use the Editor

```
/editor  # Opens $EDITOR for complex prompts
```

### 5. Quick Context

Add context inline:
```
The auth token expires after 24h, fix the refresh logic in @src/auth/token.ts
```

### 6. Model Switching

Different tasks, different models:
```bash
# Quick questions - fast model
opencode -m openai/gpt-4o-mini "what does this regex do"

# Complex refactoring - powerful model
opencode -m anthropic/claude-sonnet-4-5 "refactor auth system"
```

### 7. Session Continuation

```bash
# Continue where you left off
opencode -c

# Resume specific session
opencode session list
opencode -s abc123
```

### 8. Cost-Effective Development

```jsonc
// Use cheaper models for routine tasks
{
  "agent": {
    "quick": {
      "model": "openai/gpt-4o-mini",
      "description": "Fast answers"
    }
  }
}
```

### 9. Debug Mode

```bash
# Verbose logging
OPENCODE_LOG_LEVEL=debug opencode
```

### 10. Learn from Sessions

Use the built-in learn command to extract insights:
```
/learn
```

This analyzes your session and updates AGENTS.md files with non-obvious learnings.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENCODE_CONFIG` | Path to custom config file |
| `OPENCODE_CONFIG_CONTENT` | Inline JSON config |
| `OPENCODE_CONFIG_DIR` | Additional config directory |
| `OPENCODE_LOG_LEVEL` | Logging verbosity (debug, info, warn, error) |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | Ignore project opencode.json |
| `OPENCODE_INSTALL_DIR` | Custom installation path |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google AI API key |

---

## Troubleshooting

### LSP Not Working

```bash
# Check LSP status in TUI
/lsp status

# Manually configure in opencode.json
{
  "lsp": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"]
    }
  }
}
```

### MCP Server Not Loading

1. Check timeout (default 5s may be too short)
2. Verify command works standalone
3. Check logs: `OPENCODE_LOG_LEVEL=debug opencode`

### Permission Denied

Check agent permissions in config:
```jsonc
{
  "agent": {
    "build": {
      "permission": [
        { "glob": ["bash(**)"], "action": "allow" }
      ]
    }
  }
}
```

### High Token Usage

- Use Plan mode for exploration
- Attach specific files, not entire directories
- Use message compaction: `/compact`
- Consider MCP server token overhead

---

## Resources

- **Official Docs**: https://opencode.ai/docs/
- **GitHub**: https://github.com/opencode-ai/opencode
- **Discord**: https://discord.gg/opencode
- **Config Schema**: https://opencode.ai/config.json

---

*This manual covers OpenCode as of 2025. Features may change - check official docs for latest.*
