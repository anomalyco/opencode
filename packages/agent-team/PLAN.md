# Agent Team Plugin — Implementation Plan (TDD)

> Chiến lược: Bottom-up, mỗi phase build trên foundation phase trước.
> Mọi task theo RED-GREEN-REFACTOR: viết test trước → implement cho pass → refactor.

---

## Project Setup

### Task 0: Package scaffold

**Setup `package.json`, `tsconfig.json`, test runner, file structure.**

```
packages/agent-team/
├── package.json
├── tsconfig.json
├── AGENTS.md
├── SPEC.md
├── PLAN.md
├── src/
│   ├── index.ts                  # package entry
│   ├── server.ts                 # server plugin entry
│   ├── tui.ts                    # TUI plugin entry
│   ├── protocol/
│   │   ├── messages.ts           # message type definitions
│   │   └── schema.ts             # zod schemas + validation
│   ├── orchestrator/
│   │   ├── index.ts              # orchestrator main
│   │   ├── registry.ts           # agent registry
│   │   ├── router.ts             # message router
│   │   ├── task-queue.ts         # task queue + priority
│   │   ├── watchdog.ts           # heartbeat + zombie detection
│   │   ├── state.ts              # snapshot + WAL + recovery
│   │   ├── budget.ts             # cost tracking
│   │   ├── gc.ts                 # worktree cleanup
│   │   ├── audit.ts              # audit logger
│   │   └── telemetry.ts          # telemetry events + dashboard stats
│   ├── tools/
│   │   ├── agent-send.ts
│   │   ├── agent-broadcast.ts
│   │   ├── agent-list.ts
│   │   ├── agent-delegate.ts
│   │   ├── agent-share.ts
│   │   ├── agent-handoff.ts
│   │   ├── agent-query.ts
│   │   └── agent-revert.ts
│   ├── hooks/
│   │   ├── system-prompt.ts
│   │   ├── permission.ts
│   │   ├── tool-guard.ts
│   │   ├── event-handler.ts
│   │   ├── compaction.ts           # session compaction hook
│   │   └── shell-env.ts           # shell environment injection
│   ├── tui/
│   │   ├── team-route.tsx
│   │   ├── inbox-route.tsx
│   │   ├── agent-detail-route.tsx
│   │   └── sidebar-slot.tsx
│   └── util/
│       ├── ipc.ts                # IPC client/server
│       └── workspace.ts          # workspace helpers
├── test/
│   ├── fixture/
│   │   ├── orchestrator.ts       # test orchestrator helper
│   │   ├── agent.ts              # test agent process helper
│   │   └── workspace.ts          # temp workspace fixture
│   ├── protocol/
│   │   ├── messages.test.ts
│   │   └── schema.test.ts
│   ├── orchestrator/
│   │   ├── registry.test.ts
│   │   ├── router.test.ts
│   │   ├── task-queue.test.ts
│   │   ├── watchdog.test.ts
│   │   ├── state.test.ts
│   │   ├── budget.test.ts
│   │   ├── gc.test.ts
│   │   ├── audit.test.ts
│   │   └── telemetry.test.ts
│   ├── tools/
│   │   ├── agent-send.test.ts
│   │   ├── agent-broadcast.test.ts
│   │   ├── agent-list.test.ts
│   │   ├── agent-delegate.test.ts
│   │   ├── agent-share.test.ts
│   │   ├── agent-handoff.test.ts
│   │   ├── agent-query.test.ts
│   │   └── agent-revert.test.ts
│   ├── hooks/
│   │   ├── permission.test.ts
│   │   ├── tool-guard.test.ts
│   │   ├── system-prompt.test.ts
│   │   ├── event-handler.test.ts
│   │   ├── compaction.test.ts
│   │   └── shell-env.test.ts
│   ├── tui/
│   │   ├── team-route.test.ts
│   │   ├── inbox-route.test.ts
│   │   ├── agent-detail-route.test.ts
│   │   └── sidebar-slot.test.ts
│   └── util/
│       ├── ipc.test.ts
│       └── workspace.test.ts
└── OPENCODE_PLUGIN_REFERENCE.md
```

**package.json** cần:

```json
{
  "name": "@opencode-ai/plugin-agent-team",
  "type": "module",
  "scripts": {
    "test": "bun test --timeout 30000",
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    "./server": "./src/server.ts",
    "./tui": "./src/tui.ts"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "workspace:*"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "workspace:*",
    "@opentui/core": ">=0.1.97",
    "@opentui/solid": ">=0.1.97",
    "bun-types": "latest"
  }
}
```

> **Lưu ý quan trọng về plugin architecture:**
>
> - Server plugin: default export `{ id: "agent-team", server: async (input) => Hooks }` (`PluginModule`)
> - TUI plugin: default export `{ id: "agent-team", tui: async (api, options, meta) => void }` (`TuiPluginModule`)
> - Plugin system KHÔNG cho phép export cả `server` và `tui` trong cùng 1 module — phải tách file
> - Config `plugin_origins` sẽ list cả hai: `["@opencode-ai/plugin-agent-team/server", "@opencode-ai/plugin-agent-team/tui"]`
> - `PluginInput` có các field: `client`, `project`, `directory`, `worktree`, `serverUrl` (URL), `$` (BunShell)

---

## Phase 1: Protocol Layer (foundation)

> Mọi thứ khác phụ thuộc message types + validation. Phase này không có side effects,
> pure data + parsing. Dễ test nhất, tốt nhất để bắt đầu.

### Task 1.1: Message type definitions

**RED** — `test/protocol/messages.test.ts`:

