# Agent Team Plugin

Multi-agent orchestration plugin for [OpenCode](https://opencode.ai). Spawn, coordinate, and manage multiple AI agents that communicate through a central orchestrator, each with isolated workspaces, budget controls, and permission boundaries.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [Available Tools](#available-tools)
- [Agent Lifecycle](#agent-lifecycle)
- [Message Routing](#message-routing)
- [Task Queue](#task-queue)
- [Budget Management](#budget-management)
- [Permission System](#permission-system)
- [State Persistence & Recovery](#state-persistence--recovery)
- [Garbage Collection](#garbage-collection)
- [Audit & Telemetry](#audit--telemetry)
- [TUI Integration](#tui-integration)
- [Configuration Reference](#configuration-reference)
- [Development](#development)

---

## Overview

The Agent Team Plugin turns a single OpenCode instance into a multi-agent team. Each agent runs as a separate session with its own workspace, capabilities, and budget. Agents communicate through an in-process orchestrator that handles:

- **Message routing** between agents (direct, broadcast, dead-letter handling)
- **Task delegation** with priority queueing and capability matching
- **Budget enforcement** (per-task, per-agent-daily, team-daily limits)
- **Permission boundaries** (workspace isolation, protected paths, dangerous command blocking)
- **State persistence** (snapshot + WAL for crash recovery)
- **Audit logging** (append-only JSONL trail of all agent actions)

All coordination happens in-process — tools call orchestrator methods directly. IPC is only used when agents run as separate child processes.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Orchestrator (in-process)                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   Registry    │  │    Router     │  │    State Manager       │ │
│  │  (agents,     │  │  (messages,   │  │  (snapshot + WAL,      │ │
│  │   status,     │  │   FIFO queues)│  │   recovery)            │ │
│  │   caps)       │  │              │  │                        │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Task Queue  │  │   Watchdog   │  │     GC Scheduler       │ │
│  │  (priority,  │  │  (heartbeat, │  │  (worktree cleanup,    │ │
│  │   depth,     │  │   zombie     │  │   disk quota,          │ │
│  │   caps)      │  │   detection) │  │   retention policy)    │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Budget Mgr  │  │  Audit Logger│  │    Telemetry           │ │
│  │  (tokens,    │  │  (.jsonl)    │  │  (events, stats,       │ │
│  │   cost cap)  │  │              │  │   dashboard data)      │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
│  State: .opencode/team/                                          │
└──────────────────────────────────────────────────────────────────┘
```

### File Structure

```
project/
├── .opencode/
│   ├── opencode.jsonc           # plugin config (this plugin)
│   └── team/                    # orchestrator runtime state
│       ├── state.json           # state snapshot
│       ├── wal.jsonl            # write-ahead log
│       ├── audit.jsonl          # audit trail
│       ├── telemetry.jsonl      # telemetry events
│       ├── inbox/               # per-agent message queues
│       │   └── {agent_id}.jsonl
│       └── dead-letter/         # undeliverable messages
│           └── {agent_id}.jsonl
├── packages/agent-team/         # this plugin
│   ├── src/
│   │   ├── server.ts            # server plugin entry
│   │   ├── tui.ts               # TUI plugin entry
│   │   ├── config.ts            # TeamConfig Zod schema
│   │   ├── orchestrator/        # core modules
│   │   ├── protocol/            # message types + schemas
│   │   ├── tools/               # 8 A2A tools
│   │   ├── hooks/               # 6 server hooks
│   │   ├── tui/                 # TUI components
│   │   └── util/                # IPC + workspace helpers
│   └── test/                    # 262 tests
```

---

## Installation

### 1. Add to `opencode.jsonc`

Open your project's `.opencode/opencode.jsonc` and add the plugin:

```jsonc
{
  "plugin": [
    [
      "/path/to/packages/agent-team",
      {
        "enabled": true,
        "limits": {
          "max_agents": 5,
          "max_concurrent_tasks": 3,
        },
        "budget": {
          "daily_limit_usd": 50,
          "per_agent_daily_usd": 15,
          "per_task_max_usd": 5,
        },
      },
    ],
  ],
}
```

The first element is the path to the plugin package. The second element is the config object — it gets validated through the `TeamConfig` Zod schema and passed to the orchestrator.

### 2. Verify it loads

Start opencode. The plugin registers 8 tools, 7 hooks, and 5 TUI commands. You should see `agent_list`, `agent_send`, etc. available in the tool list.

### 3. Minimal config (defaults only)

If you just want to try it with all defaults:

```jsonc
{
  "plugin": [["/path/to/packages/agent-team", { "enabled": true }]],
}
```

This gives you: 10 max agents, 5 max concurrent tasks, $50/day team budget, $15/agent/day, $5/task max, 2-minute zombie timeout, 3-day GC cleanup.

---

## Configuration

All configuration lives in the plugin options in `opencode.jsonc`. Here's a full example with every field:

```jsonc
[
  "/path/to/packages/agent-team",
  {
    // Master switch. Plugin is inert when false.
    "enabled": true,

    // Agent definitions — declare your team composition.
    // Each agent gets its own workspace at .opencode/workspaces/workspace-{id}/
    "agents": {
      "coder": {
        "role": "coder",
        "role_priority": 10,
        "capabilities": {
          "tools": ["read", "edit", "bash", "glob", "grep", "list"],
          "share_to_team": true,
          "delegate": true,
          "max_delegation_depth": 2,
          "disk_quota_mb": 500,
        },
        "max_tasks_per_day": 50,
        "disk_quota_mb": 500,
      },
      "reviewer": {
        "role": "reviewer",
        "role_priority": 20,
        "capabilities": {
          "tools": ["read", "glob", "grep", "list"],
          "share_to_team": false,
          "delegate": false,
          "max_delegation_depth": 0,
          "disk_quota_mb": 200,
        },
      },
      "architect": {
        "role": "architect",
        "role_priority": 30,
        "capabilities": {
          "tools": ["read", "glob", "grep", "list", "webfetch"],
          "delegate": true,
          "max_delegation_depth": 3,
        },
      },
    },

    // Human authority level:
    //   "always"    — agents must ask human before acting (default)
    //   "advisory"  — agents can act but notify human
    //   "none"      — agents act autonomously
    "human_authority": "always",

    // Human role hierarchy for permission resolution
    "humans": {
      "hierarchy": ["admin", "developer"],
    },

    // Operational limits
    "limits": {
      "max_agents": 10, // max live agents (excludes "dead")
      "max_concurrent_tasks": 5, // max simultaneously assigned tasks
      "max_delegation_depth": 3, // max delegation chain depth
      "max_messages_per_minute": 30, // per sender→receiver pair
      "message_ttl_seconds": 86400, // 24 hours
      "task_timeout_seconds": 1800, // 30 minutes
      "tool_execution_timeout_seconds": 60, // 1 minute
    },

    // Budget controls (USD)
    "budget": {
      "daily_limit_usd": 50, // team-wide daily cap
      "per_agent_daily_usd": 15, // per-agent daily cap
      "per_task_max_usd": 5, // per-task max
      "per_task_max_tokens": 200000, // per-task token max
    },

    // Garbage collection
    "gc": {
      "cleanup_timeout_ms": 259200000, // 3 days — inactive worktree cleanup
      "gc_interval_ms": 3600000, // 1 hour — how often GC runs
      "dead_letter_retention_days": 7, // dead-letter files kept this long
    },

    // Watchdog (heartbeat monitoring)
    "watchdog": {
      "heartbeat_interval_ms": 30000, // how often watchdog checks
      "heartbeat_warning_ms": 60000, // warn after 60s silence
      "zombie_timeout_ms": 120000, // mark dead after 2min silence
      "reconnect_timeout_ms": 10000, // wait 10s for re-register after restart
    },

    // Paths agents cannot access (in addition to automatic protections)
    "protected_paths": [],

    // Git safety
    "git": {
      "protected_branches": ["main", "dev"],
      "denied_commands": ["push --force", "reset --hard"],
      "pre_merge_validation": "bun test", // optional: command to run before merging
    },
  },
]
```

### Config Validation

The plugin uses Zod v4 to validate all config. Invalid values throw at startup:

| Rule                                 | Behavior                                      |
| ------------------------------------ | --------------------------------------------- |
| Negative budget values               | Rejected                                      |
| Zero or negative `max_agents`        | Rejected                                      |
| Negative `max_concurrent_tasks`      | Rejected                                      |
| Invalid `human_authority`            | Must be `"always"`, `"advisory"`, or `"none"` |
| Non-positive `gc.cleanup_timeout_ms` | Rejected                                      |
| Non-positive `watchdog.*` values     | Rejected                                      |

### Default Values

Every config section has sensible defaults. Omit any section and you get:

| Section                          | Defaults                           |
| -------------------------------- | ---------------------------------- |
| `enabled`                        | `false`                            |
| `agents`                         | `{}` (no pre-defined agents)       |
| `human_authority`                | `"always"`                         |
| `limits.max_agents`              | `10`                               |
| `limits.max_concurrent_tasks`    | `5`                                |
| `limits.max_delegation_depth`    | `3`                                |
| `budget.daily_limit_usd`         | `50`                               |
| `budget.per_agent_daily_usd`     | `15`                               |
| `budget.per_task_max_usd`        | `5`                                |
| `budget.per_task_max_tokens`     | `200000`                           |
| `gc.cleanup_timeout_ms`          | `259200000` (3 days)               |
| `gc.gc_interval_ms`              | `3600000` (1 hour)                 |
| `gc.dead_letter_retention_days`  | `7`                                |
| `watchdog.heartbeat_interval_ms` | `30000`                            |
| `watchdog.zombie_timeout_ms`     | `120000`                           |
| `git.protected_branches`         | `["main", "dev"]`                  |
| `git.denied_commands`            | `["push --force", "reset --hard"]` |

---

## Available Tools

The plugin registers 8 tools that agents can invoke via function calling:

### `agent_list`

List all agents with their current status, role, and capabilities.

```
agent_list(include_details?: boolean)
```

- `include_details` — include capabilities and workspace info (default: false)
- Returns: array of `{ id, role, status, current_task_id, ... }`

**Example use case:** An architect agent checks which agents are available before delegating.

### `agent_send`

Send a message to a specific agent.

```
agent_send(target: string, content: string, type: "message"|"question"|"notification",
           priority?: "critical"|"high"|"normal"|"low", correlation_id?: string)
```

- `target` — agent ID to send to
- `content` — message body
- `type` — message type discriminator
- `priority` — defaults to `"normal"`
- `correlation_id` — for reply chains

**Example use case:** A coder sends a question to the reviewer about ambiguous requirements.

### `agent_broadcast`

Broadcast a message to all agents (except sender).

```
agent_broadcast(content: string, priority?: "critical"|"high"|"normal"|"low")
```

**Example use case:** Announce a breaking API change that all agents should know about.

### `agent_delegate`

Delegate a task to another agent and wait for the result.

```
agent_delegate(target: string, title: string, description: string,
               priority?: "critical"|"high"|"normal"|"low",
               required_capabilities?: string[],
               deadline_seconds?: number,
               files?: string[],
               context?: string)
```

- Respects `max_delegation_depth` — rejects if chain is too deep
- Checks target agent has required capabilities
- Blocks until result or timeout

**Example use case:** Architect delegates implementation to coder, coder delegates tests to tester.

### `agent_share`

Share changes from an agent's worktree to the team workspace.

```
agent_share(branch: string, description: string, auto_merge?: boolean,
            validation_command?: string)
```

- `auto_merge` — if true and no conflicts, merge automatically
- `validation_command` — e.g. `"bun test"` to run before merge
- Returns: `{ status: "merged"|"conflict"|"validation_failed"|"rejected", ... }`

**Example use case:** Coder finishes feature work and shares it back to the team workspace.

### `agent_handoff`

Hand off a task to another agent with progress information.

```
agent_handoff(target: string, reason: string, next_steps: string[],
              transfer_worktree?: boolean)
```

- Includes current progress: files modified/created, git status, blockers
- Optionally transfers worktree ownership to receiving agent

**Example use case:** Coder going off-shift hands off incomplete work to another coder.

### `agent_query`

Query shared team memory or a specific agent's context.

```
agent_query(query: string, scope: "team"|"agent", target_agent?: string)
```

**Example use case:** New agent joining asks "what decisions have been made about the auth module?"

### `agent_revert`

Revert a previously merged share.

```
agent_revert(merge_commit: string, reason: string)
```

**Example use case:** A merge introduced a regression — revert it immediately.

---

## Agent Lifecycle

Agents follow a strict state machine:

```
                 spawn()
                   │
                   ▼
             ┌──────────┐
             │ spawning │
             └────┬─────┘
                  │  (register, init workspace)
                  ▼
             ┌──────────┐
       ┌─────│   idle   │◄──────────────┐
       │     └────┬─────┘               │
       │          │ receive task         │
       │          ▼                     │
       │     ┌──────────┐  complete     │
       │     │   busy   │───────────────┘
       │     └────┬─────┘
       │          │ waiting for response
       │          ▼
       │     ┌──────────┐  response
       │     │ waiting  │───────────────┘
       │     └────┬─────┘
       │          │
       │          │ terminate / crash
       │          ▼
       │     ┌────────────┐
       │     │terminating │──── stash + cleanup
       │     └────┬───────┘
       │          ▼
       │     ┌──────────┐
       └────►│   dead   │  (removed from active count)
             └──────────┘
```

### Spawning

```ts
const id = await orchestrator.spawn({
  agent_id: "my-coder", // optional, auto-generated if omitted
  role: "coder",
  capabilities: {
    tools: ["read", "edit", "bash"],
    share_to_team: true,
    delegate: true,
  },
})
```

This creates the agent in the registry, allocates a workspace at `.opencode/workspaces/workspace-{id}/`, and logs an audit event.

### Terminating

```ts
await orchestrator.terminate("my-coder", "work complete")
```

Transitions through `terminating` → `dead`. Logs audit event. Dead agents don't count toward `max_agents`.

### Heartbeat

Agents report their status periodically:

```ts
orchestrator.registry.recordHeartbeat("coder", {
  status: "busy",
  current_task_id: "task-1",
  tokens_used_session: { input: 1000, output: 500 },
})
```

If no heartbeat within `zombie_timeout_ms`, the watchdog marks the agent as dead, cancels its current task, and moves undelivered messages to dead-letter.

---

## Message Routing

### Direct Message

```
alice ──route()──► bob inbox [FIFO queue]
```

- Validates schema, checks idempotency (dedup), rate limits, hop count
- Unknown/dead target → dead-letter + notify sender

### Broadcast

```
alice ──broadcast()──► [bob, carol] inboxes (not alice)
```

### Dead Letters

When a message can't be delivered (target dead/unknown, TTL expired):

1. Message moves to `.opencode/team/dead-letter/{target}.jsonl`
2. Sender gets a `dead_letter` notification in their inbox
3. Dead-letter files are cleaned after `dead_letter_retention_days`

### Rate Limiting

Per sender→receiver pair: max `max_messages_per_minute` (default 30) per 60-second window. Excess messages are rejected with an error.

### Hop Count

Every delegation increments `hop_count`. When `hop_count > max_hop` (default 10), the message is rejected. This prevents infinite delegation chains.

---

## Task Queue

### Enqueue

```ts
const result = orchestrator.taskQueue.enqueue({
  task_id: "task-1",
  title: "Implement auth module",
  description: "Create JWT auth middleware",
  priority: "high",
  required_capabilities: ["edit", "bash"],
  budget: { max_cost: 2 },
})
```

Validation at enqueue time:

1. **Concurrent cap** — rejects if active tasks >= `max_concurrent_tasks`
2. **Team budget** — rejects if `max_cost` would exceed team daily limit
3. **Agent budget** — rejects if all idle agents would exceed per-agent daily limit
4. **Delegation depth** — rejects if chain exceeds `max_delegation_depth`

### Assignment

Tasks are sorted by priority (`critical` > `high` > `normal` > `low`) and assigned to the first idle agent whose capabilities match `required_capabilities`.

### Completion

```ts
orchestrator.taskQueue.complete("task-1", {
  task_id: "task-1",
  status: "completed",
  summary: "Auth module implemented",
  files_modified: ["src/auth.ts"],
  files_created: ["src/middleware/jwt.ts"],
  branch: "team/coder/auth",
  tokens_used: { input: 2000, output: 800 },
  cost: 0.15,
})
```

On completion:

1. Task status → `"completed"`
2. Agent status → `"idle"`
3. Budget usage recorded
4. Next pending task auto-assigned (by priority)

### Cancellation

```ts
orchestrator.taskQueue.cancel("task-1")
```

Cancels the task and frees the assigned agent.

---

## Budget Management

Three levels of budget enforcement:

| Level           | Config Key            | Default | What it limits                |
| --------------- | --------------------- | ------- | ----------------------------- |
| Per-task        | `per_task_max_usd`    | $5      | Individual task cost cap      |
| Per-agent daily | `per_agent_daily_usd` | $15     | Total spend per agent per day |
| Team daily      | `daily_limit_usd`     | $50     | Total team spend per day      |

### Tracking

```ts
// Budget is tracked automatically on task completion
orchestrator.budget.trackUsage("coder", 2800, 0.15)

// Query current usage
const usage = orchestrator.budget.getUsage("coder")
// { input: 2800, output: 0, total: 2800, cost: 0.15 }

// Query team total
const team = orchestrator.budget.getTeamUsage()
// { input: 2800, output: 0, total: 2800, cost: 0.15 }
```

### Daily Reset

Call `orchestrator.budget.resetDaily()` to clear all usage counters. This happens automatically at midnight if you set up a scheduled task.

---

## Permission System

The plugin enforces workspace isolation through the `permission.ask` hook:

| Operation | Own Workspace | Own Worktree |    Team Workspace     | Other Agent Workspace |
| --------- | :-----------: | :----------: | :-------------------: | :-------------------: |
| Read      |      YES      |     YES      |          YES          |          NO           |
| Write     |      YES      |     YES      |    NO (use share)     |          NO           |
| Bash      |      YES      |     YES      | Check denied commands |          NO           |

### Protected Paths

These paths are always denied for agents:

- `.opencode/team/` — orchestrator state
- `.opencode/workspaces/*/manifest.json` — agent manifests
- Any path listed in `protected_paths` config

### Dangerous Git Commands

Commands matching `git.denied_commands` are blocked:

- `git push --force`
- `git reset --hard`

### Shell Environment

The `shell.env` hook injects agent-specific environment variables:

```ts
{
  AGENT_ID: "coder",
  AGENT_ROLE: "coder",
  AGENT_WORKSPACE: "/project/.opencode/workspaces/workspace-coder",
}
```

---

## State Persistence & Recovery

### Snapshot

State is saved to `.opencode/team/state.json`:

```ts
await orchestrator.state.saveSnapshot({ agents: orchestrator.registry.toSnapshot() })
```

### Write-Ahead Log (WAL)

Every state change is logged to `.opencode/team/wal.jsonl`:

```jsonl
{"seq":1,"op":"agents","data":{...},"ts":1713123456789}
{"seq":2,"op":"budget","data":{...},"ts":1713123457000}
```

### Crash Recovery

When opencode restarts:

1. Load `state.json` (last snapshot)
2. Replay WAL entries newer than `snapshot_time`
3. Compact WAL (rewrite `state.json`, truncate WAL)
4. Wait `reconnect_timeout_ms` for agents to re-register
5. Mark unregistered agents as `"dead"`

This ensures sub-second recovery from crashes.

---

## Garbage Collection

### Worktree Cleanup

The GC scheduler runs every `gc_interval_ms`. For each agent's worktrees:

1. Check last modification time
2. If older than `cleanup_timeout_ms` (default: 3 days):
   - `git stash` changes
   - Tag branch: `crash-recovery/{agent_id}/{timestamp}`
   - Remove worktree
   - Log audit event

### Dead Letter Cleanup

Dead-letter files older than `dead_letter_retention_days` are deleted during GC tick.

### Disk Quota

```ts
const withinQuota = await orchestrator.gc.checkDiskQuota("coder", workspacePath, 500)
```

Checks if an agent's workspace is within its `disk_quota_mb` limit.

---

## Audit & Telemetry

### Audit Log

Every significant action is logged to `.opencode/team/audit.jsonl`:

```jsonl
{"ts":1713123456789,"agent":"coder","action":"agent.spawn","target":"/project/.opencode/workspaces/workspace-coder"}
{"ts":1713123457000,"agent":"coder","action":"task.assigned","target":"task-1"}
{"ts":1713123458000,"agent":"coder","action":"task.completed","target":"task-1"}
{"ts":1713123460000,"agent":"coder","action":"agent.crash","details":{"reason":"zombie detected"}}
```

Query audit events:

```ts
// All events for an agent
const events = await orchestrator.audit.read({ agent: "coder" })

// Filter by action
const crashes = await orchestrator.audit.read({ action: "agent.crash" })
```

Audit events persist across restarts.

### Telemetry

Record task and message events:

```ts
await orchestrator.telemetry.record({
  agent: "coder",
  event_type: "task.complete",
  duration_ms: 5000,
  success: true,
})
```

Get per-agent stats:

```ts
const stats = await orchestrator.telemetry.getStats("coder")
// {
//   total_tasks: 10,
//   completed_tasks: 8,
//   failed_tasks: 2,
//   total_messages: 45,
//   avg_task_duration_ms: 3200,
//   cost_total: 0,
//   tokens_total: 0
// }
```

Get dashboard for all agents:

```ts
const dashboard = await orchestrator.telemetry.getDashboard()
// { coder: { ... }, reviewer: { ... } }
```

Time-range filtering:

```ts
const recent = await orchestrator.telemetry.getStats("coder", {
  since: Date.now() - 3600000, // last hour
})
```

---

## TUI Integration

The plugin registers TUI components (stub implementations):

### Routes

| Route          | Description                                            |
| -------------- | ------------------------------------------------------ |
| `team`         | Team dashboard — grid of all agents with status        |
| `inbox`        | Human inbox — messages from agents                     |
| `agent-detail` | Agent detail view — status, task, worktrees, decisions |

### Commands

| Command             | Keybind  | Action                    |
| ------------------- | -------- | ------------------------- |
| Open Team Dashboard | `Ctrl+T` | Navigate to `team` route  |
| Open Inbox          | —        | Navigate to `inbox` route |
| Spawn Agent         | —        | Open spawn dialog         |
| Team Cost Report    | —        | Show budget usage         |
| View Agent Detail   | —        | Show agent selector       |

### Sidebar

A sidebar slot shows mini agent status indicators and unread inbox count.

---

## Configuration Reference

### Full Schema (Zod v4)

```ts
TeamConfig = {
  enabled: boolean                     // default: false
  agents: Record<string, {
    role: string
    role_priority: number              // default: 10
    model?: string
    capabilities: {
      tools: string[]                  // default: ["read","glob","grep","list"]
      share_to_team: boolean           // default: false
      delegate: boolean                // default: true
      max_delegation_depth: number     // default: 2
      disk_quota_mb: number            // default: 500
    }
    max_tasks_per_day: number          // default: 50
    disk_quota_mb: number              // default: 500
  }>
  humans: {
    hierarchy: string[]                // default: ["admin","developer"]
  }
  human_authority: "always"|"advisory"|"none"  // default: "always"
  limits: {
    max_agents: number                 // default: 10, must be > 0
    max_concurrent_tasks: number       // default: 5, must be >= 0
    max_delegation_depth: number       // default: 3, must be >= 0
    max_messages_per_minute: number    // default: 30, must be > 0
    message_ttl_seconds: number        // default: 86400, must be > 0
    task_timeout_seconds: number       // default: 1800, must be > 0
    tool_execution_timeout_seconds: number  // default: 60, must be > 0
  }
  budget: {
    daily_limit_usd: number            // default: 50, must be >= 0
    per_agent_daily_usd: number        // default: 15, must be >= 0
    per_task_max_usd: number           // default: 5, must be >= 0
    per_task_max_tokens: number        // default: 200000, must be >= 0
  }
  gc: {
    cleanup_timeout_ms: number         // default: 259200000, must be > 0
    gc_interval_ms: number             // default: 3600000, must be > 0
    dead_letter_retention_days: number // default: 7, must be > 0
  }
  watchdog: {
    heartbeat_interval_ms: number      // default: 30000, must be > 0
    heartbeat_warning_ms: number       // default: 60000, must be > 0
    zombie_timeout_ms: number          // default: 120000, must be > 0
    reconnect_timeout_ms: number       // default: 10000, must be > 0
  }
  protected_paths: string[]            // default: []
  git: {
    protected_branches: string[]       // default: ["main","dev"]
    denied_commands: string[]          // default: ["push --force","reset --hard"]
    pre_merge_validation?: string
  }
}
```

---

## Development

### Prerequisites

- [Bun](https://bun.sh) runtime
- This repo cloned with workspace dependencies installed

### Running Tests

```bash
cd packages/agent-team
bun test                    # all 262 tests
bun test test/e2e/          # E2E tests only
bun test test/unit/         # unit tests only (if separated)
```

### Type Checking

```bash
cd packages/agent-team
bun typecheck               # tsc --noEmit
```

### Test Coverage

The test suite includes:

| Category     | Files | Tests | What's covered                                                              |
| ------------ | ----- | ----- | --------------------------------------------------------------------------- |
| Protocol     | 2     | ~20   | Message types, Zod schemas, validation                                      |
| Orchestrator | 9     | ~70   | Registry, router, task-queue, watchdog, state, budget, GC, audit, telemetry |
| Tools        | 4     | ~25   | All 8 A2A tools                                                             |
| Hooks        | 6     | ~25   | Permission, tool-guard, system-prompt, event-handler, compaction, shell-env |
| E2E          | 10    | ~86   | Full lifecycle flows: spawn/delegate, crash recovery, budget, routing, etc. |
| Config       | 1     | 14    | TeamConfig validation, defaults                                             |
| Exports      | 1     | 5     | Package entry points                                                        |

### Adding a New Tool

1. Create `src/tools/agent-foo.ts` using `@opencode-ai/plugin/tool`
2. Import and register in `src/server.ts` under `tool: { agent_foo: ... }`
3. Write tests in `test/tools/agent-foo.test.ts`
4. Run `bun test` to verify

### Package Exports

```jsonc
{
  "exports": {
    ".": "./src/index.ts", // public API (Orchestrator, types, schemas)
    "./server": "./src/server.ts", // server plugin entry (loaded by opencode)
    "./tui": "./src/tui.ts", // TUI plugin entry (loaded by opencode)
  },
}
```
