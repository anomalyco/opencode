# Teams & Agents Feature — Design Spec

## Summary

Add multi-agent team coordination primitives to opencode, enabling workflows where a lead agent orchestrates multiple specialist sub-agents that work in parallel, communicate findings, and produce synthesized results.

This unlocks the same class of workflows that Claude Code supports via TeamCreate/TaskCreate/SendMessage primitives, but designed natively for opencode's architecture (Sessions, MessageV2, Bus, Instance state, Drizzle DB).

## Problem

opencode's current `TaskTool` only supports synchronous sub-agent execution: spawn a child session, block until it completes, return the result. This is insufficient for:

1. **Parallel specialist reviews** — spawning 8 agents simultaneously, each reviewing a spec from a different angle
2. **Inter-agent communication** — agents sending findings to a lead, or challenging each other's findings
3. **Persistent agent memory** — agents learning project-specific patterns across sessions
4. **Coordinated task boards** — shared state visible to all team members

## Solution

### New Subsystems

#### 1. Team Management (`src/team/`)

A **Team** is a named group of sessions with a lead and members. DB-backed via `team` and `team_member` tables.

- `Team.create({ name, sessionID })` — creates team and registers lead in a single transaction
- `Team.disband(id)` — marks team disbanded, all active members cancelled, all pending/in-progress tasks failed
- `Team.addMember({ teamID, sessionID, agent })` — registers a member (rejects disbanded teams; auto-disambiguates duplicate agent names with `-N` suffix)
- `Team.findMemberSession({ teamID, agent })` — resolve agent → session
- `Team.leadSession(teamID)` — get the lead's session
- `Team.completeMember(sessionID)` — marks a member as completed on normal exit
- `Team.failMember({ teamID, sessionID, agent })` — marks member as failed, cascades to owned in-progress tasks
- `Team.disbandBySession(sessionID)` — auto-disbands all active teams owned by a session
- `Team.reconcile()` — marks all active teams as disbanded on server startup (stale state cleanup)

**Team status values:** `active`, `disbanded`.

**Member status values:** `active`, `completed`, `failed`, `cancelled`.

Member status transitions:

- `active` → `completed` — member exits normally (timeout, no more work)
- `active` → `failed` — background agent crashes
- `active` → `cancelled` — team is disbanded while member is still active

**Agent name uniqueness:** A unique index enforces `UNIQUE(team_id, agent)` on `team_member`. When `addMember` is called with a duplicate agent name, it auto-disambiguates by appending a numeric suffix (e.g., `general-2`, `general-3`). This supports workflows that spawn multiple agents of the same type.

#### 2. Team Task Board (`src/team/task.ts`)

Shared task state scoped to a team. Any member can read/update. Tools validate the team exists and is active before operating.

- `TeamTask.create({ teamID, subject, owner })` — create a task
- `TeamTask.update(id, { status, owner })` — update status
- `TeamTask.list(teamID)` — list all team tasks

Statuses: `pending`, `in_progress`, `completed`, `failed`.

#### 3. Message Injection (`src/session/inject.ts`)

Cross-session message passing. A synthetic user message is written into a target session's DB, and the prompt loop picks it up on its next iteration.

- `SessionInject.send({ sessionID, from, fromSessionID, content })` — inject message
- Publishes `session.message.injected` event on the Bus
- Messages are tagged with `injected: { from, fromSessionID, teamID }` on the User message schema
- The target session's agent type is resolved dynamically from its last user message (not hardcoded)

#### 4. Background Agent Execution (modified `src/tool/task.ts`)

Extended TaskTool with two new parameters:

- `background: boolean` — when true, launches the child session in a detached async context via `Instance.bind()` and returns immediately with the `task_id`
- `team_id: string` — registers the child session as a team member; grants `send_message` and `team_task` permissions to the child

**Concurrency limit:** A process-wide counter limits the number of concurrent background agents. Default: 10, configurable via `team.max_agents`. Throws a descriptive error when the limit is exceeded.

**Failure handling:** When a background agent crashes:

1. The member is marked `failed` via `Team.failMember()`
2. The agent's owned in-progress tasks are cascaded to `failed`
3. A `[AGENT FAILURE]` notification is injected into the lead session via `SessionInject.send()`

**Sender validation:** The `send_message` tool validates that the sending session is a member of the target team before allowing message injection.

#### 5. Agent Memory (`src/agent/memory.ts`)

Persistent per-agent, per-project memory stored in `agent_memory` table with a unique index on `(project_id, agent)`.

- `AgentMemory.read(agent)` — read stored memory
- `AgentMemory.write(agent, content)` — replace memory (capped at 100KB; truncated with warning if exceeded)
- `AgentMemory.append(agent, content)` — append to memory (same 100KB cap applied after append)

Injected into the system prompt when `memory: local` is set on the agent definition.

#### 6. Prompt Loop Changes (`src/session/prompt.ts`)

When a background team member's loop would normally exit (assistant finished, no pending user message), it now:

1. Checks if the session is registered as an active team member
2. If yes, waits for an injected message (via typed `Bus.subscribe` on `SessionInject.Event.MessageInjected`)
3. To avoid a race where a message is injected before the subscription is established, the wait also checks the DB for pending user messages immediately after subscribing
4. If a message arrives, continues the loop
5. If timeout (configurable via `team.member_timeout`, default 5 minutes) or abort, marks the member as `completed` and exits normally

### Lifecycle & Cleanup

- **Session cancellation** — when a lead session is cancelled, `Team.disbandBySession()` auto-disbands all its active teams. Members are marked `cancelled`, pending/in-progress tasks are marked `failed`.
- **Server restart** — `Team.reconcile()` runs on startup and marks all active teams as disbanded (stale state from a previous process).
- **Background member normal exit** — member's `team_member` status is updated to `completed` before exiting. The lead can observe this via `Team.members()`.
- **Background member crash** — member is marked `failed`, tasks cascaded, lead is notified via injected message.
- **Explicit disband** — `team_delete` tool sets all active members to `cancelled`. Members waiting for messages will time out after `member_timeout` and exit (the disband event does not immediately wake waiting members; this is accepted behavior with a bounded worst-case delay).

### New Tools

| Tool           | Permission     | Description                               |
| -------------- | -------------- | ----------------------------------------- |
| `team_create`  | `team_create`  | Create a named agent team                 |
| `team_delete`  | `team_delete`  | Disband a team                            |
| `team_task`    | `team_task`    | CRUD operations on the team task board    |
| `send_message` | `send_message` | Send a message to another team member     |
| `agent_memory` | `agent_memory` | Read/write/append persistent agent memory |

### DB Schema (Migration)

Four new tables:

- `team` — id, session_id (lead), name, status (`active` | `disbanded`), timestamps
- `team_member` — team_id, session_id, agent, role (`lead` | `member`), status (`active` | `completed` | `failed` | `cancelled`), timestamps. Unique index on `(team_id, agent)`.
- `team_task` — id, team_id, subject, description, owner, status (`pending` | `in_progress` | `completed` | `failed`), metadata (JSON), timestamps
- `agent_memory` — id, project_id, agent, content (capped at 100KB), timestamps. Unique index on `(project_id, agent)`.

### Config Schema Changes

- `Agent.Info` gains `memory: "none" | "local"` field
- `Config.Agent` gains `memory` in schema and `knownKeys` set
- `Config` gains optional `team` section:
  - `max_agents: number` (default 10) — process-wide max concurrent background agents
  - `member_timeout: number` (default 300000ms / 5 minutes) — how long a team member waits for injected messages before exiting

### Server Routes

New `/team` route group: list teams by session, get team, get members, create team, disband team, list/create tasks. Also `/team/active` for TUI bootstrap (returns all active teams with their members).

## Design Decisions

1. **Async message passing via DB writes** — fits opencode's existing pattern where the prompt loop re-reads messages from DB each iteration. No in-memory queues needed.

2. **Teams scoped to lead session** — multiple concurrent reviews don't interfere. Lead session owns the lifecycle.

3. **Agent memory in SQLite** — consistent with all other opencode storage. Unique index on (project_id, agent) ensures one memory entry per agent per project. Content capped at 100KB to prevent context window overflow.

4. **Background execution via `Instance.bind()`** — preserves ALS context (project, directory, worktree) for the child session. No worker threads needed.

5. **Configurable wait timeout for team members** — prevents zombie sessions. Default 5 minutes, configurable via `team.member_timeout`. If no message arrives, the member marks itself `completed` and exits.

6. **New tools are always registered** — permission-gated at execution time, not at registration. The explore agent's `"*": deny` naturally blocks all team tools.

7. **Agent name auto-disambiguation** — unique index on `(team_id, agent)` enforces uniqueness. `addMember` automatically appends a numeric suffix (`-2`, `-3`, ...) when a duplicate agent type is added to the same team.

8. **Process-wide concurrency limit** — the `max_agents` counter is module-level (not per-instance). This is intentional for resource management — the limit governs total system load regardless of how many project instances are open.

9. **Failure notification to lead** — when a background agent crashes, the lead receives an injected `[AGENT FAILURE]` message so it can adapt its workflow. Member status and owned tasks are also cascaded to `failed`.

## Files Changed

### New (15 files)

- `src/team/schema.ts` — TeamID, TeamTaskID, MemoryID branded types
- `src/team/team.sql.ts` — Drizzle table definitions
- `src/team/index.ts` — Team namespace
- `src/team/task.ts` — TeamTask namespace
- `src/agent/memory.ts` — AgentMemory namespace
- `src/session/inject.ts` — SessionInject namespace
- `src/tool/team-create.{ts,txt}` — TeamCreate tool
- `src/tool/team-delete.{ts,txt}` — TeamDelete tool
- `src/tool/team-task.{ts,txt}` — TeamTask tool
- `src/tool/send-message.{ts,txt}` — SendMessage tool
- `src/tool/agent-memory.{ts,txt}` — AgentMemory tool
- `src/server/routes/team.ts` — Team API routes
- `migration/20260321160000_add_teams/migration.sql` — DB migration

### Modified (10 files)

- `src/id/id.ts` — 3 new prefixes
- `src/tool/task.ts` — background + team_id params, concurrency limit, failure notification
- `src/tool/task.txt` — team workflow docs
- `src/tool/registry.ts` — 5 new tools registered
- `src/agent/agent.ts` — memory field
- `src/config/config.ts` — memory in Agent schema, `team` config section
- `src/session/message-v2.ts` — injected field on User
- `src/session/prompt.ts` — team-aware loop exit + wait, member completion on exit, race-safe injection wait
- `src/session/system.ts` — memory injection into system prompt
- `src/server/server.ts` — TeamRoutes registered, startup reconciliation

## Risks & Open Questions

1. **No rate limiting on SendMessage** — an agent could spam messages. Mitigated by the natural LLM turn structure (each message requires an LLM turn to produce).
2. **Disband does not immediately wake waiting members** — members in `waitForInjection` only listen for `session.message.injected`, not `team.disbanded`. They will idle until `member_timeout` expires. This is accepted behavior — the bounded worst case is the configured timeout (default 5 min).
3. **Migration backward compat** — additive only (new tables), safe to alternate between versions.
