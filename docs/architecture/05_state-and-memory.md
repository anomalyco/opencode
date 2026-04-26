# State & Memory Management

## 1. Shadow Git Checkpointing & State Reversal

Opencode establishes a dedicated shadow directory within the user's application data folder to manage workspace snapshots independently of the primary repository. This invisible state layer serves as an automated safety net, tracking modifications made by the agent without polluting the user's standard version control history or requiring manual commits.

To capture the state efficiently, the checkpointing mechanism utilizes `git write-tree` to generate silent, near-instantaneous snapshots of the active workspace. Before the agent executes any tool that modifies the filesystem, the harness quietly records these point-in-time tree objects, guaranteeing a reliable recovery vector exists for every conversational turn.

When the user chooses to revert a chat turn, Opencode relies on a targeted `git checkout <hash> -- <file>` operation rather than a destructive hard reset. This surgical recovery approach ensures that only the specific files altered by the agent are rolled back, safely preserving any concurrent human edits made elsewhere in the codebase. However, if the agent newly *creates* a file (meaning it did not exist in the snapshot hash), running `git checkout <hash> -- <file>` will fail. The implementation handles this reactively: if the `checkout` operation fails, it subsequently queries `git ls-tree` to verify if the file existed in the snapshot tree. If the file is missing from the tree, the engine executes a hard file deletion (`yield* remove(op.file)`).

*(Note: These Git operations are completely encapsulated behind the `Snapshot.Service` in [`src/snapshot/index.ts`](../../packages/opencode/src/snapshot/index.ts). The `SessionRevert` engine delegates all snapshotting and reversion logic to this service, rather than invoking bash commands directly).*

**Crucially, this revert mechanism is purely deterministic, not "smart."** It strictly reverts local filesystem diffs via Git. It has absolutely zero awareness of—and makes no intelligent attempt to rollback—external side effects.

---

## 2. Stateful Task Tracking (Todo)

Opencode features an explicit stateful task tracking mechanism designed to prevent the primary `@build` agent from losing track of long-running, multi-step operations as the conversation context window shifts or compresses over time.

This functionality is exposed to the LLM via the singular `todowrite` tool ([`src/tool/todo.ts`](../../packages/opencode/src/tool/todo.ts)). Crucially, there is exactly **one canonical todo list per conversational session**.

Whenever an agent invokes the `todowrite` tool, it must submit an array of updated task objects representing the entirety of the current plan. The system ([`src/session/todo.ts`](../../packages/opencode/src/session/todo.ts)) then executes a SQLite transaction that entirely deletes the previous todo rows for the active `session_id` and inserts the newly provided tasks:

```typescript
db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
db.insert(TodoTable).values(...)
```

Because of this hard replacement logic, the agent actively curates a single source of truth for its own execution state, ticking items to `completed` or `in_progress` over the lifecycle of the session without permanently bloating the chat log with intermediate planning text.

---

## 3. Database Schema & State Pagination

Opencode utilizes SQLite combined with the Drizzle ORM to maintain rich, typed, and event-sourced state locally for each conversational session.

### The Drizzle ORM Schema

The core database definitions are located in [`src/session/session.sql.ts`](../../packages/opencode/src/session/session.sql.ts). Unlike simplistic stateless CLIs, Opencode maintains a complex relational structure:

- **`SessionTable`**: The root aggregate representing a chat thread. Contains global session metadata, current active configurations, and custom agent parameters overriding the default configuration.
- **`MessageTable`**: Represents a single LLM "turn" (either a `user` prompt or an `assistant` response). It acts as an envelope containing token usage, timestamps, and the specific agent/model used for that turn.
- **`PartTable`**: A highly granular one-to-many relationship mapping `MessageTable` -> `PartTable`. This allows Opencode to serialize complex internal abstractions—like tool calls (`ToolPart`), internal reasonings (`ReasoningPart`), specific file context references (`FilePart`), and synthetic system context—without losing structural fidelity.

### Granular Data Loading & Pagination

Large coding sessions can accumulate thousands of parts and enormous `ToolState` metadata outputs (e.g., storing the full `stderr` of a failed compiler run).

To maintain highly performant execution and UI rendering, Opencode employs aggressive linear pagination via SQLite.

As implemented in [`src/session/message-v2.ts`](../../packages/opencode/src/session/message-v2.ts), the `page()` function retrieves a limited chunk of `MessageTable` rows, and subsequently hydrates the attached `PartTable` entities *only* for the messages in the active window. This guarantees that deep historical context does not cause memory bloat on load.

---

## 4. Asynchronous Daemons & Background Observers

Opencode diverges significantly from synchronous LLM wrappers by utilizing "Daemon Agents"—invisible, asynchronous subagents that operate on secondary threads without blocking the user's primary conversational loop. This architecture relies entirely on **Effect-TS** structured concurrency and explicit forking (`Effect.forkIn(scope)`).

By offloading metadata and state-maintenance tasks to these daemons, the primary execution loop remains perfectly focused on the user's prompt, achieving both lower latency and lower token costs by routing mundane tasks to smaller models (e.g., Claude Haiku or Gemini Flash).

### The Daemon Lifecycle ([`src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts))

Within the core `runLoop`, Opencode dynamically forks background tasks attached to the session's active `Scope`. Because they are tied to this scope, if the user aborts the session, the background daemons are instantly and safely interrupted without leaving orphaned processing threads.

- **`@title` Agent**: Triggered automatically during the very first conversational step. Opencode forks a non-blocking fiber that invokes a fast model. It silently reads the user's initial prompt and the agent's first response, autonomously generates a highly descriptive label for the chat session, and updates the SQLite database. The user's terminal experience is never blocked waiting for this label generation.
- **`@summary` Agent**: Similar to the title daemon, this agent runs asynchronously to continually summarize the current trajectory of long-running tasks. It distills complex multi-step refactors into concise progress checkpoints that can be used for context restoration if the primary loop crashes.

### Token Compaction

To mitigate context window exhaustion (`ContextOverflowError`), the harness triggers the background **`@compaction` agent**.

This systemic daemon continually monitors token budgets (`compaction.isOverflow`). When the context window approaches its maximum token threshold, it silently processes the SQLite `MessageV2` event log, executing an LLM summarization pass to compress older message turns into dense "context anchors." It acts as an autonomous memory manager, ensuring the working prompt remains performant without requiring external vector databases or interrupting the primary agent's task execution.

---

## 5. Source Code Reference

The mechanics discussed in this document are primarily implemented in the following files:

- **[`src/snapshot/index.ts`](../../packages/opencode/src/snapshot/index.ts)**: Implements the Shadow Git checkpointing mechanism, handling `git write-tree` captures and surgical `git checkout` rollbacks.
- **[`src/session/revert.ts`](../../packages/opencode/src/session/revert.ts)**: The session-level engine that interfaces with the Snapshot service to revert specific message turns.
- **[`src/session/todo.ts`](../../packages/opencode/src/session/todo.ts)** and **[`src/tool/todo.ts`](../../packages/opencode/src/tool/todo.ts)**: Implements the stateful Todo tracking, handling the database transactions that enforce the "one canonical list" rule.
- **[`src/session/session.sql.ts`](../../packages/opencode/src/session/session.sql.ts)**: The primary Drizzle ORM schema definitions for `SessionTable`, `MessageTable`, and `PartTable`.
- **[`src/session/message-v2.ts`](../../packages/opencode/src/session/message-v2.ts)**: Contains the linear `page()` logic responsible for safely hydrating paginated context without memory bloat.
- **[`src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts)**: The core execution engine where the `@title`, `@summary`, and `@compaction` daemon fibers are dynamically spawned using `Effect.forkIn`.