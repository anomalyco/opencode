# Feature: workflow-agents
> Created: 2026-06-26 | Status: DESIGN | Complexity: Complex

## Summary

Add a Dynamic Workflows feature to opencode, inspired by Claude Code's dynamic workflows. The orchestrator (or any primary agent) generates a JavaScript orchestration script that coordinates multiple subagents in parallel, with intermediate results held in script variables rather than LLM context. Workers are existing opencode subagent sessions spawned via the task tool infrastructure. Scripts are saved as reusable slash commands.

This solves three failure modes of long single-context agent work:
- **Agentic laziness** — stops after partial progress (e.g., 35 of 50 files)
- **Self-preferential bias** — agent verifies its own work with bias
- **Goal drift** — original constraints lost across compaction turns

## Design Decisions (Approved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Definition model | LLM-generated JavaScript script | Maximum flexibility; proven by Claude Code; supports all patterns (fan-out, loop, tournament, verify) |
| Sandbox strategy | Restricted globals (whitelist) | Simplest; uses Bun's native JS eval; blocks require/import/process |
| Concurrency model | Dedicated workflow executor | Keeps workflow concerns separate from background jobs |
| Scope | Runtime + save/reuse | Full feature parity with Claude Code's shipped experience |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Main Session (orchestrator/primary agent)            │
│  User: "audit all auth files"                        │
│  → Agent generates workflow.js (via workflow tool)   │
│  → User approves script (or auto-runs if saved)      │
│  → workflow tool executes script                     │
│  → Final report returned to agent context            │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Workflow Runtime (new: src/workflow/runtime.ts)      │
│  - Sandboxed JS execution (restricted globals)       │
│  - Exposes: agent(), parallel(), sleep()             │
│  - Guardrails: max 8 concurrent, 100 total/run       │
│  - 30min execution timeout (AbortController)         │
│  - State lives in script variables                   │
│  - Streams progress events to UI via bus             │
└──────┬──────────┬──────────┬────────────────────────┘
       │          │          │
       ▼          ▼          ▼
  ┌────────┐ ┌────────┐ ┌────────┐
  │Worker A│ │Worker B│ │Worker C│  ← Existing subagent
  │(explore)│ │(editor)│ │(debugger)│   sessions via spawnWorker()
  └────────┘ └────────┘ └────────┘
       │          │          │
       └──────────┴──────────┘
                   │
                   ▼
         Final report → Main Session (tool result)
```

### Key Insight

The orchestration plan moves OUT of the LLM context window and INTO deterministic code. The LLM writes the script once; the runtime executes it. Only the final synthesized result returns to the main conversation. This enables dozens-to-hundreds of agents without blowing the parent context window.

## Runtime API (Available Inside Workflow Scripts)

```typescript
// Spawn a single subagent worker. Returns when the worker completes.
declare function agent(params: {
  prompt: string              // Task description for the worker
  agent?: string              // Subagent type (default: "general")
  model?: string              // Override model (format: "provider/model")
}): Promise<AgentResult>

// Run a function over items in parallel with concurrency control.
declare function parallel<T>(
  items: T[],
  fn: (item: T) => Promise<AgentResult>,
  concurrency?: number        // default: 8, max: 8
): Promise<AgentResult[]>

// Sleep helper
declare function sleep(ms: number): Promise<void>

// Result type returned by agent()
interface AgentResult {
  text: string                // Worker's final text response
  ok: boolean                 // true if worker completed successfully
  sessionID: string            // Child session ID (for resume/debugging)
}

// Global available in saved workflows for parameterization
declare const args: string     // Arguments passed when invoking as slash command
```

### Example Workflow Script

```javascript
// .opencode/workflows/security-audit.js
// Invoke as: /security-audit src/auth

const targetDir = args || "src/"

// Phase 1: Fan out — find files to audit
const listResult = await agent({
  prompt: `List all TypeScript files in ${targetDir} that handle authentication or authorization. Return ONLY a JSON array of file paths, no other text.`,
  agent: "explore"
})

const files = JSON.parse(listResult.text)

// Phase 2: Parallel audit — one worker per file
const audits = await parallel(files, (file) =>
  agent({
    prompt: `Audit ${file} for security vulnerabilities. Check for: SQL injection, auth bypass, secrets in code, unsafe deserialization. Return findings as JSON: { file, severity, issues: [{ line, type, description }] }`,
    agent: "security-auditor"
  })
)

const allFindings = audits
  .filter(a => a.ok)
  .flatMap(a => JSON.parse(a.text))

// Phase 3: Adversarial verification — separate agent reviews findings
const verified = await agent({
  prompt: `Review these security findings for false positives and missing context. For each finding, mark as "confirmed", "false_positive", or "needs_review". Return JSON array.\n\nFindings:\n${JSON.stringify(allFindings)}`,
  agent: "debugger"
})

// Phase 4: Synthesize final report
const report = await agent({
  prompt: `Create a prioritized security report from these verified findings:\n${verified.text}\n\nFormat as markdown with sections: Critical, High, Medium, Low. Include file:line references.`,
  agent: "general"
})

return report.text
```

## Components

### New Files

| File | Purpose |
|------|---------|
| `packages/opencode/src/workflow/runtime.ts` | Sandboxed JS execution engine. Restricts globals, injects `agent()`/`parallel()`/`sleep()` helpers. Manages execution lifecycle. |
| `packages/opencode/src/workflow/executor.ts` | Dedicated workflow executor service. Manages concurrency pool (max 8), total agent counter (max 100), execution timeout (30min). Owns the `spawnWorker()` bridge to task.ts. |
| `packages/opencode/src/workflow/limits.ts` | Guardrail constants and enforcement logic. Configurable via opencode.jsonc. |
| `packages/opencode/src/workflow/events.ts` | Workflow progress event types (Spawn, Complete, Fail, Progress). Published to bus for UI. |
| `packages/opencode/src/workflow/index.ts` | Self-reexport module: `export * as Workflow from "."` |
| `packages/opencode/src/tool/workflow.ts` | The `workflow` tool definition. Orchestrator calls this with a script string. Handles save/reuse. |
| `packages/opencode/src/tool/workflow.txt` | Tool description text (loaded via `import DESCRIPTION from "./workflow.txt"`) |
| `packages/opencode/src/config/workflow.ts` | Workflow config schema (disable flag, concurrency limits, timeout). Loaded from `opencode.jsonc` `workflow` section. |
| `packages/opencode/test/workflow/runtime.test.ts` | Runtime tests: sandbox restrictions, helper functions, guardrails |
| `packages/opencode/test/workflow/executor.test.ts` | Executor tests: concurrency, limits, timeout, worker spawning |

### Modified Files

| File | Change |
|------|--------|
| `packages/opencode/src/tool/task.ts` | Extract `spawnWorker()` internal function from `TaskTool.execute()`. The workflow executor calls this to spawn workers. Logic stays the same — just extracted from the tool execute method into a reusable function. The tool itself calls `spawnWorker()` too. |
| `packages/opencode/src/tool/registry.ts` | Register the `workflow` tool. Add `WorkflowTool` to imports, init, and builtin list. |
| `packages/opencode/src/config/config.ts` | Add `ConfigWorkflow` to config loading (follow existing `ConfigAgent`/`ConfigSkills` pattern). Add `export * as ConfigWorkflow from "./workflow"` self-reexport. |
| `packages/opencode/src/session/prompt.ts` | Pass `spawnWorker` function via `ctx.extra` so the workflow tool can access it (same pattern as existing `promptOps`). |

### Self-Reexport Pattern (per AGENTS.md)

```typescript
// packages/opencode/src/workflow/index.ts
export class Service extends Context.Service<Service, Interface>()("@opencode/Workflow") {}
export const layer = Layer.effect(Service, ...)

export * as Workflow from "."
```

```typescript
// packages/opencode/src/config/workflow.ts
export const WorkflowSchema = Schema.Struct({
  disable: Schema.optional(Schema.Boolean),
  max_concurrency: Schema.optional(PositiveInt),
  max_agents: Schema.optional(PositiveInt),
  timeout_ms: Schema.optional(PositiveInt),
})

export const defaults = {
  max_concurrency: 8,
  max_agents: 100,
  timeout_ms: 30 * 60 * 1000,
}

export * as ConfigWorkflow from "./workflow"
```

## Sandbox Design

### Restricted Globals (Whitelist)

The runtime executes scripts with ONLY these globals available:

| Allowed | Blocked |
|---------|---------|
| `agent`, `parallel`, `sleep`, `args` (injected helpers) | `require`, `import`, `process` |
| `JSON`, `Math`, `Array`, `Object`, `String`, `Number`, `Boolean` | `global`, `globalThis` (replaced) |
| `Date`, `RegExp`, `Map`, `Set`, `Promise`, `Error` | `child_process`, `fs`, `os`, `path` |
| `parseInt`, `parseFloat`, `isNaN`, `isFinite` | `eval`, `Function` constructor |
| `console.log` (for debugging, captured) | `setTimeout`, `setInterval` (use `sleep()`) |
| `return` (script returns a value) | `fetch`, `XMLHttpRequest` |

### Implementation Approach

Use Bun's native JavaScript evaluation with a restricted scope. The script is wrapped in an async function whose parameters are the injected helpers:

```typescript
// Conceptual — actual implementation in runtime.ts
const wrappedScript = `
return (async (agent, parallel, sleep, args, JSON, Math, Array, Object, String, Number, Boolean, Date, RegExp, Map, Set, Promise, Error, parseInt, parseFloat, isNaN, isFinite, console) => {
  ${userScript}
  return undefined
})
`

const fn = new Function(wrappedScript)()
const result = await fn(agent, parallel, sleep, args, JSON, Math, /* ... */)
```

The `new Function()` approach shadows global names via parameter binding — even if the script tries `globalThis.fs`, the `globalThis` is the runtime's own, and `fs` is not on the restricted scope.

### Script Validation (Pre-Execution)

Before execution, validate the script source:
1. Reject if contains `require(` or `import ` or `process.` or `globalThis`
2. Reject if contains `eval(` or `new Function(`
3. Reject if contains `child_process` or `__dirname` or `__filename`
4. These are defense-in-depth — the sandbox already blocks these, but catching early gives better error messages

## Worker Bridge (spawnWorker)

The workflow executor needs to spawn subagent sessions. Rather than duplicating logic, extract it from `task.ts`:

### Current state (task.ts)

`TaskTool.execute()` does:
1. Permission check
2. `agent.get(subagent_type)` → get agent Info
3. `sessions.create({ parentID, permission: derived })`
4. `ops.resolvePromptParts(prompt)` → resolve @file references
5. `ops.prompt({ sessionID, agent, tools, parts })` → run session loop
6. Extract last text part → return

### Refactored

Extract steps 2-6 into `spawnWorker()`:

```typescript
// packages/opencode/src/tool/task.ts (refactored)

export interface SpawnWorkerInput {
  subagentType: string
  prompt: string
  parentSessionID: SessionID
  parentAgent: Agent.Info | undefined
  model?: { modelID: ModelID; providerID: ProviderID }
  ops: TaskPromptOps
  ctx: Pick<Tool.Context, "abort" | "ask" | "metadata" | "extra">
}

export interface SpawnWorkerResult {
  text: string
  sessionID: SessionID
}

export const spawnWorker = Effect.fn("TaskTool.spawnWorker")(function* (input: SpawnWorkerInput) {
  const agent = yield* Agent.Service
  const sessions = yield* Session.Service
  const config = yield* Config.Service

  const next = yield* agent.get(input.subagentType)
  if (!next) return yield* Effect.fail(new Error(`Unknown agent: ${input.subagentType}`))

  const parent = yield* sessions.get(input.parentSessionID)
  const session = yield* sessions.create({
    parentID: input.parentSessionID,
    title: `workflow worker (@${next.name})`,
    permission: deriveSubagentSessionPermission({
      parentSessionPermission: parent.permission ?? [],
      parentAgent: input.parentAgent,
      subagent: next,
    }),
  })

  const parts = yield* input.ops.resolvePromptParts(input.prompt)
  const result = yield* input.ops.prompt({
    messageID: MessageID.ascending(),
    sessionID: session.id,
    model: input.model ?? { modelID: parent.modelID, providerID: parent.providerID },
    agent: next.name,
    tools: {
      ...(next.permission.some(r => r.permission === "todowrite") ? {} : { todowrite: false }),
      ...(next.permission.some(r => r.permission === "task") ? {} : { task: false }),
    },
    parts,
  })

  return {
    text: result.parts.findLast(p => p.type === "text")?.text ?? "",
    sessionID: session.id,
  }
})
```

The existing `TaskTool.execute()` calls `spawnWorker()` internally — no behavior change.

## Workflow Tool

```typescript
// packages/opencode/src/tool/workflow.ts

const Parameters = Schema.Struct({
  script: Schema.String.annotate({
    description: "JavaScript workflow script. Use agent(), parallel(), sleep() to orchestrate subagents. Return a string as the final result."
  }),
  save: Schema.optional(Schema.String).annotate({
    description: "Save this workflow with the given name for reuse as a slash command. Saved to .opencode/workflows/<name>.js"
  }),
  args: Schema.optional(Schema.String).annotate({
    description: "Arguments to pass to the workflow (available as `args` global in script)"
  }),
})
```

### Execution Flow

1. Orchestrator decides a workflow is needed (detected via prompt complexity or explicit request)
2. Orchestrator generates a JS script and calls `workflow` tool with `{ script, save?, args? }`
3. `workflow.execute()`:
   a. Validate script (no require/import/process/globalThis/eval/Function)
   b. If `save` provided: write to `.opencode/workflows/<save>.js` (or `~/.config/opencode/workflows/`)
   c. Create execution context with restricted globals
   d. Inject `agent()`, `parallel()`, `sleep()` helpers (backed by executor)
   e. Execute script with 30min timeout
   f. Each `agent()` call → executor spawns worker via `spawnWorker()`
   g. `parallel()` → batches with concurrency limit
   h. Stream `Workflow.Event.Spawn/Complete/Fail/Progress` events to bus
   i. Return final result string to orchestrator
4. Orchestrator presents result to user

## Config

```jsonc
// opencode.jsonc
{
  "workflow": {
    "disable": false,
    "max_concurrency": 8,
    "max_agents": 100,
    "timeout_ms": 1800000
  }
}
```

### Disable Switches

- `workflow.disable: true` in config → tool not registered
- `OPENCODE_DISABLE_WORKFLOWS=1` env var → same effect
- Runtime flag: `experimentalWorkflows` (gated behind flag initially)

## Save & Reuse

### Storage Locations

| Location | Scope | Git-shareable |
|----------|-------|---------------|
| `.opencode/workflows/<name>.js` | Project | ✅ Yes |
| `~/.config/opencode/workflows/<name>.js` | User | No |

### Slash Command Integration

Saved workflows become invocable as `/<name> <args>`. The existing command system in `src/config/command.ts` handles slash commands. Workflow files are loaded alongside existing command discovery.

### File Format

Workflow JS files are pure scripts — no frontmatter. The filename is the command name. Example:

```
.opencode/workflows/
  security-audit.js
  migrate-fetch.js
  deep-research.js
```

## Guardrails

| Guardrail | Default | Configurable | Enforcement |
|-----------|---------|--------------|-------------|
| Max concurrent workers | 8 | `workflow.max_concurrency` | `parallel()` batches automatically; `agent()` checks active count |
| Max workers per run | 100 | `workflow.max_agents` | Executor counter, throws `WorkflowLimitError` on exceed |
| Execution timeout | 30 min | `workflow.timeout_ms` | `AbortController` on parent scope |
| FS/shell from script | ❌ Blocked | No | Restricted sandbox globals + source validation |
| Worker permissions | Inherited from parent session | No | Existing `deriveSubagentSessionPermission()` |
| Cost tracking | Per-worker | No | Existing processor token tracking |
| Nesting depth | 1 level (workers cannot spawn workflows) | No | `workflow` tool not registered for subagent sessions |

## Events

```typescript
// packages/opencode/src/workflow/events.ts

export namespace Workflow {
  export namespace Event {
    export const Spawn = Schema.Struct({
      type: Schema.Literal("Workflow.Spawn"),
      workerIndex: Schema.Number,
      agent: Schema.String,
      prompt: Schema.String,
    })
    export const Complete = Schema.Struct({
      type: Schema.Literal("Workflow.Complete"),
      workerIndex: Schema.Number,
      sessionID: Schema.String,
      ok: Schema.Boolean,
    })
    export const Fail = Schema.Struct({
      type: Schema.Literal("Workflow.Fail"),
      workerIndex: Schema.Number,
      error: Schema.String,
    })
    export const Progress = Schema.Struct({
      type: Schema.Literal("Workflow.Progress"),
      completed: Schema.Number,
      total: Schema.Number,
      active: Schema.Number,
    })
  }
}
```

Events published to the existing `Bus` service. TUI/SSE can subscribe for progress UI.

## Task Breakdown

### TASK-1: Extract spawnWorker from task.ts
- Status: completed
- Depends on: none
- Files: `packages/opencode/src/tool/task.ts`
- Acceptance:
  - `spawnWorker(input: SpawnWorkerInput)` exported function exists
  - `TaskTool.execute()` calls `spawnWorker()` internally — no behavior change
  - All existing task tool tests pass
  - `spawnWorker` uses `Effect.fn("TaskTool.spawnWorker")` for tracing
  - Returns `{ text, sessionID }` — text is last text part from result
- Checkpoint: Done. Exported `spawnWorker`, `SpawnWorkerInput`, `SpawnWorkerResult` and refactored `TaskTool.execute()` to call it. Added optional `sessionID` to `SpawnWorkerInput` to preserve `task_id` resume semantics. Added `workerPermission` helper to share permission derivation. `bun typecheck` passes and all 15 task tool tests pass.

### TASK-2: Workflow config module
- Status: pending
- Depends on: none (parallel with TASK-1)
- Files: `packages/opencode/src/config/workflow.ts`, `packages/opencode/src/config/config.ts`
- Acceptance:
  - `ConfigWorkflow.WorkflowSchema` exists with `disable`, `max_concurrency`, `max_agents`, `timeout_ms` fields (all optional)
  - `ConfigWorkflow.defaults` object with default values (8, 100, 1800000)
  - Self-reexport pattern: `export * as ConfigWorkflow from "./workflow"`
  - `config.ts` imports and merges `ConfigWorkflow` (follow `ConfigSkills` pattern exactly)
  - Config loads from `opencode.jsonc` `workflow` section
  - Existing config tests pass
- Checkpoint: (not started)

### TASK-3: Workflow limits and events
- Status: pending
- Depends on: TASK-2
- Files: `packages/opencode/src/workflow/limits.ts`, `packages/opencode/src/workflow/events.ts`
- Acceptance:
  - `Limits` object with `maxConcurrency`, `maxAgents`, `timeoutMs` — read from config with defaults
  - `WorkflowLimitError` tagged error class (extends `Schema.TaggedErrorClass`)
  - Event schemas: `Spawn`, `Complete`, `Fail`, `Progress` with correct fields
  - Events use `Schema.Struct` + `Schema.Literal` pattern
- Checkpoint: (not started)

### TASK-4: Workflow executor service
- Status: pending
- Depends on: TASK-1, TASK-3
- Files: `packages/opencode/src/workflow/executor.ts`, `packages/opencode/src/workflow/index.ts`
- Acceptance:
  - `Workflow.Service` extends `Context.Service` with `@opencode/Workflow` tag
  - `execute(input: { script, args?, parentSessionID, parentAgent, ops, ctx })` method
  - Concurrency pool: max 8 concurrent workers (configurable)
  - Total agent counter: throws `WorkflowLimitError` at 100 (configurable)
  - 30min execution timeout via `Effect.timeout` or `AbortController`
  - `agent()` helper: calls `spawnWorker()` from task.ts, returns `Promise<AgentResult>`
  - `parallel()` helper: batches items with concurrency limit
  - `sleep()` helper: `Effect.sleep` wrapper
  - Streams `Workflow.Event.*` events to `Bus`
  - Self-reexport: `export * as Workflow from "."`
  - Follows Effect service pattern from AGENTS.md
- Checkpoint: (not started)

### TASK-5: Workflow runtime (sandbox)
- Status: pending
- Depends on: TASK-4
- Files: `packages/opencode/src/workflow/runtime.ts`
- Acceptance:
  - `executeScript(script, helpers)` function — takes JS source + helper functions, returns result
  - Restricted globals: only whitelist available (JSON, Math, Array, Object, etc.)
  - `require`, `import`, `process`, `globalThis`, `eval`, `Function`, `fetch` all blocked
  - Source validation: rejects scripts containing `require(`, `import `, `process.`, `globalThis`, `eval(`, `new Function(`, `child_process`, `__dirname`, `__filename`
  - Script wrapped in async function with helpers as parameters
  - Returns the script's return value (or `undefined` if no return)
  - Errors from script execution are caught and returned as `WorkflowRuntimeError`
- Checkpoint: (not started)

### TASK-6: Workflow tool definition
- Status: pending
- Depends on: TASK-5
- Files: `packages/opencode/src/tool/workflow.ts`, `packages/opencode/src/tool/workflow.txt`
- Acceptance:
  - `WorkflowTool` defined via `Tool.define("workflow", ...)`
  - Parameters: `script` (string, required), `save` (string, optional), `args` (string, optional)
  - Execute: validates script → saves if `save` provided → calls `Workflow.Service.execute()` → returns result string
  - `ctx.extra.promptOps` used to pass ops to executor (same as task tool)
  - Tool description explains: when to use, available helpers, return value expectation
  - Registered behind `experimentalWorkflows` runtime flag
- Checkpoint: (not started)

### TASK-7: Register workflow tool + wire config
- Status: pending
- Depends on: TASK-6
- Files: `packages/opencode/src/tool/registry.ts`, `packages/opencode/src/effect/runtime-flags.ts`
- Acceptance:
  - `WorkflowTool` imported and initialized in registry.ts
  - Added to builtin list (conditional on `experimentalWorkflows` flag)
  - `experimentalWorkflows` flag added to `RuntimeFlags`
  - `OPENCODE_DISABLE_WORKFLOWS=1` env var disables registration
  - Registry layer dependencies include `Workflow.Service`
  - All existing registry tests pass
- Checkpoint: (not started)

### TASK-8: Save/reuse as slash commands
- Status: pending
- Depends on: TASK-7
- Files: `packages/opencode/src/config/command.ts`, `packages/opencode/src/workflow/discovery.ts`
- Acceptance:
  - `.opencode/workflows/*.js` files discovered and registered as slash commands
  - `~/.config/opencode/workflows/*.js` also discovered (user-scoped)
  - `/<name> <args>` invokes workflow with args passed as `args` global
  - `save` parameter in workflow tool writes file to correct location
  - Slash command list includes workflows
- Checkpoint: (not started)

### TASK-9: Tests
- Status: pending
- Depends on: TASK-7
- Files: `packages/opencode/test/workflow/runtime.test.ts`, `packages/opencode/test/workflow/executor.test.ts`
- Acceptance:
  - Runtime tests: sandbox blocks `require`, `process`, `globalThis`, `eval`, `Function`
  - Runtime tests: helpers (`agent`, `parallel`, `sleep`) work correctly
  - Runtime tests: script return value captured
  - Runtime tests: script errors caught as `WorkflowRuntimeError`
  - Executor tests: concurrency limit enforced (8 parallel max)
  - Executor tests: total agent limit throws `WorkflowLimitError` at 100
  - Executor tests: timeout fires after configured duration
  - Executor tests: events published to bus
  - Tests run from `packages/opencode` (not repo root — guard in AGENTS.md)
- Checkpoint: (not started)

## Dependency Graph

```
TASK-1 (spawnWorker extract) ──────────┐
                                        ├──► TASK-4 (executor) ──► TASK-5 (runtime) ──► TASK-6 (tool) ──► TASK-7 (register) ──► TASK-8 (slash cmds)
TASK-2 (config) ──► TASK-3 (limits/events) ┘                                                        ──► TASK-9 (tests)
```

### Batches

| Batch | Tasks | Parallel? |
|-------|-------|-----------|
| 1 | TASK-1, TASK-2 | ✅ Independent |
| 2 | TASK-3 | Sequential (needs TASK-2) |
| 3 | TASK-4 | Sequential (needs TASK-1, TASK-3) |
| 4 | TASK-5 | Sequential (needs TASK-4) |
| 5 | TASK-6 | Sequential (needs TASK-5) |
| 6 | TASK-7 | Sequential (needs TASK-6) |
| 7 | TASK-8, TASK-9 | ✅ Independent (both need TASK-7) |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Sandbox escape via unexpected global | Medium | High | Defense-in-depth: source validation + restricted scope. Security-auditor review on TASK-5. |
| `spawnWorker` extraction breaks existing task tool | Low | High | TASK-1 is pure refactor — no logic change. Debugger runs full task tool test suite. |
| LLM generates invalid workflow scripts | High | Medium | Tool description includes clear API docs + examples. Runtime gives clear error messages. |
| Permission bypass via workflow-spawned workers | Medium | High | Workers inherit parent session permissions via existing `deriveSubagentSessionPermission()`. No change to permission model. |
| Context window overflow from large fan-out results | Medium | Medium | Runtime holds results in JS variables, not LLM context. Only final return value enters main context. |
| Cost runaway on large workflows | Medium | High | `max_agents` cap (100). Per-run cost tracked. Future: cost budget config. |

## Security Review Points

| Task | Security Concern | Review Action |
|------|-----------------|---------------|
| TASK-5 (runtime) | Sandbox escape | Spawn `security-auditor` after implementation |
| TASK-4 (executor) | Permission inheritance | Verify `deriveSubagentSessionPermission()` applied correctly |
| TASK-6 (tool) | Script injection via args | Validate args are string-only |

## Out of Scope (Future)

- Workflow UI in TUI (progress visualization) — follow-up feature
- Workflow persistence/resume across sessions — follow-up
- Cost budget per workflow — follow-up
- Workflow composition (workflow calling workflow) — explicitly blocked (nesting depth 1)
- Tournament pattern built-in — expressible via script, no special API needed
- Bundled `/deep-research` workflow — follow-up after core is stable

## References

- Claude Code Dynamic Workflows docs: https://code.claude.com/docs/en/workflows.md
- Claude Code Subagents docs: https://code.claude.com/docs/en/sub-agents.md
- Anthropic blog "A harness for every task": https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code
- Released v2.1.154+ (May 25-29 2026) as research preview
