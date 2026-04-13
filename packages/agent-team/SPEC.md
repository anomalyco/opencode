# Agent Team Plugin — Technical Specification

> OpenCode plugin cho phép multiple AI agents giao tiếp, phối hợp, và làm việc chung
> trên một project. Mỗi agent là một process riêng với workspace riêng, giao tiếp qua
> central orchestrator.

---

## Mục lục

- [1. Architecture Overview](#1-architecture-overview)
- [2. File Structure](#2-file-structure)
- [3. Message Protocol](#3-message-protocol)
- [4. Orchestrator Process](#4-orchestrator-process)
- [5. Agent Lifecycle](#5-agent-lifecycle)
- [6. Workspace Management](#6-workspace-management)
- [7. A2A Custom Tools](#7-a2a-custom-tools)
- [8. Server Plugin Hooks](#8-server-plugin-hooks)
- [9. TUI Plugin](#9-tui-plugin)
- [10. Configuration](#10-configuration)
- [11. Edge Cases Reference](#11-edge-cases-reference)

---

## 1. Architecture Overview

### 1.1 High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     Orchestrator Process                         │
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
│  │  (cap, depth,│  │  (heartbeat, │  │  (worktree cleanup,    │ │
│  │   priority)  │  │   zombie     │  │   disk quota,          │ │
│  │              │  │   detection) │  │   retention policy)    │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Budget Mgr  │  │  Audit Logger│  │    Telemetry           │ │
│  │  (tokens,    │  │  (.jsonl)    │  │  (events, stats,       │ │
│  │   cost cap)  │  │              │  │   dashboard data)      │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
│  State: .opencode/team/ (JSON files on disk)                     │
│  IPC: Unix domain socket                                         │
└──────┬──────────────┬──────────────┬─────────────────────────────┘
       │              │              │
  ┌────▼────┐   ┌─────▼────┐  ┌─────▼────┐
  │ Agent A │   │ Agent B  │  │  Human   │
  │(process)│   │(process) │  │  (TUI)   │
  │         │   │          │  │          │
  │ session │   │ session  │  │ session  │
  │ agent   │   │ agent    │  │ agent    │
  │ tools   │   │ tools    │  │ tools    │
  └─────────┘   └──────────┘  └──────────┘
```

### 1.2 Design Principles

- **Orchestrator là trust boundary**: Mọi identity, routing, permission enforcement
  đều qua orchestrator. Agents không giao tiếp trực tiếp.
- **State on disk**: Orchestrator state persist dưới dạng JSON files. Restart recovery
  < 1 giây.
- **One task per agent**: Mỗi agent chỉ handle 1 task tại 1 thời điểm. Đơn giản,
  tránh context switching complexity.
- **Backward-compatible protocol**: Message schema chỉ thêm fields, không bao giờ
  xóa/break. Receiver ignore unknown fields.
- **Plugin-based**: Toàn bộ system triển khai qua OpenCode server plugin + TUI plugin,
  không cần modify OpenCode core.

### 1.3 Process Model

```
orchestrator (main opencode process)
  ├── agent process: workspace-{id}/bin/agent.ts
  │     ├── connects to orchestrator via IPC
  │     ├── owns workspace at .opencode/workspaces/workspace-{id}/
  │     └── runs opencode session with custom agent config
  ├── agent process: workspace-{id}/bin/agent.ts
  │     └── ...
  └── TUI (existing, connects as human entity)
```

Mỗi agent process là một `opencode` instance chạy với:

- `--directory` pointing to agent workspace
- Custom agent config injected qua plugin hooks
- IPC connection đến orchestrator

---

## 2. File Structure

### 2.1 Project-Level Structure

```
project/
├── .opencode/
│   ├── config.json                  # existing opencode config
│   ├── agents/                      # agent definitions (markdown)
│   │   ├── coder.md
│   │   ├── reviewer.md
│   │   └── architect.md
│   ├── commands/                    # existing commands
│   ├── plugins/                     # existing plugins
│   │   └── agent-team/              # THIS PLUGIN
│   │       ├── server.ts            # server plugin entry
│   │       ├── tui.ts               # TUI plugin entry
│   │       ├── orchestrator/
│   │       │   ├── index.ts         # orchestrator main
│   │       │   ├── registry.ts      # agent registry
│   │       │   ├── router.ts        # message router
│   │       │   ├── task-queue.ts    # task queue + priority
│   │       │   ├── watchdog.ts      # heartbeat + zombie detection
│   │       │   ├── state.ts         # snapshot + WAL + recovery
│   │       │   ├── budget.ts        # cost tracking
│   │       │   ├── gc.ts            # worktree cleanup
│   │       │   └── audit.ts         # audit logger
│   │       ├── protocol/
│   │       │   ├── messages.ts      # message type definitions
│   │       │   └── schema.ts        # zod schemas
│   │       ├── tools/
│   │       │   ├── agent-send.ts
│   │       │   ├── agent-broadcast.ts
│   │       │   ├── agent-list.ts
│   │       │   ├── agent-delegate.ts
│   │       │   ├── agent-share.ts
│   │       │   ├── agent-handoff.ts
│   │       │   └── agent-query.ts
│   │       ├── hooks/
│   │       │   ├── system-prompt.ts
│   │       │   ├── permission.ts
│   │       │   ├── tool-guard.ts
│   │       │   └── event-handler.ts
│   │       ├── tui/
│   │       │   ├── team-route.tsx
│   │       │   ├── inbox-route.tsx
│   │       │   ├── agent-detail-route.tsx
│   │       │   └── sidebar-slot.tsx
│   │       └── util/
│   │           ├── ipc.ts           # IPC client/server
│   │           └── workspace.ts     # workspace helpers
│   └── team/                        # orchestrator runtime state
│       ├── registry.json            # agent registry snapshot
│       ├── state.json               # orchestrator state snapshot
│       ├── wal.jsonl                # write-ahead log
│       ├── inbox/                   # per-agent message queues
│       │   ├── agent-coder.jsonl
│       │   ├── agent-reviewer.jsonl
│       │   └── human.jsonl
│       ├── shared/                  # shared temp files
│       ├── memory.jsonl             # shared team memory/decision log
│       ├── audit.jsonl              # audit trail
│       ├── telemetry.jsonl          # telemetry events
│       └── dead-letter/             # undeliverable messages
│           └── *.jsonl
└── (project root = team workspace)
```

### 2.2 Agent Workspace Structure

```
.opencode/workspaces/
├── workspace-agent-coder/
│   ├── opencode.json                # per-agent config (model, permissions, tools, provider)
│   ├── manifest.json                # agent manifest (capabilities, role)
│   ├── decisions.jsonl              # agent decision log
│   ├── scratch/                     # private working files
│   │   ├── notes.md
│   │   └── drafts/
│   └── .worktrees/                  # git worktrees for project tasks
│       ├── feature-auth/            # worktree for a feature
│       │   └── (git worktree content)
│       └── fix-login/               # worktree for a bugfix
│           └── (git worktree content)
├── workspace-agent-reviewer/
│   ├── opencode.json                # per-agent config (read-only, no bash)
│   ├── manifest.json
│   ├── decisions.jsonl
│   ├── scratch/
│   └── .worktrees/
└── workspace-human/
    └── (human works on project root directly)
```

> **Per-agent config:** Vì mỗi agent chạy `opencode --directory .opencode/workspaces/workspace-{id}/`,
> OpenCode tự động load `opencode.json` trong workspace đó (merge lên trên global config).
> Mỗi agent workspace chỉ cần đặt `opencode.json` riêng là được config riêng (model, permissions,
> tools, provider, agent definition...). Orchestrator có thể generate file này khi spawn hoặc dùng
> env var `OPENCODE_CONFIG_CONTENT` để inject config động.

---

## 3. Message Protocol

### 3.1 Envelope

Mọi message được wrap trong envelope. Orchestrator inject `from` và `timestamp`
dựa trên IPC connection identity — agent không thể spoof.

```ts
type MessageEnvelope<T = unknown> = {
  id: string // UUID, dùng cho dedup (E20)
  type: MessageType // message type discriminator
  from: AgentID // inject bởi orchestrator
  to: AgentID | "broadcast" // target
  timestamp: number // unix ms, inject bởi orchestrator
  ttl?: number // seconds, default: 86400 (24h)
  hop_count: number // incremented per delegation (E2)
  idempotency_key: string // hash(content + from + type) (E20)
  priority: "critical" | "high" | "normal" | "low"
  protocol_version: number // backward-compatible (E28)
  correlation_id?: string // for request-response pairing
  payload: T // type-specific payload
}
```

### 3.2 MessageType enum

```ts
type MessageType =
  // --- Core messaging ---
  | "message" // simple text message
  | "task" // task assignment
  | "task.result" // task completion result
  | "task.progress" // progress update (also heartbeat E30)
  | "task.cancel" // cancel a task
  // --- Delegation ---
  | "delegate" // delegate task to another agent
  | "delegate.result" // delegation result returned
  // --- Handoff ---
  | "handoff" // structured task handoff (E39)
  | "handoff.accepted" // receiver accepted handoff
  // --- Sharing ---
  | "share.request" // request to share to team workspace
  | "share.result" // share result (success/conflict)
  // --- Context ---
  | "context.request" // request context from agent (E4)
  | "context.response" // context response
  // --- Coordination ---
  | "disagreement" // flag disagreement (E31)
  // --- System ---
  | "agent.spawn" // orchestrator → spawn agent
  | "agent.terminate" // orchestrator → terminate agent
  | "agent.heartbeat" // agent → alive signal
  | "agent.register" // agent → register with orchestrator
  | "agent.deregister" // agent → graceful shutdown
  | "agent.capability.query" // query agent capabilities (E16)
  | "agent.list" // list all agents + status
  // --- Error ---
  | "error" // generic error
  | "dead_letter" // undeliverable message notification
```

### 3.3 Payload Schemas

#### `message`

```ts
type MessagePayload = {
  content: string
  metadata?: Record<string, unknown> // extensibility, ignored if unknown
}
```

#### `task`

```ts
type TaskPayload = {
  task_id: string // unique task identifier
  title: string
  description: string
  priority: "critical" | "high" | "normal" | "low"
  deadline?: number // unix ms
  parent_task_id?: string // for sub-tasks
  required_capabilities?: string[] // capability requirements (E16)
  files?: string[] // relevant file paths
  context?: string // additional context
  budget?: {
    // token/cost budget
    max_tokens?: number
    max_cost?: number
  }
}
```

#### `task.result`

```ts
type TaskResultPayload = {
  task_id: string
  status: "completed" | "failed" | "cancelled" | "partial"
  summary: string
  files_modified?: string[]
  files_created?: string[]
  branch?: string // branch name if changes pushed
  error?: string
  tokens_used?: {
    input: number
    output: number
  }
  cost?: number
  decisions?: Decision[] // decisions made during task
}
```

#### `task.progress`

```ts
type TaskProgressPayload = {
  task_id: string
  status: "working" | "waiting" | "blocked"
  message: string
  progress_pct?: number // 0-100 estimated
  files_modified_so_far?: string[]
  tokens_used?: { input: number; output: number }
}
```

#### `delegate`

```ts
type DelegatePayload = {
  task: TaskPayload // embedded task
  max_depth: number // remaining delegation depth (E48)
  return_to: AgentID // who to send result back to
}
```

#### `handoff`

```ts
type HandoffPayload = {
  task_id: string
  reason: string // why handoff
  progress: {
    description: string
    files_modified: string[]
    files_created: string[]
    next_steps: string[]
    blockers: string[]
    git_branch?: string
    git_status?: string
  }
  transfer_worktree: boolean // transfer worktree ownership (E39)
  worktree_path?: string // if transfer_worktree
}
```

#### `share.request`

```ts
type ShareRequestPayload = {
  branch: string // source branch in agent worktree
  target_branch?: string // target branch in team workspace
  description: string
  auto_merge: boolean // auto-merge if no conflict
  files: string[] // files to share
  validation_command?: string // command to run before merge (E27)
}
```

#### `share.result`

```ts
type ShareResultPayload = {
  request_id: string
  status: "merged" | "conflict" | "validation_failed" | "rejected"
  merge_commit?: string
  conflict_files?: string[]
  validation_output?: string
}
```

#### `context.request` / `context.response`

```ts
type ContextRequestPayload = {
  query: string // what context is needed
  scope: "team" | "agent" | "conversation"
  target_agent_id?: AgentID // if scope is "agent"
}
type ContextResponsePayload = {
  query: string
  result: string
  source: {
    agent: AgentID
    files?: string[]
    decisions?: Decision[]
  }
}
```

#### `agent.register`

```ts
type AgentRegisterPayload = {
  agent_id: AgentID
  role: string // "coder" | "reviewer" | "architect" | "human" | ...
  role_priority: number // higher = wins disagreements (E31)
  capabilities: AgentCapabilities
  model?: { provider_id: string; model_id: string }
  max_concurrent_tasks: number // always 1 in MVP (E26)
  workspace_path: string
}
```

#### `agent.heartbeat`

```ts
type AgentHeartbeatPayload = {
  agent_id: AgentID
  status: "idle" | "busy" | "waiting"
  current_task_id?: string
  memory_usage_mb?: number
  tokens_used_session?: { input: number; output: number }
}
```

### 3.4 Shared Types

```ts
type AgentID = string // unique agent identifier
type AgentCapabilities = {
  tools: string[] // allowed tool names
  read: boolean
  write_own_workspace: boolean
  share_to_team: boolean
  delegate: boolean
  spawn_subagents: boolean
  max_delegation_depth: number
  disk_quota_mb: number
  protected_paths: string[] // paths agent cannot access
}
type Decision = {
  id: string
  timestamp: number
  summary: string
  rationale: string
  files_affected?: string[]
  task_id?: string
}
type AgentStatus = "spawning" | "idle" | "busy" | "waiting" | "terminating" | "dead"
```

### 3.5 Protocol Versioning Rules

- `protocol_version` bắt đầu tại `1`
- Thêm fields mới: bump minor, backward-compatible
- Thay đổi semantics của existing field: bump major, old version reject
- Unknown fields: receiver ignore
- Agent register kèm `supported_versions: [1]`. Orchestrator negotiate.

---

## 4. Orchestrator Process

### 4.1 Overview

Orchestrator là process trung tâm, chạy trong cùng opencode server process
(như một plugin-managed background service). Nó quản lý:

1. Agent registry (spawn, register, deregister, health)
2. Message routing (FIFO per sender-receiver pair)
3. Task queue (priority, capacity, depth limits)
4. State persistence (snapshot + WAL)
5. Workspace management (GC, quota)
6. Budget tracking (tokens, cost)
7. Audit logging

### 4.2 IPC Protocol

Orchestrator listen trên Unix domain socket tại:

```
.opencode/team/orchestrator.sock
```

Agent processes connect và giao tiếp qua JSON frames (newline-delimited):

```
<4-byte length><JSON envelope>\n
```

Handshake:

```
Agent connects
  → sends: { type: "agent.register", ... }
  ← receives: { type: "agent.registered", assigned_id, config }
  → ready: agent starts opencode session
```

### 4.3 Orchestrator API

```ts
namespace Orchestrator {
  // --- Agent Management ---
  spawn(input: {
    agent_id?: string               // optional, auto-generate if omitted
    role: string
    capabilities: Partial<AgentCapabilities>
    model?: { provider_id: string; model_id: string }
  }): Promise<AgentID>
  terminate(input: {
    agent_id: AgentID
    reason: string
    grace_period_ms?: number       // default: 5000
  }): Promise<void>
  list(): AgentInfo[]
  getInfo(agent_id: AgentID): AgentInfo | undefined
  // --- Message Routing ---
  send(message: Omit<MessageEnvelope, "from" | "timestamp" | "id">): Promise<MessageEnvelope>
  // --- Task Management ---
  enqueueTask(task: TaskPayload): Promise<string>     // returns task_id
  cancelTask(task_id: string): Promise<void>
  getTaskStatus(task_id: string): TaskStatus | undefined
  // --- Workspace ---
  createWorktree(agent_id: AgentID, name?: string): Promise<WorktreeInfo>
  removeWorktree(agent_id: AgentID, path: string): Promise<void>
  // --- Budget ---
  getUsage(agent_id: AgentID): TokenUsage
  getTeamUsage(): TokenUsage
  getBudget(): BudgetInfo
  // --- Query ---
  queryTeamMemory(query: string): Promise<string>
  queryAgentDecisions(agent_id: AgentID, query?: string): Promise<Decision[]>
}
```

### 4.4 AgentInfo

```ts
type AgentInfo = {
  id: AgentID
  role: string
  role_priority: number
  status: AgentStatus
  capabilities: AgentCapabilities
  model?: { provider_id: string; model_id: string }
  workspace_path: string
  current_task_id?: string
  pid?: number
  connected_at: number
  last_activity: number
  tokens_used: { input: number; output: number; total: number }
  cost_used: number
  disk_used_mb: number
  active_worktrees: string[]
  message_queue_size: number
}
```

### 4.5 Message Router Logic

```
receive(message):
  1. Validate schema
  2. Dedup check (idempotency_key)
  3. Inject from, timestamp, id
  4. Check self-delegation (from === to → reject)
  5. Check hop_count > max_hop → reject with error
  6. Check rate limit (per sender-receiver pair)
  7. Route:
     - to === "broadcast" → enqueue in all agent inboxes (except sender)
     - to === specific agent → enqueue in target inbox
     - to === unknown agent → return-to-sender or dead-letter
  8. Persist to WAL
  9. Return envelope to sender
agent inbox drain:
  - FIFO order guaranteed per sender-receiver pair
  - Agent idle → immediately deliver next message
  - Agent busy → queue, deliver when agent sends "task.progress" or goes idle
  - TTL expired → move to dead-letter, notify sender
```

### 4.6 Task Queue Logic

```
enqueueTask(task):
  1. Check global task cap (config.max_concurrent_tasks)
  2. Check team budget (config.budget.daily_limit)
  3. Find capable agent (capability match, not busy)
  4. If no agent available → queue by priority
  5. Assign to agent → send task message
  6. Track in state
task completion:
  - Agent sends task.result
  - Update usage stats
  - Check pending tasks → assign next from queue
  - If delegation chain → propagate result back to original delegator
```

### 4.7 Watchdog Logic

```
every config.heartbeat_interval_ms (default: 30000):
  for each connected agent:
    if agent.last_activity > config.zombie_timeout_ms (default: 120000):
      // No output-based liveness (E34)
      mark agent as "zombie"
      send termination signal
      cleanup:
        - stash all worktree changes
        - tag crash-recovery branches
        - release all agent resources
        - move undelivered messages to dead-letter
        - update registry: status = "dead"
    if agent.last_activity > config.heartbeat_warning_ms (default: 60000):
      // Warning phase
      notify agent (ping message)
      log warning
```

### 4.8 State Persistence

```
State structure (.opencode/team/state.json):
{
  version: number
  snapshot_time: number
  agents: Record<AgentID, AgentInfo>
  tasks: {
    active: Record<task_id, TaskState>
    completed: Array<{ task_id: string; completed_at: number }>  // last 100
  }
  budget: {
    daily: { date: string; tokens: number; cost: number }
  }
  config: TeamConfig
}
WAL (.opencode/team/wal.jsonl):
  mỗi state change = 1 line JSON
  format: { seq: number, op: string, data: any, ts: number }
Recovery on restart:
  1. Load state.json
  2. Replay WAL entries with seq > state.snapshot_time
  3. Compact WAL (rewrite state.json, truncate WAL)
  4. Wait for agents to re-register (config.reconnect_timeout_ms)
  5. Mark agents that didn't re-register as "dead"
  6. Resume normal operation
```

### 4.9 Audit Logger

```ts
// Append-only, one event per line
// .opencode/team/audit.jsonl
type AuditEvent = {
  ts: number
  agent: AgentID
  action: string
  target?: string
  details?: Record<string, unknown>
}
// Actions logged:
// - agent.spawn, agent.terminate, agent.crash
// - message.sent, message.delivered, message.dead_letter
// - task.assigned, task.completed, task.failed, task.cancelled
// - worktree.create, worktree.remove, worktree.cleanup
// - share.request, share.merged, share.conflict
// - budget.warning, budget.exceeded
// - permission.deny (tool access blocked)
```

---

## 5. Agent Lifecycle

### 5.1 State Machine

```
                        spawn()
                          │
                          ▼
                    ┌──────────┐
                    │ spawning │
                    └────┬─────┘
                         │  (connect IPC, register, init workspace)
                         ▼
                    ┌──────────┐
              ┌─────│   idle   │◄──────────────────┐
              │     └────┬─────┘                    │
              │          │ receive task              │
              │          ▼                          │
              │     ┌──────────┐   task complete    │
              │     │   busy   │────────────────────┘
              │     └────┬─────┘
              │          │ waiting for response from
              │          │ another agent or human
              │          ▼
              │     ┌──────────┐   response received │
              │     │ waiting  │────────────────────┘
              │     └────┬─────┘
              │          │
              │          │ terminate / crash
              │          ▼
              │     ┌────────────┐
              │     │terminating │──── stash + cleanup
              │     └────┬───────┘
              │          ▼
              │     ┌──────────┐
              └────►│   dead   │
                    └──────────┘
```

### 5.2 Spawn Sequence

```
1. Orchestrator.validate spawn request (check budget, caps)
2. Orchestrator.assigns AgentID
3. Orchestrator.create workspace dir:
     .opencode/workspaces/workspace-{agent_id}/
     .opencode/workspaces/workspace-{agent_id}/scratch/
4. Orchestrator.writes manifest.json:
     {
       agent_id, role, capabilities,
       created_at, parent_project, model
     }
5. Orchestrator.spawns child process:
     opencode --directory .opencode/workspaces/workspace-{agent_id}/
       --with-plugin agent-team/server.ts
       --agent-config <json>
6. Agent process boots → connects IPC → sends agent.register
7. Orchestrator.register → add to registry → send agent.registered
8. Agent process starts opencode session
9. Agent idle → check inbox → if messages → transition to busy
```

### 5.3 Graceful Shutdown Sequence

```
1. Orchestrator.sends agent.terminate (with grace_period)
2. Agent receives terminate:
   a. Complete current tool execution (don't interrupt mid-tool)
   b. Stash current progress (write to decisions.jsonl)
   c. Release any held resources
   d. Send agent.deregister
3. Orchestrator.receive deregister:
   a. Move undelivered inbox messages to dead-letter
   b. Update registry: status = "dead"
   c. Log audit event
4. After grace_period: force kill if still running
5. GC scheduler: cleanup worktrees after retention policy
```

### 5.4 Crash Recovery

```
1. Orchestrator.detects process death (exit event or heartbeat timeout)
2. Mark agent as "dead" in registry
3. For each active worktree of agent:
   a. git stash all changes
   b. Tag branch: crash-recovery/{agent_id}/{timestamp}
   c. Log stash ref + branch to audit
4. Move inbox messages to dead-letter
5. If agent had active task:
   a. Mark task as "failed" with error "agent_crashed"
   b. Notify task requester (delegation chain)
6. Do NOT cleanup worktree immediately — wait retention policy (3 days)
```

---

## 6. Workspace Management

### 6.1 Workspace Layout

```
Agent workspace = .opencode/workspaces/workspace-{agent_id}/
  ├── manifest.json              # agent identity + capabilities
  ├── decisions.jsonl            # append-only decision log
  ├── scratch/                   # private, agent-only read/write
  └── .worktrees/                # project-related git worktrees
Team workspace = project root (where .git/ lives)
```

### 6.2 Workspace Rules

| Operation       | Agent Own Workspace | Agent Own Worktree | Team Workspace | Other Agent Workspace |
| --------------- | :-----------------: | :----------------: | :------------: | :-------------------: |
| Read            |         YES         |        YES         |      YES       |       NO (E23)        |
| Write           |         YES         |        YES         | NO (use share) |          NO           |
| Create Worktree |         N/A         |        YES         |      N/A       |          NO           |
| Remove Worktree |         YES         |        YES         |      N/A       |          NO           |

Enforcement: `permission.ask` hook check path against agent manifest.

### 6.3 Worktree Lifecycle

```
Agent receives task that involves project files:
1. Agent calls agent_share (internally triggers):
   a. Orchestrator calls Worktree.create()
   b. Worktree created at workspace-{agent_id}/.worktrees/{task-slug}/
   c. Git branch: team/{agent_id}/{task-slug}
   d. Orchestrator records worktree in agent state
2. Agent works in worktree:
   a. All file edits happen within worktree
   b. Progress events sent to orchestrator
   c. Changes committed to branch
3. Task complete — share to team:
   a. Agent calls agent_share tool
   b. Validates: run validation_command if specified
   c. If no conflicts: merge branch to team workspace
   d. If conflicts: return conflict info to agent
   e. On success:
      - Remove worktree (Worktree.remove())
      - Delete branch
      - Update agent state: remove from active_worktrees
4. Task incomplete — agent crashes:
   a. GC scheduler detects inactive worktree
   b. After cleanup_timeout (default: 3 days) of no activity:
      - git stash changes
      - Tag: crash-recovery/{agent_id}/{timestamp}
      - Remove worktree
      - Keep tagged branch for manual recovery
```

### 6.4 GC Scheduler

```ts
// Runs every config.gc_interval_ms (default: 3600000 = 1 hour)
for each agent workspace:
  for each worktree in workspace/.worktrees/:
    last_modified = getFileModTime(worktree)
    if (Date.now() - last_modified > config.cleanup_timeout_ms):  // default: 259200000 (3 days)
      stashChanges(worktree)
      tagBranch(agent_id, branch, `crash-recovery/${agent_id}/${Date.now()}`)
      removeWorktree(worktree)
      logAudit("gc.worktree.cleanup", { agent_id, worktree, branch })
  // Disk quota check
  disk_used = calculateDiskUsage(workspace)
  if (disk_used > agent.capabilities.disk_quota_mb * 1024 * 1024):
    notify(agent_id, { type: "error", message: "disk quota exceeded" })
    // Block new write operations
```

### 6.5 URI Scheme for Cross-Workspace References

```
workspace://agent-coder/scratch/analysis.md
  → resolves to: .opencode/workspaces/workspace-agent-coder/scratch/analysis.md
team://src/index.ts
  → resolves to: {project_root}/src/index.ts
shared://temp/review-notes.md
  → resolves to: .opencode/team/shared/temp/review-notes.md
worktree://agent-coder/feature-auth/src/app.ts
  → resolves to: .opencode/workspaces/workspace-agent-coder/.worktrees/feature-auth/src/app.ts
```

## Enforcement: `tool.execute.before` hook resolves URIs, then checks permissions.

## 7. A2A Custom Tools

### 7.1 Overview

Các tools sau được đăng ký qua server plugin `tool` hook. LLM agent gọi
như bình thường (function calling).

### 7.2 `agent_send`

Gửi message đến một agent cụ thể.

```ts
agent_send: tool({
  description: `Send a message to another agent in the team.
Use this to communicate findings, ask questions, or share information.
The target agent will receive the message in their inbox.`,
  args: {
    target: tool.schema.string().describe("Agent ID to send to"),
    content: tool.schema.string().describe("Message content"),
    type: tool.schema.enum(["message", "question", "notification"]).describe("Message type"),
    priority: tool.schema.enum(["critical", "high", "normal", "low"]).optional().describe("Priority level"),
    correlation_id: tool.schema.string().optional().describe("For reply chains"),
  },
  async execute(args, ctx) {
    // 1. Resolve target agent ID
    // 2. Send via IPC to orchestrator
    // 3. Orchestrator routes: inject from, timestamp, id
    // 4. Return confirmation
  },
})
```

### 7.3 `agent_broadcast`

Broadcast message đến tất cả agents trong team.

```ts
agent_broadcast: tool({
  description: `Broadcast a message to all agents in the team.
Use for announcements, status updates, or general information.`,
  args: {
    content: tool.schema.string().describe("Message content"),
    priority: tool.schema.enum(["critical", "high", "normal", "low"]).optional(),
  },
  async execute(args, ctx) {
    // Orchestrator enqueues in all agent inboxes except sender
  },
})
```

### 7.4 `agent_list`

Liệt kê tất cả agents trong team cùng status.

```ts
agent_list: tool({
  description: `List all agents in the team with their current status, role, and capabilities.
Use this to discover available agents for delegation or communication.`,
  args: {
    include_details: tool.schema.boolean().optional().describe("Include capabilities and workspace info"),
  },
  async execute(args, ctx) {
    // Query orchestrator for agent list
    // Return formatted table of agents
  },
})
```

### 7.5 `agent_delegate`

Giao task cho agent khác, đợi kết quả.

```ts
agent_delegate: tool({
  description: `Delegate a task to another agent and wait for the result.
The target agent will work on the task in their own workspace.
Choose an agent whose capabilities match the task requirements.`,
  args: {
    target: tool.schema.string().describe("Agent ID to delegate to"),
    title: tool.schema.string().describe("Short task title"),
    description: tool.schema.string().describe("Detailed task description"),
    priority: tool.schema.enum(["critical", "high", "normal", "low"]).optional(),
    required_capabilities: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Capabilities required for this task"),
    deadline_seconds: tool.schema.number().optional().describe("Task deadline in seconds"),
    files: tool.schema.array(tool.schema.string()).optional().describe("Relevant file paths for context"),
    context: tool.schema.string().optional().describe("Additional context for the task"),
  },
  async execute(args, ctx) {
    // 1. Check delegation depth (max_hop from config)
    // 2. Check target agent capabilities
    // 3. Send delegate message via orchestrator
    // 4. Block until result received (or timeout)
    // 5. Return result
  },
})
```

### 7.6 `agent_share`

Share changes từ agent worktree về team workspace.

```ts
agent_share: tool({
  description: `Share your changes from your worktree to the team workspace.
This creates a branch and attempts to merge into the team workspace.
If there are conflicts, you will be notified to resolve them.`,
  args: {
    branch: tool.schema.string().describe("Your worktree branch name to share"),
    description: tool.schema.string().describe("Description of changes being shared"),
    auto_merge: tool.schema.boolean().optional().describe("Auto-merge if no conflicts"),
    validation_command: tool.schema.string().optional().describe("Command to validate before merge (e.g., 'npm test')"),
  },
  async execute(args, ctx) {
    // 1. Validate branch exists in agent worktree
    // 2. Run validation_command if specified
    // 3. Attempt merge into team workspace
    // 4. If conflict: return conflict details
    // 5. If success: cleanup worktree, return merge info
    // 6. Pre-merge validation (E27): must pass before merge
  },
})
```

### 7.7 `agent_handoff`

Handoff task hiện tại cho agent khác.

```ts
agent_handoff: tool({
  description: `Hand off your current task to another agent.
Provide detailed progress information so the receiving agent can continue.
Optionally transfer your worktree to the receiving agent.`,
  args: {
    target: tool.schema.string().describe("Agent ID to hand off to"),
    reason: tool.schema.string().describe("Why you are handing off"),
    next_steps: tool.schema.array(tool.schema.string()).describe("Next steps for the receiver"),
    transfer_worktree: tool.schema.boolean().optional().describe("Transfer your current worktree to the receiver"),
  },
  async execute(args, ctx) {
    // 1. Gather current progress (files modified, git status, etc.)
    // 2. Send handoff message
    // 3. If transfer_worktree: reassign worktree ownership
    // 4. Mark own task as "handed_off"
  },
})
```

### 7.8 `agent_query`

Query shared team memory hoặc context của team.

```ts
agent_query: tool({
  description: `Query shared team memory for decisions, context, or information.
Use this to understand what other agents have decided or discovered.`,
  args: {
    query: tool.schema.string().describe("What you want to know"),
    scope: tool.schema.enum(["team", "agent"]).describe("Search scope"),
    target_agent: tool.schema.string().optional().describe("Specific agent to query (if scope is 'agent')"),
  },
  async execute(args, ctx) {
    // On-demand context pull (E4)
    // Query team memory JSONL
    // Or request context from specific agent via message
  },
})
```

### 7.9 `agent_revert`

Revert một share/merge trước đó.

```ts
agent_revert: tool({
  description: `Revert a previously merged share to the team workspace.
Use with caution — this affects the team workspace.`,
  args: {
    merge_commit: tool.schema.string().describe("The merge commit hash to revert"),
    reason: tool.schema.string().describe("Why you are reverting"),
  },
  async execute(args, ctx) {
    // 1. Verify merge_commit exists
    // 2. git revert merge_commit
    // 3. Log to audit trail
  },
})
```

---

## 8. Server Plugin Hooks

### 8.1 System Prompt Injection

Sử dụng `experimental.chat.system.transform` để inject team context
vào mỗi agent session.

```ts
"experimental.chat.system.transform": async (input, output) => {
  const registry = await orchestrator.list()
  const me = registry.find(a => a.id === currentAgentId)
  const others = registry.filter(a => a.id !== currentAgentId)
  output.system.push(`
## Team Context
You are agent "${me?.id}" with role "${me?.role}" (priority: ${me?.role_priority}).
Status: ${me?.status}
### Team Members
${others.map(a => `- ${a.id} (${a.role}, status: ${a.status}, task: ${a.current_task_id ?? "none"})`).join("\n")}
### Your Workspace
- Private: ${me?.workspace_path}/scratch/
- Worktrees: ${me?.workspace_path}/.worktrees/
- Team workspace: ${projectRoot}
### Available Tools
- agent_send(target, content) — send message to agent
- agent_broadcast(content) — announce to all
- agent_list() — see all agents
- agent_delegate(target, task) — delegate task
- agent_share(branch, desc) — share changes to team
- agent_handoff(target, reason) — hand off task
- agent_query(query) — search team memory
- agent_revert(merge_commit) — undo a merge
### Rules
- You can only write to your own workspace and worktrees
- Use agent_share to push changes to team workspace
- Respect role priority in disagreements
- Log important decisions (they are auto-captured)
- Always send task.progress updates during long tasks
  `)
}
```

### 8.2 Permission Enforcement

```ts
"permission.ask": async (input, output) => {
  const agent = await getAgentForSession(input.sessionID)
  if (!agent) return
  // Check write access
  if (input.permission === "edit" || input.permission === "write") {
    const target = input.patterns?.[0]
    if (!target) return
    // Allow: own workspace, own worktrees
    // Deny: other agents' workspaces, team workspace (must use agent_share)
    // Deny: protected paths (.opencode/team/, config, plugin code)
    if (isTeamWorkspace(target) && !isOwnWorktree(target, agent)) {
      output.status = "deny"
      return
    }
    if (isOtherAgentWorkspace(target, agent)) {
      output.status = "deny"
      return
    }
    if (isProtectedPath(target)) {
      output.status = "deny"
      return
    }
  }
  // Check read access — deny other agents' private workspace
  if (input.permission === "read") {
    const target = input.patterns?.[0]
    if (target && isOtherAgentWorkspace(target, agent)) {
      output.status = "deny"
      return
    }
  }
  // Check bash — deny dangerous git commands (E44)
  if (input.permission === "bash") {
    const cmd = input.metadata?.command as string
    if (cmd && isDangerousGitCommand(cmd)) {
      output.status = "deny"
      return
    }
  }
}
```

### 8.3 Tool Execution Guards

```ts
"tool.execute.before": async (input, output) => {
  // URI resolution (E25)
  if (output.args?.filePath) {
    output.args.filePath = resolveWorkspaceURI(output.args.filePath, currentAgentId)
  }
  if (output.args?.path) {
    output.args.path = resolveWorkspaceURI(output.args.path, currentAgentId)
  }
}
"tool.execute.after": async (input, output) => {
  // Secret redaction (E43)
  if (output.output) {
    output.output = redactSecrets(output.output)
  }
  // File change notification (E9) — invalidate cached contexts
  if (input.tool === "edit" || input.tool === "write") {
    await orchestrator.broadcastFileChange(currentAgentId, output.metadata?.filePath)
  }
}
```

### 8.4 Event Handler

```ts
event: async ({ event }) => {
  if (event.type === "session.idle") {
    // Agent finished task → check inbox
    const agentId = getAgentForSession(event.sessionID)
    if (agentId) {
      await orchestrator.notifyAgentIdle(agentId)
    }
  }
  if (event.type === "file.watcher.updated") {
    // Broadcast file change to invalidate stale contexts (E9)
    await orchestrator.broadcastFileChange(currentAgentId, event.file)
  }
  if (event.type === "session.error") {
    // Report error to orchestrator
    const agentId = getAgentForSession(event.sessionID)
    if (agentId) {
      await orchestrator.reportAgentError(agentId, event.error)
    }
  }
}
```

### 8.5 Compaction Hook

```ts
"experimental.session.compacting": async (input, output) => {
  // Inject team memory + recent decisions (E32)
  const teamMemory = await orchestrator.queryTeamMemory("recent decisions")
  const agentDecisions = await orchestrator.queryAgentDecisions(currentAgentId)
  output.context.push(`
## Team Memory (shared)
${teamMemory}
## Your Recent Decisions
${agentDecisions.map(d => `- ${d.summary}: ${d.rationale}`).join("\n")}
## Current Task
${currentTask ? `Task: ${currentTask.title}\nStatus: ${currentTask.status}` : "No active task"}
  `)
}
```

### 8.6 Shell Environment

```ts
"shell.env": async (input, output) => {
  // Inject agent-specific environment (E6)
  const agent = getAgentForSession(input.sessionID)
  if (agent) {
    output.env.AGENT_ID = agent.id
    output.env.AGENT_ROLE = agent.role
    output.env.AGENT_WORKSPACE = agent.workspace_path
    output.env.TEAM_WORKSPACE = projectRoot
  }
}
```

---

## 9. TUI Plugin

### 9.1 Routes

#### `team` — Team Dashboard

Hiển thị grid tất cả agents, real-time status.

```tsx
api.route.register([
  {
    name: "team",
    render: () => (
      <box>
        <text bold>Team Dashboard</text>
        {/* Agent grid: name, role, status, current task, cost */}
        {/* Refreshes via event subscription */}
      </box>
    ),
  },
])
```

#### `inbox` — Human Inbox

Human agent's message inbox. Khi agents gửi message cho human,
nó xuất hiện ở đây.

```tsx
api.route.register([
  {
    name: "inbox",
    render: () => (
      <box>
        <text bold>Inbox</text>
        {/* List of messages from agents */}
        {/* Can reply, delegate, acknowledge */}
      </box>
    ),
  },
])
```

#### `agent-detail` — Chi tiết Agent

Click vào agent từ dashboard → xem detail.

```tsx
api.route.register([
  {
    name: "agent-detail",
    render: ({ params }) => (
      <box>
        <text bold>Agent: {params.agentId}</text>
        {/* Status, current task, workspace info, worktrees */}
        {/* Decision log, cost breakdown */}
        {/* Actions: send message, delegate task, terminate */}
      </box>
    ),
  },
])
```

### 9.2 Commands

```ts
api.command.register(() => [
  { title: "Open Team Dashboard", value: "team.open", keybind: "ctrl+t", onSelect: () => api.route.navigate("team") },
  { title: "Open Inbox", value: "team.inbox", onSelect: () => api.route.navigate("inbox") },
  { title: "Spawn Agent", value: "team.spawn", onSelect: () => showSpawnDialog() },
  { title: "Team Cost Report", value: "team.cost", onSelect: () => showCostReport() },
  { title: "View Agent Detail", value: "team.agent.detail", onSelect: () => showAgentSelect() },
])
```

### 9.3 Sidebar Slot

```tsx
api.slots.register({
  slot: "sidebar_content",
  render: ({ session_id }) => (
    <box>
      {/* Mini agent status indicators */}
      {/* Unread inbox count badge */}
    </box>
  ),
})
```

### 9.4 Event Subscriptions

```ts
api.event.on("session.idle", (event) => {
  // Refresh team dashboard
})
api.event.on("message.updated", (event) => {
  // Check if message is from agent → update inbox
})
```

---

## 10. Configuration

### 10.1 Team Config Schema

Thêm vào `opencode.json`:

```jsonc
{
  "team": {
    "enabled": true,
    "agents": {
      "coder": {
        "role": "coder",
        "role_priority": 10,
        "model": "anthropic/claude-sonnet-4",
        "capabilities": {
          "tools": ["read", "edit", "write", "bash", "glob", "grep", "list"],
          "share_to_team": true,
          "delegate": true,
          "max_delegation_depth": 2,
        },
        "permission": {
          "bash": "allow",
          "edit": "allow",
        },
        "max_tasks_per_day": 50,
        "disk_quota_mb": 500,
      },
      "reviewer": {
        "role": "reviewer",
        "role_priority": 20,
        "model": "anthropic/claude-sonnet-4",
        "capabilities": {
          "tools": ["read", "glob", "grep", "list"],
          "share_to_team": false,
          "delegate": false,
          "max_delegation_depth": 0,
        },
        "permission": {
          "bash": { "*": "deny" },
          "edit": { "*": "deny" },
          "read": "allow",
        },
        "max_tasks_per_day": 30,
        "disk_quota_mb": 200,
      },
      "architect": {
        "role": "architect",
        "role_priority": 30,
        "model": "anthropic/claude-opus-4",
        "capabilities": {
          "tools": ["read", "glob", "grep", "list", "webfetch"],
          "share_to_team": false,
          "delegate": true,
          "max_delegation_depth": 3,
        },
        "permission": {
          "bash": "allow",
          "edit": { "*": "deny" },
        },
        "max_tasks_per_day": 20,
        "disk_quota_mb": 200,
      },
    },
    "humans": {
      "hierarchy": ["admin", "developer"], // E41: priority order
    },
    "human_authority": "always", // E42: "always" | "advisory" | "none"
    "limits": {
      "max_agents": 10,
      "max_concurrent_tasks": 5,
      "max_delegation_depth": 3,
      "max_messages_per_minute": 30, // E38: rate limit
      "message_ttl_seconds": 86400,
      "task_timeout_seconds": 1800,
      "tool_execution_timeout_seconds": 60, // E45
    },
    "budget": {
      "daily_limit_usd": 50, // E8, E36
      "per_agent_daily_usd": 15,
      "per_task_max_usd": 5,
      "per_task_max_tokens": 200000,
    },
    "gc": {
      "cleanup_timeout_ms": 259200000, // 3 days
      "gc_interval_ms": 3600000, // 1 hour
      "dead_letter_retention_days": 7,
    },
    "watchdog": {
      "heartbeat_interval_ms": 30000,
      "heartbeat_warning_ms": 60000,
      "zombie_timeout_ms": 120000,
      "reconnect_timeout_ms": 10000,
    },
    "protected_paths": [".opencode/team/", ".opencode/workspaces/*/manifest.json", ".opencode/plugins/agent-team/"],
    "git": {
      "protected_branches": ["main", "dev"],
      "denied_commands": ["push --force", "reset --hard", "push -f"],
      "pre_merge_validation": "npm test",
    },
  },
}
```

### 10.2 Team Config Zod Schema

```ts
const TeamConfig = z.object({
  enabled: z.boolean().default(false),
  agents: z
    .record(
      z.string(),
      z.object({
        role: z.string(),
        role_priority: z.number().default(10),
        model: z.string().optional(),
        capabilities: z
          .object({
            tools: z.array(z.string()).default(["read", "glob", "grep", "list"]),
            share_to_team: z.boolean().default(false),
            delegate: z.boolean().default(true),
            max_delegation_depth: z.number().default(2),
            disk_quota_mb: z.number().default(500),
          })
          .default({}),
        permission: Config.Permission.optional(),
        max_tasks_per_day: z.number().default(50),
        disk_quota_mb: z.number().default(500),
      }),
    )
    .default({}),
  humans: z
    .object({
      hierarchy: z.array(z.string()).default(["admin", "developer"]),
    })
    .default({}),
  human_authority: z.enum(["always", "advisory", "none"]).default("always"),
  limits: z
    .object({
      max_agents: z.number().default(10),
      max_concurrent_tasks: z.number().default(5),
      max_delegation_depth: z.number().default(3),
      max_messages_per_minute: z.number().default(30),
      message_ttl_seconds: z.number().default(86400),
      task_timeout_seconds: z.number().default(1800),
      tool_execution_timeout_seconds: z.number().default(60),
    })
    .default({}),
  budget: z
    .object({
      daily_limit_usd: z.number().default(50),
      per_agent_daily_usd: z.number().default(15),
      per_task_max_usd: z.number().default(5),
      per_task_max_tokens: z.number().default(200000),
    })
    .default({}),
  gc: z
    .object({
      cleanup_timeout_ms: z.number().default(259200000),
      gc_interval_ms: z.number().default(3600000),
      dead_letter_retention_days: z.number().default(7),
    })
    .default({}),
  watchdog: z
    .object({
      heartbeat_interval_ms: z.number().default(30000),
      heartbeat_warning_ms: z.number().default(60000),
      zombie_timeout_ms: z.number().default(120000),
      reconnect_timeout_ms: z.number().default(10000),
    })
    .default({}),
  protected_paths: z.array(z.string()).default([]),
  git: z
    .object({
      protected_branches: z.array(z.string()).default(["main", "dev"]),
      denied_commands: z.array(z.string()).default(["push --force", "reset --hard"]),
      pre_merge_validation: z.string().optional(),
    })
    .default({}),
})
```

---

## 11. Edge Cases Reference

Quick reference cho 50 edge cases đã approve.
| # | Scenario | Mechanism | Spec Section |
|---|----------|-----------|--------------|
| E1 | Agent crash, lock stuck | Process watchdog + manual override | §4.7, §5.4 |
| E2 | Circular delegation | hop_count + TTL | §3.1, §4.6 |
| E3 | Merge conflict | Branch-per-change | §6.3, §7.6 |
| E4 | Context overflow | On-demand pull | §7.8 |
| E5 | Agent discovery | Central orchestrator registry | §4.3 |
| E6 | Concurrent tool access | Sandboxed env (shell.env) | §8.6 |
| E7 | Agent leaves mid-conv | Graceful shutdown + reroute | §5.3 |
| E8 | Infinite task spawn | Global cap + budget | §4.6, §10.1 |
| E9 | Stale context | File watcher invalidate | §8.3, §8.4 |
| E10 | Orchestrator SPOF | Lightweight + disk state | §4.8 |
| E11 | Context poisoning | Verify critical data + source tracing | §3.3 |
| E12 | Partial failure | Orchestrator-managed transaction (saga) | §4.6 |
| E13 | Message ordering | Orchestrator FIFO per pair | §4.5 |
| E14 | Agent overcommitment | Queue + capacity + priority | §4.6 |
| E15 | Workspace GC | Lifecycle cleanup + retention | §6.4 |
| E16 | Capability mismatch | Registry + graceful rejection | §4.6 |
| E17 | Permission escalation | RBAC + audit + self-delegation block | §8.2 |
| E18 | Dead letter | Persistent inbox + TTL + return-to-sender | §4.5 |
| E19 | Hot file contention | Dependency isolation + JSON patch | §6.3 |
| E20 | Replay/idempotency | Dedup by idempotency_key | §3.1, §4.5 |
| E21 | Resource exhaustion | Concurrency throttle + adaptive scaling | §4.6, §4.7 |
| E22 | Crash worktree cleanup | Auto-stash + retention timeout | §5.4, §6.4 |
| E23 | Private workspace access | Deny default + explicit share | §6.2, §8.2 |
| E24 | Disk quota | Per-agent quota + auto-prune | §6.4 |
| E25 | Cross-workspace ref | URI scheme + shared temp | §6.5 |
| E26 | Multi-task agent | One task per agent | §1.2 |
| E27 | Git state protection | Pre-merge validation + revert | §7.6, §7.9 |
| E28 | Version mismatch | Backward-compatible schema | §3.1, §3.5 |
| E29 | Identity spoofing | Orchestrator-authenticated | §3.1, §4.5 |
| E30 | Long-running task | Progress events + heartbeat | §3.3, §4.7 |
| E31 | Agent disagreement | Role priority resolution | §3.3, §8.1 |
| E32 | Memory persistence | Decision log + shared memory + compaction | §5.2, §8.5 |
| E33 | Spawn config | Manifest + sandboxed tools | §5.2 |
| E34 | Zombie detection | Output-based liveness | §4.7 |
| E35 | Inter-project | Out of scope MVP | N/A |
| E36 | Cost tracking | Per-agent + budget cap + attribution | §4.3, §10.1 |
| E37 | Self-improvement | Immutable system + protected paths | §8.2, §10.1 |
| E38 | Notification fatigue | Rate limit + priority filter | §4.5, §10.1 |
| E39 | Task handoff | Structured handoff + worktree transfer | §7.7 |
| E40 | Backpressure | Bounded queue + disk overflow | §4.5 |
| E41 | Multiple humans | Human hierarchy | §10.1 |
| E42 | Agent vs human conflict | Negotiation (human final) | §8.1, §10.1 |
| E43 | External secrets | Env isolation + output redaction | §8.3, §8.6 |
| E44 | Git history rewrite | Protected branches + command block | §8.2, §10.1 |
| E45 | Infinite loop code | Timeout + retry budget + pattern detect | §8.3, §10.1 |
| E46 | Shared infra conflict | Separate DB per worktree | §6.3 |
| E47 | Quality degradation | Session rotation + adaptive model | §5.1 |
| E48 | Spawn blow-up | Depth limit + global cap | §4.6, §10.1 |
| E49 | State recovery | Snapshot + WAL + re-registration | §4.8 |
| E50 | Observability | Telemetry + TUI dashboard + query API | §4.9, §9 |

---

_Spec version: 1.0 — Draft for review_
_Last updated: 2026-04-13_