```
Test cases:
- MessageEnvelope có đầy đủ required fields sau khi orchestrator inject
- MessageType enum chứa tất cả 24 types (message, task, task.result, task.progress,
  task.cancel, delegate, delegate.result, handoff, handoff.accepted, share.request,
  share.result, context.request, context.response, disagreement, agent.spawn,
  agent.terminate, agent.heartbeat, agent.register, agent.deregister,
  agent.capability.query, agent.list, error, dead_letter)
- Mỗi payload type có đúng shape (MessagePayload, TaskPayload, TaskResultPayload,
  TaskProgressPayload, DelegatePayload, HandoffPayload, ShareRequestPayload,
  ShareResultPayload, ContextRequestPayload, ContextResponsePayload,
  AgentRegisterPayload, AgentHeartbeatPayload)
- AgentCapabilities có defaults đúng
- AgentStatus union type đúng 6 states
- Decision type có đầy đủ fields
```

**GREEN** — `src/protocol/messages.ts`:

- Export tất cả types: MessageEnvelope, MessageType, payload types, AgentID,
  AgentCapabilities, Decision, AgentStatus, AgentInfo

### Task 1.2: Zod schemas + validation

**RED** — `test/protocol/schema.test.ts`:

```
Test cases:
- MessageEnvelopeSchema parse thành công với valid envelope
- MessageEnvelopeSchema reject khi thiếu required fields (id, type, from, to, timestamp)
- MessageEnvelopeSchema cho phép optional fields (ttl, correlation_id)
- Mỗi payload schema parse đúng shape:
  - MessagePayloadSchema accept content string
  - TaskPayloadSchema reject khi thiếu title/description
  - TaskPayloadSchema accept optional deadline, parent_task_id, budget
  - TaskResultPayloadSchema accept "completed" | "failed" | "cancelled" | "partial"
  - TaskResultPayloadSchema reject invalid status
  - TaskProgressPayloadSchema validate status enum ("working" | "waiting" | "blocked")
  - DelegatePayloadSchema validate max_depth > 0
  - DelegatePayloadSchema require return_to field
  - HandoffPayloadSchema validate progress có next_steps
  - HandoffPayloadSchema validate transfer_worktree boolean
  - ShareRequestPayloadSchema validate files array không rỗng
  - ShareRequestPayloadSchema validate auto_merge boolean
  - ShareResultPayloadSchema accept "merged" | "conflict" | "validation_failed" | "rejected"
  - ContextRequestPayloadSchema validate scope enum ("team" | "agent" | "conversation")
  - ContextResponsePayloadSchema require result string
  - AgentRegisterPayloadSchema validate role không rỗng
  - AgentRegisterPayloadSchema validate capabilities shape
  - AgentHeartbeatPayloadSchema validate status enum
  - ErrorPayloadSchema require message string
  - DeadLetterPayloadSchema include original envelope
- AgentCapabilitiesSchema có defaults:
  - tools defaults ["read", "glob", "grep", "list"]
  - max_delegation_depth defaults 2
  - disk_quota_mb defaults 500
- Protocol version validation: chỉ accept version 1
- Idempotency key generation: hash(content + from + type) deterministic
- Unknown fields trong payload ignored, không throw
```

**GREEN** — `src/protocol/schema.ts`:

- Zod schemas cho tất cả message types
- `validateMessage(raw: unknown) => MessageEnvelope`
- `generateIdempotencyKey(content, from, type) => string`
- `validateProtocolVersion(version: number) => boolean`

---

## Phase 2: Utilities (IPC + Workspace)

> **Lưu ý IPC usage:** IPC chỉ dùng cho child agent processes giao tiếp với orchestrator.
> Server-side tools và hooks gọi orchestrator trực tiếp in-process (không qua IPC).

### Task 2.1: IPC client/server

**RED** — `test/util/ipc.test.ts`:

```
Setup: tạo Unix domain socket trong temp dir

Test cases:
- IPCServer listen trên socket path
- IPCClient connect đến server
- Client gửi JSON message → server nhận đúng message
- Server gửi JSON message → client nhận đúng message
- Multiple clients connect đồng thời, mỗi client nhận messages riêng
- Frame format: <4-byte length><JSON>\n parsed đúng
- Client disconnect → server nhận disconnect event
- Server shutdown → client nhận error/connect loss
- Large message (>64KB) gửi nhận đúng
- Concurrent send/receive không corrupt data
- Server send to specific client by ID
- Cleanup: socket file removed sau server close
```

**GREEN** — `src/util/ipc.ts`:

- `IPCServer` class: listen, accept, send(clientId, message), broadcast(message), close()
- `IPCClient` class: connect, send(message), onMessage(handler), close()
- Frame encoder/decoder: length-prefixed JSON

### Task 2.2: Workspace helpers

**RED** — `test/util/workspace.test.ts`:

```
Setup: tmpdir với git repo

Test cases:
- createWorkspace(root, agentId) tạo dir structure đúng:
  .opencode/workspaces/workspace-{id}/
  .opencode/workspaces/workspace-{id}/scratch/
  .opencode/workspaces/workspace-{id}/manifest.json
- createWorkspace ghi manifest.json đúng format
- createWorktree(workspace, name) tạo git worktree tại
  workspace/.worktrees/{name}/ với branch team/{agentId}/{name}
- removeWorktree gỡ worktree + xóa branch
- URI resolution:
  - workspace://agent-coder/scratch/notes.md → absolute path
  - team://src/index.ts → project_root/src/index.ts
  - shared://temp/file.md → .opencode/team/shared/temp/file.md
  - worktree://agent-coder/feat/src/app.ts → absolute path
  - Unknown scheme → throw error
- Permission checks:
  - isOwnWorkspace(path, agentId) → true/false
  - isOwnWorktree(path, agentId) → true/false
  - isOtherAgentWorkspace(path, agentId) → true/false
  - isTeamWorkspace(path, projectRoot) → true/false
  - isProtectedPath(path, protectedPaths) → true/false
- Disk usage calculation cho workspace
- calculateDiskUsage trả về bytes, tính recursive
```

**GREEN** — `src/util/workspace.ts`:

- `createWorkspace(root, agentId, manifest)`
- `removeWorkspace(root, agentId)`
- `createWorktree(projectRoot, workspace, agentId, name)`
- `removeWorktree(workspace, name)`
- `resolveWorkspaceURI(uri, agentId, projectRoot)`
- `isOwnWorkspace`, `isOwnWorktree`, `isOtherAgentWorkspace`, `isTeamWorkspace`, `isProtectedPath`
- `calculateDiskUsage(dir)`

---

## Phase 3: Orchestrator Core

### Task 3.1: Audit logger

**RED** — `test/orchestrator/audit.test.ts`:

```
Setup: tmpdir cho .opencode/team/

Test cases:
- append(event) ghi 1 line JSONL vào audit.jsonl
- append nhiều events → mỗi event 1 line, đúng thứ tự
- Event có đủ fields: ts, agent, action, target?, details?
- Actions logged đúng format: "agent.spawn", "message.sent", "task.assigned"...
- File tạo tự động nếu chưa tồn tại
- Directory tạo tự động nếu chưa tồn tại
- Concurrent appends không corrupt file (append atomic)
- read(n) đọc n events cuối cùng
- read với filter by agent ID
- read với filter by action type
- read với filter by time range
```

**GREEN** — `src/orchestrator/audit.ts`:

- `AuditLogger` class: `append(event)`, `read(options?)`, `readByAgent(agentId)`

### Task 3.2: Agent Registry

**RED** — `test/orchestrator/registry.test.ts`:

```
Test cases:
- register(agent) thêm agent vào registry
- register gán status "idle" mặc định
- register reject nếu agent_id đã tồn tại
- deregister(agentId) xóa agent khỏi registry → status "dead"
- deregister unknown agentId → no-op
- updateStatus(agentId, status) cập nhật status
- updateStatus unknown agentId → throw
- getInfo(agentId) trả về AgentInfo đúng
- getInfo unknown agentId → undefined
- list() trả về tất cả agents
- findByRole(role) trả về agents có role tương ứng
- findByCapability(capability) trả về agents có capability
- findIdle() trả về agents có status "idle"
- recordHeartbeat(agentId, heartbeat) cập nhật last_activity, current_task_id, tokens_used
- recordHeartbeat unknown agentId → throw
- incrementTokenUsage(agentId, input, output) cộng dồn tokens
- toSnapshot() serialize registry sang JSON
- fromSnapshot(json) restore registry từ JSON
```

**GREEN** — `src/orchestrator/registry.ts`:

- `Registry` class: register, deregister, updateStatus, getInfo, list, findByRole,
  findByCapability, findIdle, recordHeartbeat, incrementTokenUsage, toSnapshot, fromSnapshot

### Task 3.3: Message Router

**RED** — `test/orchestrator/router.test.ts`:

```
Setup: registry với 3 agents (coder, reviewer, human), tmpdir cho .opencode/team/

Test cases:
- route message đến specific agent → enqueue vào inbox đúng
- broadcast → enqueue vào tất cả inboxes trừ sender
- message đến unknown agent → dead-letter
- message đến dead agent → dead-letter
- self-delegation (from === to) → reject with error
- hop_count > max_hop → reject with error
- duplicate idempotency_key → reject (dedup)
- rate limit exceeded → reject with error (n+1th message trong 1 phút)
- rate limit window resets after 60 seconds
- rate limit per sender-receiver pair (A→B and A→C tracked separately)
- FIFO order: messages từ A→B giao đúng thứ tự gửi
- TTL expired message → move to dead-letter, notify sender
- inject from/timestamp/id đúng vào envelope
- inbox drain: agent idle → deliver next message
- inbox drain: agent busy → queue, không deliver
- inbox size tracking
- clearInbox(agentId) xóa tất cả queued messages
- getDeadLetters() trả về dead-letter messages
- inbox file persistence: messages written to .opencode/team/inbox/{agentId}.jsonl
- inbox file read on startup: existing messages loaded into memory queue
- dead-letter file persistence: dead letters written to .opencode/team/dead-letter/{agentId}.jsonl
- context.request → orchestrator queries team memory or delegates to target agent
- context.response → routed back to requester
- agent.capability.query → returns capabilities of specified agent
- disagreement → logged and routed to human_authority for resolution
```

**GREEN** — `src/orchestrator/router.ts`:

- `Router` class: route, broadcast, drain, clearInbox, getDeadLetters, checkRateLimit, dedup

### Task 3.4: State Persistence (Snapshot + WAL)

**RED** — `test/orchestrator/state.test.ts`:

```
Setup: tmpdir cho .opencode/team/

Test cases:
- saveSnapshot() ghi state.json đúng structure
- loadSnapshot() đọc state.json → restore state
- appendWAL(entry) ghi 1 line vào wal.jsonl với sequential seq number
- appendWAL nhiều entries → seq tăng dần: 1, 2, 3...
- WAL entry format: { seq, op, data, ts }
- recover() flow:
  1. Load state.json
  2. Replay WAL entries có seq > snapshot_time
  3. Compact: rewrite state.json, truncate WAL
- recover() với empty WAL → chỉ load snapshot
- recover() với empty snapshot → replay toàn bộ WAL
- recover() với corrupted state.json → replay toàn bộ WAL
- concurrent appendWAL không corrupt file
- snapshotTime() trả về thời điểm snapshot cuối
- compact() xóa WAL entries đã reflected trong snapshot
- Full state round-trip: save → modify → save → load → identical
```

**GREEN** — `src/orchestrator/state.ts`:

- `StateManager` class: saveSnapshot, loadSnapshot, appendWAL, recover, compact, snapshotTime

### Task 3.5: Task Queue

**RED** — `test/orchestrator/task-queue.test.ts`:

```
Setup: registry với agents, config

Test cases:
- enqueue(task) thêm task vào queue → trả về task_id
- enqueue reject khi đạt global task cap (max_concurrent_tasks)
- enqueue reject khi team budget exceeded
- enqueue reject khi max_delegation_depth exceeded
- assignNext() tìm capable idle agent → assign task
- assignNext() ưu tiên task priority: critical > high > normal > low
- assignNext() không assign khi không có idle agent capable → task stays queued
- assignNext() match required_capabilities với agent capabilities
- complete(taskId, result) đánh dấu completed, update usage
- complete trigger assignNext cho pending tasks
- cancel(taskId) đánh dấu cancelled
- cancel task đang assigned → notify agent
- delegation chain: A delegate B delegate C → result propagate về A
- delegation depth: hop_count > max → reject
- getTaskStatus(taskId) trả về đúng status
- listPending() trả về tasks chưa assigned
- listActive() trả về tasks đang chạy
- task timeout: task chạy quá task_timeout_seconds → auto cancel
```

**GREEN** — `src/orchestrator/task-queue.ts`:

- `TaskQueue` class: enqueue, assignNext, complete, cancel, getTaskStatus,
  listPending, listActive, checkBudget, checkDepth

### Task 3.6: Budget Manager

**RED** — `test/orchestrator/budget.test.ts`:

```
Test cases:
- trackUsage(agentId, tokens, cost) cộng dồn vào usage
- getUsage(agentId) trả về token usage đúng
- getTeamUsage() trả về tổng tất cả agents
- checkBudget(agentId, estimatedCost) → true nếu trong budget
- checkBudget reject khi per_agent_daily_usd exceeded
- checkBudget reject khi daily_limit_usd exceeded
- checkBudget reject khi per_task_max_usd exceeded
- checkBudget reject khi per_task_max_tokens exceeded
- resetDaily() reset daily counters (gọi đầu ngày mới)
- getBudget() trả về budget config + remaining
- getBudget() tính remaining = limit - used
- Multi-day tracking: day 1 usage không ảnh hưởng day 2
```

**GREEN** — `src/orchestrator/budget.ts`:

- `BudgetManager` class: trackUsage, getUsage, getTeamUsage, checkBudget, resetDaily, getBudget

### Task 3.7: Watchdog

**RED** — `test/orchestrator/watchdog.test.ts`:

```
Setup: registry với agents, fake timers

Test cases:
- tick() với agent last_activity < heartbeat_warning_ms → no action
- tick() với agent last_activity > heartbeat_warning_ms → send ping, log warning
- tick() với agent last_activity > zombie_timeout_ms → mark zombie, terminate
- zombie detection: mark "dead", stash worktrees, move inbox to dead-letter
- zombie notification: notify task requester (delegation chain)
- multiple agents: tick kiểm tra tất cả, xử lý độc lập
- terminate agent với grace_period
- sau grace_period: force kill
- heartbeat từ agent cập nhật last_activity → không bị zombie
- start/stop: watchdog interval đúng
```

**GREEN** — `src/orchestrator/watchdog.ts`:

- `Watchdog` class: tick, start, stop, handleZombie

### Task 3.8: GC Scheduler

**RED** — `test/orchestrator/gc.test.ts`:

```
Setup: tmpdir với workspaces + worktrees

Test cases:
- tick() check worktrees cũ hơn cleanup_timeout_ms → stash + tag + remove
- tick() check disk quota → notify agent nếu exceeded
- tick() không touch worktrees còn active
- cleanup worktree: git stash → tag crash-recovery/{agent}/{ts} → remove
- dead letter retention: xóa dead letters cũ hơn dead_letter_retention_days
- run interval đúng gc_interval_ms
- log audit cho mỗi cleanup action
```

**GREEN** — `src/orchestrator/gc.ts`:

- `GC` class: tick, start, stop, cleanupWorktree, checkDiskQuota, cleanDeadLetters

### Task 3.9: Telemetry

**RED** — `test/orchestrator/telemetry.test.ts`:

```
Setup: tmpdir cho .opencode/team/

Test cases:
- record(event) ghi event vào telemetry.jsonl
- Event format: { ts, agent, event_type, duration_ms?, success?, metadata? }
- Event types: task.start, task.complete, task.fail, message.sent, message.received
- getStats(agentId, timeRange) aggregate correctly
- getStats returns: total_tasks, completed_tasks, failed_tasks, total_messages
- getStats returns: avg_task_duration_ms, cost_total, tokens_total
- getDashboard() returns all agents' stats summary
- retention: old events (>30 days) not returned in queries
- concurrent writes không corrupt telemetry file
```

**GREEN** — `src/orchestrator/telemetry.ts`:

- `Telemetry` class: record, getStats, getDashboard, cleanupOldEvents

### Task 3.10: Orchestrator integration

**RED** — `test/orchestrator/index.test.ts`:

```
Setup: full orchestrator với tmpdir, IPC server

Test cases:
- start() khởi tạo tất cả subsystems (registry, router, task-queue, watchdog, gc, state)
- start() load state từ disk nếu tồn tại
- stop() gracefully shutdown tất cả subsystems
- spawn agent: validate → create workspace → spawn process → register
- spawn reject khi max_agents exceeded
- terminate agent: send terminate → wait grace_period → force kill → cleanup
- agent connect IPC → register → agent appears in registry
- agent send heartbeat → last_activity updated
- agent crash → zombie detection → cleanup → dead-letter
- state recovery: kill orchestrator → restart → state restored
- full flow: spawn agent → assign task → agent complete → result returned
```

**GREEN** — `src/orchestrator/index.ts`:

- `Orchestrator` class integrating all subsystems
- Public API: spawn, terminate, list, getInfo, send, enqueueTask, cancelTask, etc.

---

## Phase 4: A2A Tools

> Mỗi tool registered qua `Hooks.tool` map. Tools chạy IN-PROCESS trong opencode server,
> gọi orchestrator methods trực tiếp (không qua IPC). IPC chỉ dùng cho child agent processes.
>
> ToolContext (từ @opencode-ai/plugin/tool):
>
> ```
> ToolContext = {
>   sessionID: string
>   messageID: string
>   agent: string
>   directory: string      // current project directory
>   worktree: string       // project worktree root
>   abort: AbortSignal
>   metadata(input: { title?: string, metadata?: Record<string, any> }): void
>   ask(input: { permission: string, patterns: string[], always: string[], metadata: Record<string, any> }): Effect.Effect<void>
> }
> ```

### Task 4.1: agent_list tool

**RED** — `test/tools/agent-list.test.ts`:

```
Test cases:
- execute(args, ctx) trả về formatted table tất cả agents + status
  ctx includes: sessionID, messageID, agent, directory, worktree, abort
- include_details=true → thêm capabilities, workspace info
- chỉ trả về agents đang active (không phải "dead")
- empty team → return "No agents in team"
- ctx.sessionID used to identify calling agent
```

### Task 4.2: agent_send tool

**RED** — `test/tools/agent-send.test.ts`:

```
Test cases:
- execute(args, ctx) gửi message đến target agent → confirmation
- target không tồn tại → error "Agent not found"
- self-send (target === agent identified by ctx.sessionID) → error "Cannot send to yourself"
- message được route qua orchestrator directly (in-process method call)
- correlation_id được truyền đúng cho reply chains
```

### Task 4.3: agent_broadcast tool

**RED** — `test/tools/agent-broadcast.test.ts`:

```
Test cases:
- execute(args, ctx) gửi message đến tất cả agents trừ sender (identified by ctx.sessionID)
- message xuất hiện trong inboxes của tất cả agents khác
- team có 1 agent (chỉ mình sender) → no-op
```

### Task 4.4: agent_delegate tool

**RED** — `test/tools/agent-delegate.test.ts`:

```
Test cases:
- execute(args, ctx) gửi delegate message → block → receive delegate.result
- delegation depth check: max_depth exceeded → error
- target không có capability → error "Agent lacks required capabilities"
- target busy → task queued, đợi (respect ctx.abort for cancellation)
- delegation timeout → error
- result propagation: nested delegation trả về đúng result cho delegator ban đầu
- delegation chain: A→B→C, C complete → B complete → A nhận result
```

### Task 4.5: agent_share tool

**RED** — `test/tools/agent-share.test.ts`:

```
Setup: tmpdir với git repo + worktree

Test cases:
- execute(args, ctx) merge branch từ worktree vào team workspace
- auto_merge=true + no conflict → merge success
- auto_merge=false → create PR/branch, không auto merge
- validation_command specified → chạy command trước merge (use ctx.directory for cwd)
- validation_command fail → return validation_failed
- merge conflict → return conflict_files
- share xong → worktree cleanup
- branch không tồn tại → error
- use ctx.worktree to resolve relative paths
```

### Task 4.6: agent_handoff tool

**RED** — `test/tools/agent-handoff.test.ts`:

```
Test cases:
- execute(args, ctx) gather progress → send handoff message
- progress gồm: files_modified, files_created, git_status, git_branch
- transfer_worktree=true → worktree ownership transfer cho receiver
- transfer_worktree=false → worktree giữ nguyên
- receiver accept → handoff.accepted gửi lại
- target không tồn tại → error
- ctx.sessionID identifies the handing-off agent
```

### Task 4.7: agent_query tool

**RED** — `test/tools/agent-query.test.ts`:

```
Test cases:
- scope="team" → query memory.jsonl, trả về relevant results
- scope="agent" + target_agent → query agent decisions.jsonl
- empty results → return "No matching context found"
- query string matching: substring match trong summary/rationale
```

### Task 4.8: agent_revert tool

**RED** — `test/tools/agent-revert.test.ts`:

```
Setup: tmpdir với git repo + existing merge commit

Test cases:
- execute(args, ctx) git revert merge_commit → success (ctx.worktree for repo root)
- revert logged vào audit trail
- merge_commit không tồn tại → error
- merge_commit không phải merge → vẫn revert (git revert works on any commit)
```

**GREEN cho tất cả tools** — `src/tools/*.ts`:

- Mỗi file export tool definition dùng `tool()` từ `@opencode-ai/plugin/tool`
- Tools gọi orchestrator methods trực tiếp (in-process) để send/route messages
- ToolContext cung cấp `sessionID` để identify agent, `directory`/`worktree` cho path resolution
- ToolContext.ask() dùng cho permission checks nếu cần
- ToolContext.abort() dùng cho cancellation
- ToolContext.metadata() dùng để report progress/titles

---

## Phase 5: Server Plugin Hooks

### Task 5.1: Permission enforcement

**RED** — `test/hooks/permission.test.ts`:

```
Setup: mock agent session + workspace paths

permission.ask hook signature (from @opencode-ai/plugin):
  input: Permission { id, type, pattern?, sessionID, messageID, callID?, title, metadata, time }
  output: { status: "ask" | "deny" | "allow" }

Test cases:
- Agent edit own workspace: input.type="edit", input.pattern=path → allow
- Agent edit own worktree: input.type="edit", input.pattern=worktree path → allow
- Agent edit team workspace (not worktree): input.type="edit", input.pattern=team path → deny
- Agent edit other agent workspace: input.type="edit", input.pattern=other workspace → deny
- Agent edit protected path (.opencode/team/): input.type="edit", input.pattern → deny
- Agent read own workspace: input.type="read", input.pattern → allow
- Agent read team workspace: input.type="read", input.pattern → allow
- Agent read other agent workspace: input.type="read", input.pattern → deny
- Agent run bash với dangerous git command: input.type="bash", input.metadata.command="push --force" → deny
- Agent run bash bình thường: input.type="bash", input.metadata.command="git status" → allow (nếu config cho phép)
- Non-agent session (human, không có agent trong metadata) → không enforce (pass through, status="ask")
- Verify input.type used to determine permission kind (not a separate input.permission field)
- Verify path comes from input.pattern (string or string[])
- Verify bash command comes from input.metadata.command (not a top-level field)
```

**GREEN** — `src/hooks/permission.ts`

### Task 5.2: Tool execution guards

**RED** — `test/hooks/tool-guard.test.ts`:

```
tool.execute.before hook signature:
  input: { tool: string, sessionID: string, callID: string }
  output: { args: any }

tool.execute.after hook signature:
  input: { tool: string, sessionID: string, callID: string, args: any }
  output: { title: string, output: string, metadata: any }

Test cases:
- tool.execute.before: output.args.filePath contains workspace:// → resolve to absolute path
- tool.execute.before: output.args.path contains team:// → resolve to absolute path
- tool.execute.before: output.args.filePath contains worktree:// → resolve to absolute path
- tool.execute.before: output.args.path contains shared:// → resolve to absolute path
- tool.execute.before: output.args không có URI scheme → không modify
- tool.execute.after: redact secrets trong output.output
- tool.execute.after: broadcast file change notification khi input.tool === "edit" || "write"
- Use input.sessionID to identify which agent is executing
```

**GREEN** — `src/hooks/tool-guard.ts`

### Task 5.3: System prompt injection

**RED** — `test/hooks/system-prompt.test.ts`:

```
experimental.chat.system.transform hook signature:
  input: { sessionID?: string, model: Model }
  output: { system: string[] }  — push strings into output.system

Test cases:
- Inject team context: agent id, role, priority (use input.sessionID to identify agent)
- Inject team members list: id, role, status, current task
- Inject workspace info: private, worktrees, team workspace
- Inject available tools list
- Inject rules (write restrictions, share required, role priority)
- No agents registered → inject minimal context
- input.model available for model-specific prompts
```

**GREEN** — `src/hooks/system-prompt.ts`

### Task 5.4: Event handler

**RED** — `test/hooks/event-handler.test.ts`:

```
event hook receives { event: Event } where Event is a discriminated union on event.type.
Data is nested inside event.properties, NOT at top level.

Test cases:
- session.idle event: event.type === "session.idle", event.properties.sessionID → notify orchestrator agent idle
- session.idle → inbox drain triggered using event.properties.sessionID
- file.watcher.updated: event.type === "file.watcher.updated", event.properties.file + event.properties.event → broadcast file change
- session.error: event.type === "session.error", event.properties.sessionID + event.properties.error → report error to orchestrator
```

**GREEN** — `src/hooks/event-handler.ts`

### Task 5.5: Compaction hook

**RED** — `test/hooks/compaction.test.ts`:

```
experimental.session.compacting hook signature:
  input: { sessionID: string }
  output: { context: string[]; prompt?: string }

Test cases:
- Inject team memory vào output.context
- Inject agent recent decisions vào output.context
- Inject current task info vào output.context
- Empty memory → inject minimal context
- Optionally override output.prompt for custom compaction behavior
```

**GREEN** — hook registered trong `src/server.ts` as part of Hooks return

### Task 5.6: Shell env hook

**RED** — `test/hooks/shell-env.test.ts`:

```
shell.env hook signature:
  input: { cwd: string, sessionID?: string, callID?: string }
  output: { env: Record<string, string> }

Test cases:
- Inject AGENT_ID, AGENT_ROLE, AGENT_WORKSPACE, TEAM_WORKSPACE vào output.env
- Use input.sessionID (optional) to identify agent
- Non-agent session (input.sessionID undefined or not an agent) → không inject
```

**GREEN** — hook registered trong `src/server.ts` as part of Hooks return

### Task 5.7: Server plugin entry

**RED** — Integration test cho full server plugin:

```
Server plugin signature: (input: PluginInput, options?) => Promise<Hooks>

PluginInput fields: { client, project, directory, worktree, serverUrl, $ }

PluginModule default export shape: { id: "agent-team", server: Plugin }

Test cases:
- Plugin default export đúng shape: { id: "agent-team", server: async (input) => Hooks }
- server() returns Hooks object với tool, permission.ask, event, và các hooks khác
- Tool registrations (Hooks.tool) có đủ 8 tools
- Plugin nhận đúng PluginInput fields (client, project, directory, worktree, serverUrl, $)
- Orchestrator init khi plugin load (tạo .opencode/team/ directory)
- Orchestrator cleanup — no explicit dispose hook, use process shutdown
- Hooks.config được gọi khi config thay đổi
```

**GREEN** — `src/server.ts`:

- Default export `{ id: "agent-team", server: async (input) => Hooks }`
- server() function khởi tạo orchestrator và returns Hooks object
- Wire tất cả hooks + tools + orchestrator

### Task 5.8: Config hook + tool.definition hook

**RED** — `test/hooks/extra-hooks.test.ts`:

```
Hooks.config signature (từ @opencode-ai/plugin):
  (input: Config) => Promise<void>
Config type: full opencode config object

Hooks["tool.definition"] signature:
  (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>

Test cases:
- config hook receives team config section → extract team settings
- config hook updates orchestrator config khi config thay đổi
- tool.definition hook modifies tool descriptions cho agent-specific context
- tool.definition hook thêm agent-specific parameter hints (e.g., available agent IDs for target param)
```

---

## Phase 6: TUI Plugin

### Task 6.1: Team Dashboard route

**RED** — `test/tui/team-route.test.ts`:

```
TuiRouteDefinition = { name: string, render: (input: { params?: Record<string, unknown> }) => JSX.Element }

Test cases (component rendering tests):
- Render agent grid với agents data
- Agent status hiển thị đúng màu (idle=green, busy=yellow, dead=red)
- Current task hiển thị cho busy agents
- Cost hiển thị cho mỗi agent
- Empty team → "No agents" message
- Click agent → api.route.navigate("agent-detail", { agentId: ... })
```

### Task 6.2: Inbox route

**RED** — `test/tui/inbox-route.test.ts`:

```
Test cases:
- Render message list từ human inbox
- Unread count badge
- Reply action available
- Delegate action available
- Empty inbox → "No messages" message
```

### Task 6.3: Agent detail route

**RED** — `test/tui/agent-detail-route.test.ts`:

```
Test cases:
- Render agent info: status, role, workspace, worktrees
- Decision log hiển thị
- Cost breakdown hiển thị
- Actions: send message, delegate task, terminate
```

### Task 6.4: Sidebar slot

**RED** — `test/tui/sidebar-slot.test.ts`:

```
Sidebar slot registration uses SolidPlugin pattern (NOT plain object with slot/render).

api.slots.register() takes a SolidPlugin<TuiSlotMap, TuiSlotContext>:
  {
    slots: {
      sidebar_content: {
        render: (props: { session_id: string }, ctx: TuiSlotContext) => JSX.Element
      }
    }
  }

Available host slots (from TuiHostSlotMap):
  - sidebar_content: { session_id: string }
  - home_bottom: {}
  - home_footer: {}
  - (see @opencode-ai/plugin/tui TuiHostSlotMap for full list)

Test cases:
- Mini agent status indicators render in sidebar_content slot
- Unread inbox count badge hiển thị đúng số
- Slot receives props.session_id correctly
- Click → call api.route.navigate("inbox")
```

### Task 6.5: TUI plugin entry

**RED** — Integration test:

```
TUI plugin signature: (api: TuiPluginApi, options, meta: TuiPluginMeta) => Promise<void>

Key TuiPluginApi fields:
  - api.command.register(cb: () => TuiCommand[]) => () => void
  - api.route.register(routes: TuiRouteDefinition[]) => () => void
  - api.slots.register(plugin: TuiSlotPlugin) => string
  - api.event.on(type, handler) => () => void
  - api.lifecycle.onDispose(fn) => () => void
  - api.lifecycle.signal: AbortSignal

Test cases:
- Plugin export đúng shape: default export { id: "agent-team", tui: async (api, options, meta) => void }
- Commands registered via api.command.register(): ctrl+T, inbox, spawn, cost, detail
- Routes registered via api.route.register(): team, inbox, agent-detail
- Sidebar slot registered via api.slots.register() with SolidPlugin pattern
- Event subscriptions active via api.event.on()
- Cleanup via api.lifecycle.onDispose() registered
- api.lifecycle.signal listened for abort
```

**GREEN** — `src/tui.ts` + `src/tui/*.tsx`

---

## Phase 7: End-to-End Integration

### Task 7.1: Full spawn-delegate-complete flow

**RED** — `test/e2e/spawn-delegate-complete.test.ts`:

```
Setup: full orchestrator + mock agent processes

Test cases:
- Human spawns coder agent → coder registers → idle
- Human delegates task to coder → coder receives task → busy
- Coder creates worktree → works → sends progress
- Coder calls agent_share → merge to team workspace
- Coder sends task.result → idle
- Human receives notification → check inbox
- Cost tracked correctly throughout
```

### Task 7.2: Agent delegation chain

**RED** — `test/e2e/delegation-chain.test.ts`:

```
Test cases:
- Architect delegates to coder → coder delegates sub-task to reviewer
- Reviewer sends result → coder receives → coder sends result → architect receives
- Depth limit enforcement: A→B→C→D rejected at depth 3
- Circular delegation prevention: A→B→A rejected
```

### Task 7.3: Crash recovery

**RED** — `test/e2e/crash-recovery.test.ts`:

```
Test cases:
- Agent crashes mid-task → orchestrator detects → cleanup → dead-letter
- Worktree stashed + tagged → manual recovery possible
- Orchestrator crash → restart → state recovered → agents re-register
- Agent không re-register sau reconnect_timeout → mark dead
```

### Task 7.4: Budget enforcement

**RED** — `test/e2e/budget-enforcement.test.ts`:

```
Test cases:
- Task rejected khi per_task_max exceeded
- New task rejected khi per_agent_daily exceeded
- New task rejected khi team daily_limit exceeded
- Daily reset → budget available again
```

### Task 7.5: Permission enforcement E2E

**RED** — `test/e2e/permission-enforcement.test.ts`:

```
Test cases:
- Agent cố edit team workspace → denied
- Agent cố read other agent workspace → denied
- Agent cố chạy push --force → denied
- Agent edit own workspace → allowed
- Agent edit own worktree → allowed
```

---

## Phase 8: Polish + Package

### Task 8.1: Configuration validation

**RED** — `test/config.test.ts`:

```
Test cases:
- TeamConfig schema parse valid config
- TeamConfig defaults đúng khi fields missing
- TeamConfig reject invalid human_authority values ("always" | "advisory" | "none")
- TeamConfig reject negative budget values
- TeamConfig reject zero or negative max_agents
- TeamConfig reject negative max_concurrent_tasks
- TeamConfig reject negative max_delegation_depth
- TeamConfig reject invalid gc.cleanup_timeout_ms (must be positive)
- TeamConfig reject invalid watchdog values
- TeamConfig accept valid git.protected_branches array
- TeamConfig accept valid git.denied_commands array
- TeamConfig accept pre_merge_validation string
- TeamConfig accept nested agents with all capability fields
- Per-agent config merge với defaults đúng
- Partial agent config inherits defaults from base capabilities
```

### Task 8.2: Package exports

**RED** — `test/exports.test.ts`:

```
Test cases:
- Server entry: default export has { id: "agent-team", server: function }
- TUI entry: default export has { id: "agent-team", tui: function }
- Server entry server() returns Promise<Hooks> with expected hook keys
- import protocol types → all types available (MessageEnvelope, MessageType, etc.)
- import orchestrator → Orchestrator class available
```

### Task 8.3: README + publish prep

- README với usage examples
- Ensure `bun typecheck` passes
- Ensure `bun test` passes
- Verify package.json exports đúng

---

## Dependency Graph

```
Phase 1 (Protocol)
  ↓
Phase 2 (IPC + Workspace)
  ↓
Phase 3 (Orchestrator) ← Phase 3.1-3.8 song song; 3.9 (telemetry) phụ thuộc audit; 3.10 cần tất cả
  ↓
Phase 4 (Tools)          ← cần Orchestrator + Protocol
  ↓
Phase 5 (Server Hooks)   ← cần Tools + Orchestrator
  ↓
Phase 6 (TUI)            ← cần Protocol types
  ↓
Phase 7 (E2E)            ← cần tất cả
  ↓
Phase 8 (Polish)
```

## Within each task: RED-GREEN-REFACTOR cycle

```
1. RED:    Viết test → chạy test → THẤT BẠI (code chưa có)
2. GREEN:  Viết minimum code cho test pass → chạy test → PASS
3. REFACTOR: Dọn code, extract helpers, improve naming → chạy test → vẫn PASS
```

### Test infrastructure cần build trước (không TDD, là setup)

- `test/fixture/workspace.ts` — tmpdir helpers cho agent workspace
- `test/fixture/orchestrator.ts` — mock orchestrator cho tool tests
- `test/fixture/agent.ts` — mock agent IPC client

---

## Appendix: OpenCode Plugin SDK Reference

> Quick reference cho types thực tế từ `@opencode-ai/plugin`, `@opencode-ai/plugin/tui`,
> và `@opencode-ai/plugin/tool`. Phiên bản được review từ codebase ngày 2026-04-13.

### Server Plugin

```ts
// @opencode-ai/plugin
type PluginInput = {
  client: ReturnType<typeof createOpencodeClient> // HTTP client
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell // Bun shell
}

type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>

type PluginModule = {
  id?: string
  server: Plugin
  tui?: never // CANNOT have both server and tui
}
```

### Hooks (Server Plugin Return)

```ts
interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }

  "chat.message"?: (...) => Promise<void>
  "chat.params"?: (...) => Promise<void>
  "chat.headers"?: (...) => Promise<void>
  "permission.ask"?: (
    input: Permission,           // { id, type, pattern?, sessionID, messageID, callID?, title, metadata, time }
    output: { status: "ask" | "deny" | "allow" },
  ) => Promise<void>
  "command.execute.before"?: (...) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (...) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: { system: string[] },
  ) => Promise<void>
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  "experimental.text.complete"?: (...) => Promise<void>
  "tool.definition"?: (
    input: { toolID: string },
    output: { description: string; parameters: any },
  ) => Promise<void>
}
```

### Tool Definition

```ts
// @opencode-ai/plugin/tool
type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, any> }): void
  ask(input: {
    permission: string
    patterns: string[]
    always: string[]
    metadata: Record<string, any>
  }): Effect.Effect<void>
}

function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
}): ToolDefinition
tool.schema = z // zod re-export
```

### TUI Plugin

```ts
// @opencode-ai/plugin/tui
type TuiPlugin = (api: TuiPluginApi, options: PluginOptions | undefined, meta: TuiPluginMeta) => Promise<void>

type TuiPluginModule = {
  id?: string
  tui: TuiPlugin
  server?: never // CANNOT have both
}

type TuiPluginApi = {
  command: { register(cb: () => TuiCommand[]): () => void; trigger(value: string): void; show(): void }
  route: {
    register(routes: TuiRouteDefinition[]): () => void
    navigate(name: string, params?: Record<string, unknown>): void
    readonly current: TuiRouteCurrent
  }
  slots: { register(plugin: TuiSlotPlugin): string } // SolidPlugin pattern, NOT plain object
  event: TuiEventBus // on<type>(type, handler) => unsubscribe
  lifecycle: TuiLifecycle // { signal: AbortSignal, onDispose(fn) => unsubscribe }
  ui: { Dialog; DialogAlert; DialogConfirm; DialogPrompt; DialogSelect; Slot; Prompt; toast; dialog }
  theme: TuiTheme
  kv: TuiKV
  state: TuiState
  client: OpencodeClient
  renderer: CliRenderer
  keybind: { match; print; create }
  plugins: { list; activate; deactivate; add; install }
  readonly tuiConfig: Frozen<TuiConfigView>
}

// Sidebar slot: use SolidPlugin with slots map
api.slots.register({
  slots: {
    sidebar_content: {
      render: (props: { session_id: string }, ctx: TuiSlotContext) => JSX.Element,
    },
  },
})
```

### Key SDK Event Types

```ts
// Events are discriminated unions on event.type
// Data nested inside event.properties, NOT top-level

EventSessionIdle = { type: "session.idle", properties: { sessionID: string } }
EventSessionError = { type: "session.error", properties: { sessionID?: string, error?: ... } }
EventFileWatcherUpdated = { type: "file.watcher.updated", properties: { file: string, event: "add" | "change" | "unlink" } }
// NOTE: "message.updated" does NOT exist in SDK — use "session.idle" or file events instead
```
