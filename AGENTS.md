# AGENTS.md - OpenCode PM Architecture

## Quick Start

```bash
# Dev mode (from source)
cd packages/opencode && bun run --conditions=browser ./src/index.ts

# Build binary
cd packages/opencode && bun run build
# Output: dist/opencode-win32-x64.exe

# Regenerate SDK
./packages/sdk/js/script/build.ts
```

## 3-Tier Agent Hierarchy

| Depth | Agent        | Mode         | Tab Cycling | Interactive |
| ----- | ------------ | ------------ | ----------- | ----------- |
| 0     | PM           | primary      | build↔plan  | ✅          |
| 1     | Orchestrator | orchestrator | disabled    | ✅          |
| 2+    | Subagents    | subagent     | disabled    | ✅          |

## Navigation

| Keybind      | Action                    |
| ------------ | ------------------------- |
| Tab          | Cycle build/plan (depth 0 only) |
| Ctrl+X + ↑   | Go to parent session      |
| Ctrl+X + ↓   | Go to child session       |
| Ctrl+X + ←/→ | Cycle siblings (same depth) |

## Key Files

| File                   | Purpose                              |
| ---------------------- | ------------------------------------ |
| `agent/agent.ts`         | Agent definitions, modes             |
| `agent/prompt/pm.txt`    | PM system prompt                     |
| `agent/prompt/orchestrator.txt` | Orchestrator system prompt    |
| `tool/task.ts`           | Subagent spawning, depth assignment  |
| `tool/finish-task.ts`    | Orchestrator → PM handoff            |
| `tool/pm-state.ts`       | PM persistent state                  |
| `session/index.ts`       | Session schema (depth field)         |
| `tui/context/local.tsx`  | Agent locking for child sessions     |
| `tui/routes/session/index.tsx` | Navigation commands            |

## Spawn Rules

```
PM (primary) → orchestrator OR subagent
Orchestrator → subagent only
Subagent → nothing
```

## Tools by Agent Mode

| Tool         | primary | orchestrator | subagent |
| ------------ | ------- | ------------ | -------- |
| pm_state     | ✅      | ❌           | ❌       |
| finish_task  | ❌      | ✅           | ❌       |
| task         | ✅      | ✅           | ❌       |

## Code Style

- No semicolons
- 120 char line width  
- Default branch: `dev`
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE
