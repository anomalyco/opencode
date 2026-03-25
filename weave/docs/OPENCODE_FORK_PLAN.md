# OpenCode Fork Plan For Weave

> Concrete implementation plan for building Weave by forking OpenCode in the
> same general style Volt used: keep the product shell, replace the session and
> memory engine, add Weave-native tools and UI.

## 1. Goal

Build Weave as an OpenCode-derived terminal product with:

- OpenCode-style CLI, TUI, PTY, provider, permission, config, MCP, and SDK
- Weave-owned memory engine
- Weave-owned thread orchestration model
- Weave-owned episode model
- Weave-owned context control and retrieval tools

This is not a frontend/backend split plan. This is the "fork and replace the
engine inside the same monorepo" plan.

## 1.1 Planning Assumption

This document uses:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/...` for the upstream
  source of truth (adjust to your machine or clone)
- `/Users/anthonykim/projects/weave/references/volt/...` for the extension
  reference
- **`weave_opencode/`** at the `weave_mono` repository root as the intended
  `weave_opencode` once OpenCode is vendored (see [`weave_opencode/README.md`](../../weave_opencode/README.md))

`weave_opencode` in older paragraphs still means that directory. Replace any
stale absolute paths when copying this plan to a new machine.

## 2. Core Principle

Do not rewrite the whole app.

Use the Volt pattern:

1. keep the shell
2. add a new engine namespace
3. route session behavior through it
4. add tools that depend on it
5. expose its state in the UI

## 3. Non-Negotiable Weave Concepts

These must remain Weave-owned even in an OpenCode fork:

- immutable message store
- active context assembly
- hierarchical summary DAG
- threshold-triggered context control
- memory retrieval tools
- thread dispatch semantics
- scope-reduction invariant
- episode creation and composition

These are negotiable implementation details:

- BEAM processes
- GenServer APIs
- OTP supervision as the public mental model

## 4. Keep / Wrap / Replace

### Keep

These OpenCode areas should stay largely intact initially:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/index.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/provider/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/permission/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/config/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/mcp/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/plugin/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/pty/`
- the existing SDK generation flow

### Wrap

These should stay usable, but gain Weave-aware adapters:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/llm.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/prompt.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/registry.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/tool.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/status.ts`
- TUI session/task-tree state loaders
- server routes that expose session/message state

### Replace

These are where Weave should own semantics:

- session-memory lifecycle
- context-window assembly
- compaction strategy
- retrieval model
- child-session meaning for thread work
- completion artifact model

Practically, this means adding a new namespace under `src/session/weave/` and
gradually routing execution through it.

## 4.1 Review Notes

This plan has three design constraints that should be made explicit before
implementation starts:

1. The storage decision is architecture-shaping and must not remain implicit.
   Shared DB versus dedicated Weave store is a phase gate, not a sub-bullet.
2. Child sessions are the implementation substrate for threads, but thread
   semantics must remain stricter than generic task semantics.
3. Upstream-friendly structure matters. Weave logic should be namespaced rather
   than spread across unrelated upstream files early.

## 5. Proposed Namespace Layout

The smallest workable addition is:

```text
/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/
  index.ts
  types.ts
  db.ts
  runtime.ts
  context.ts
  summary.ts
  summarize.ts
  condense.ts
  retrieval.ts
  retrieval-facade.ts
  episode.ts
  scope.ts
  dispatch.ts
  thread.ts
  orchestrator.ts
  config.ts
  migration.ts
```

Companion tool files:

```text
/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/
  weave-grep.ts
  weave-describe.ts
  weave-expand.ts
  weave-expand-query.ts
  dispatch-thread.ts
  dispatch-threads.ts
```

Companion TUI files:

```text
/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/
  weave-thread-tree.tsx
  weave-episode-feed.tsx
  weave-dag.tsx
  weave-context-usage.tsx
```

## 6. Phase Plan

### Phase 0: Fork Setup And Identity

Purpose:
- establish a clean OpenCode fork
- preserve upstream structure
- avoid early refactors that make later merges impossible

Files to change:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/package.json`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/README.md`
- install scripts
- binary launcher scripts
- branding assets
- config path defaults

Files to leave alone:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/index.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/`

Deliverables:

- binary renamed to `weave`
- config directory renamed appropriately
- docs clearly state "OpenCode-derived shell, Weave engine incoming"
- add an auth compatibility note for Anthropic OAuth via Claude Code identity,
  using `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/CLAUDE.md` as the source of
  truth if Weave wants Claude OAuth in the forked shell

Exit criteria:

- project runs under the new name
- no behavior changes yet

### Phase 1: Inventory And Ownership Map

Purpose:
- find the exact OpenCode modules Weave must intercept
- define the first stable seam

Files to inspect and classify:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/index.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/prompt.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/llm.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/message.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/message-v2.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/status.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/task.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/tasks.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/registry.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/session.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/tui.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/*.tsx`

Artifacts to create:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/OPENCODE_FORK_PLAN.md`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/OPENCODE_KEEP_WRAP_REPLACE.md`

Contents of the matrix:

- file path
- current owner concept
- keep/wrap/replace status
- future Weave seam

Exit criteria:

- every session and task-related file is classified
- Weave insertion seam is agreed on before code changes

### Phase 2: Add Weave Engine Skeleton

Purpose:
- create a real namespace for Weave-owned engine logic
- avoid scattering Weave logic across unrelated upstream files

Files to add:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/index.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/types.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/runtime.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/context.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/db.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/config.ts`

Files to touch lightly:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/index.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/prompt.ts`

Responsibilities:

- `types.ts`
  - define `ExecutionRole`
  - define `Episode`
  - define `ThreadDispatch`
  - define `SummaryNode`
  - define `ContextSnapshot`

- `runtime.ts`
  - define the public orchestration hooks
  - no full compaction yet

- `context.ts`
  - define the assembly interface
  - allow placeholder implementation initially

- `db.ts`
  - define Weave store schema access API
  - decide whether it uses OpenCode storage or a dedicated DB layer

Exit criteria:

- Weave engine compiles
- no user-visible feature is broken
- session code can import Weave runtime hooks

### Phase 2.5: Architecture Decision Gate

Purpose:
- make the irreversible decisions before persistence and context work spreads

Decision record to write:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/OPENCODE_ARCHITECTURE_DECISIONS.md`

Required decisions:

- fork root absolute path
- shared storage vs dedicated Weave store
- Weave message ID ownership model
- whether Weave memory mirrors OpenCode messages or replaces them for prompt
  assembly
- canonical tool identifiers:
  - file name style such as `dispatch-thread.ts`
  - tool call name style such as `dispatch_thread`
- whether Anthropic support in the fork includes Claude Code OAuth
  impersonation requirements from
  `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/CLAUDE.md`, or remains API-key-only

Exit criteria:

- all five decisions are recorded
- later phases no longer contain open-ended storage or identity questions

### Phase 3: Introduce Weave-Owned Persistence

Purpose:
- create the canonical store for Weave memory semantics

Recommended strategy:

- keep OpenCode storage for app/session metadata
- add a Weave memory store for message lineage, summaries, episodes, file refs

Files to add or expand:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/db.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/migration.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/types.ts`

Possible supporting routes:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/session.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/file.ts`

Tables or storage domains to introduce:

- messages
- summaries
- summary-message links
- summary-parent links
- episodes
- file refs
- dispatch records

Questions to resolve in this phase:

- shared SQLite vs separate DB
- whether existing session messages are duplicated or adapted
- whether message IDs are OpenCode-native or Weave-owned

Exit criteria:

- Weave store is the source of truth for retrieval and summarization
- migrations run cleanly

### Phase 4: Shared Active Context Assembly

Purpose:
- implement the core LCM loop boundary before compaction details

Files to implement:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/context.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/runtime.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/config.ts`

Files to wrap:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/prompt.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/llm.ts`

Context assembly contract:

1. system prompt
2. summary nodes
3. recent raw messages
4. file references
5. optional thread seed episodes

Execution contexts that must use the same assembly path:

- root orchestrator session
- thread child session
- operator worker session

Exit criteria:

- a single function builds active context for all worker types
- prompt execution paths call through Weave context assembly

### Phase 5: Memory Tools First

Purpose:
- expose real user-visible Weave differentiation early

Files to add:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/weave-grep.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/weave-describe.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/weave-expand.ts`
- optional `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/weave-expand-query.ts`

Files to touch:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/registry.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/tool.ts`
- tool docs and prompt descriptions

Dependencies inside Weave engine:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/retrieval.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/retrieval-facade.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/summary.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/db.ts`

Design rules:

- retrieval hits Weave store, not ad hoc in-memory structures
- expansion permissions can vary by execution role
- output should include stable IDs that future tools and UI can target

Exit criteria:

- memory tools are callable from normal sessions
- tools return stable identifiers and structured metadata

### Phase 6: Child Sessions Become Threads

Purpose:
- reuse the existing session/task substrate to represent Weave threads

Files to add:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/thread.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/dispatch.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/scope.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/dispatch-thread.ts`

Files to wrap:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/task.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/tasks.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/index.ts`

Thread metadata to introduce:

- `threadID`
- `parentSessionID`
- `action`
- `delegated_scope`
- `kept_work`
- `role`
- `tool profile`
- `model override`

Rules:

- root session may dispatch freely
- thread sessions must satisfy the scope invariant
- read-only exploration threads may be exempt if desired

Exit criteria:

- `dispatch_thread` can create a typed child session
- child session metadata is queryable from the UI and store

### Phase 7: Episode Creation

Purpose:
- make thread completion produce a first-class Weave artifact

Files to add:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/episode.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/summary.ts`

Files to touch:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/index.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/status.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/session.ts`

Episode payload should include:

- thread ID
- action summary
- result status
- summary text
- key findings
- mutations
- source message IDs
- parent episode or summary refs if needed

Exit criteria:

- thread completion emits a durable episode
- orchestrator session can query episodes by thread or parent session

### Phase 8: Batch Dispatch And Operator Tools

Purpose:
- move concurrency into deterministic engine tools

Files to add:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/dispatch-threads.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/llm-map.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/agentic-map.ts`

Files to add inside engine:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/operator.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/worker-pool.ts`

Files to reuse heavily from Volt references:

- `/Users/anthonykim/projects/weave/references/volt/packages/voltcode/src/tool/llm-map.ts`
- `/Users/anthonykim/projects/weave/references/volt/packages/voltcode/src/tool/agentic-map.ts`
- `/Users/anthonykim/projects/weave/references/volt/packages/voltcode/src/tool/map-shared.ts`

Required behaviors:

- item-level tracking
- concurrency limits
- retries
- schema validation
- durable progress state
- operator outputs registered in Weave store

Exit criteria:

- operator tools work without the model writing loops
- per-item progress is visible to the UI

### Phase 9: Summary DAG And Compaction

Purpose:
- implement the real long-context engine

Files to add or complete:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/summary.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/summarize.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/condense.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/runtime.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/config.ts`

Likely supporting files:

- prompt templates for D0, D1, D2+
- migration files for summary tables

Required behaviors:

- soft and hard thresholds
- async compaction under soft limit pressure
- blocking convergence above hard threshold
- leaf summaries
- condensed summaries
- deterministic fallback

Must remain true:

- originals are never deleted
- summary IDs remain retrievable
- same logical loop applies across worker/session types

Exit criteria:

- long sessions compact and remain retrievable
- memory tools can traverse the DAG

### Phase 10: Weave TUI Surfaces

Purpose:
- expose the engine visually without replacing the whole frontend

Files to add:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/weave-thread-tree.tsx`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/weave-episode-feed.tsx`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/weave-dag.tsx`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/weave-context-usage.tsx`

Files to touch:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/cli/cmd/tui/context/route.tsx`
- existing session/task tree components

First visible surfaces:

- thread list/tree
- thread status
- episode feed
- context usage bar
- summary or DAG inspector

Defer initially:

- heavy editing interactions
- full DAG manipulation
- complex modal workflows

Exit criteria:

- users can see threads, episodes, and context state live

### Phase 11: Orchestrator Role

Purpose:
- make Weave behavior more than "task spawning with memory tools"

Files to add:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/orchestrator.ts`

Files to wrap:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/prompt.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/task.ts`
- any agent-role resolution files

Responsibilities:

- choose between direct answer and dispatch
- compose episodes into next actions
- restrict direct coding-tool use if desired
- route strategic work differently from tactical thread work

Important constraint:

- keep the first orchestrator simple
- do not solve the full strategic planning problem in this phase

Exit criteria:

- root session behaves differently from child threads
- thread weaving is visible in real sessions

### Phase 12: Cleanup, Hardening, And Upstream Strategy

Purpose:
- remove duplicate session semantics
- reduce architecture drift
- make future maintenance possible

Files likely to revisit:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/index.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/prompt.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/task.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/tasks.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/session.ts`
- TUI sync layers

Cleanup tasks:

- remove dead OpenCode session paths now superseded by Weave runtime
- tighten role and permission boundaries
- document public engine APIs
- decide whether upstream sync is still realistic

Exit criteria:

- Weave owns memory and orchestration semantics end to end
- the fork remains understandable to future maintainers

## 7. Cross-Cutting Concerns

### Event Model

Weave-specific events will be needed for:

- thread started
- thread updated
- thread completed
- episode created
- compaction started
- compaction finished
- summary expanded
- operator progress updated

Likely files:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/bus/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/status.ts`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/event.ts`
- TUI sync files

### Permissions

Weave-specific tools need explicit role-aware gating:

- orchestrator should not necessarily get coding tools
- thread sessions may get coding tools
- expand tools may be role-limited
- operator workers may be read-only

Likely files:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/permission/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/*.ts`
- prompt/tool descriptions

### Provider Auth

If Weave wants Claude/Anthropic OAuth in the fork, do not rely on OpenCode's
default Anthropic handling alone. Carry forward the Weave-specific compatibility
requirements documented in:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/CLAUDE.md`

That note should be treated as the implementation checklist for:

- OAuth headers and betas
- Claude Code identity system block formatting
- PascalCase tool-name mapping
- tool-result message formatting
- keeping streaming and non-streaming call paths in sync

### Prompting

New prompts will be needed for:

- orchestrator role
- thread role
- summary depth levels
- episode generation
- retrieval hints

Likely files:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/prompt/`
- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/prompts/`

### Server And SDK

Once Weave adds new concepts, the TUI and any remote client will need:

- thread listing
- episode listing
- DAG or summary inspection
- context usage queries

Likely files:

- `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/session.ts`
- new routes under `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/server/routes/`
- generated SDK files

## 8. Phase Dependencies

These dependencies should be treated as hard sequencing constraints:

- Phase 0 before all coding phases
- Phase 1 before Phase 2
- Phase 2 before Phase 2.5
- Phase 2.5 before Phase 3
- Phase 3 before Phases 4, 5, 7, and 9
- Phase 4 before Phases 6, 8, and 11
- Phase 6 before Phase 7
- Phase 7 before Phase 11
- Phase 8 before Phase 10 if the UI needs live operator progress
- Phase 9 before the final DAG-oriented TUI work in Phase 10

In practice:

- memory tools can begin once Phase 3 exists
- thread semantics should not ship before Phase 4 exists
- orchestration should not ship before episodes exist

## 9. Recommended First Four Deliverables

If this path is chosen, do these first:

1. create the keep/wrap/replace matrix
2. add `src/session/weave/` skeleton
3. add `weave_grep`, `weave_describe`, `weave_expand`
4. add `dispatch_thread` with child-session-backed threads and basic episode creation

This is the smallest sequence that starts feeling like Weave without forcing a
full runtime rewrite up front.

## 10. References To Reuse Directly

Use these references directly while implementing the fork path:

- OpenCode chassis:
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/OPENCODE_SUMMARY.md`
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/opencode_runtime.md`
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/opencode_stack.md`
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/opencode_reverse_engineering.md`
- Volt extension pattern:
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/VOLT_SUMMARY.md`
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/volt_runtime_and_operators.md`
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/volt_lcm_engine.md`
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/volt_stack.md`
- family lineage:
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/reference_lineage.md`
- Weave target architecture:
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/SPEC.md`
  - `/Users/anthonykim/projects/weave_mono/weave_opencode/weave/docs/SYNTHESIS.md`

## 11. What To Explicitly Avoid

- renaming or moving large upstream directories too early
- rewriting the TUI before the engine seam exists
- mixing Weave semantics into unrelated OpenCode files without a namespace
- implementing OTP-shaped abstractions in TypeScript just for aesthetic fidelity
- treating PTY and terminal emulation as part of the memory-engine migration

## 12. Success Criteria

This plan succeeds if, after the migration:

- Weave still has a polished CLI/TUI shell
- Weave memory semantics are no longer OpenCode defaults
- memory retrieval and compaction are Weave-native
- threads are real typed execution contexts, not just generic tasks
- episodes become first-class composition artifacts
- the codebase still has a clear upstream lineage and maintainable structure
NOTE: references/volt paths intentionally retained until local Volt reference path is decided.
