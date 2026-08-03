# OpenCode Architecture & Bug-Fix Workflow

A walkthrough of how OpenCode processes a user prompt end-to-end, using a bug-fix scenario
("paste a test failure → fix the code") as concrete example.

---

## Table of Contents

1. [Repo Layout](#repo-layout)
2. [Entry Points](#entry-points)
3. [The Full Prompt Pipeline](#the-full-prompt-pipeline)
   - [CLI → Runtime](#cli--runtime)
   - [Prompt Queue](#prompt-queue)
   - [Stream Transport (SDK Event Bridge)](#stream-transport-sdk-event-bridge)
4. [Server-Side Session Handling](#server-side-session-handling)
   - [HTTP Handler](#http-handler)
   - [Session Execution & Run Coordinator](#session-execution--run-coordinator)
5. [The Agent Loop (Session Runner)](#the-agent-loop-session-runner)
   - [Run Orchestration](#run-orchestration)
   - [One Provider Turn](#one-provider-turn)
   - [Tool Settlement & Continuation](#tool-settlement--continuation)
6. [System Context Assembly](#system-context-assembly)
7. [Tool System](#tool-system)
8. [Event Streaming → TUI](#event-streaming--tui)
9. [Bug-Fix Walkthrough](#bug-fix-walkthrough)
10. [Key File Index](#key-file-index)

---

## Repo Layout

```
opencode/                          (Bun monorepo, turbo workspaces)
├── packages/
│   ├── opencode/src/              CLI entry, TUI, server, session loop, tools
│   │   ├── index.ts               yargs CLI root
│   │   ├── cli/cmd/run/           Interactive runtime (queue, transport, footer)
│   │   ├── cli/tui/               Terminal UI worker
│   │   ├── server/                HTTP API server
│   │   ├── session/               Session orchestration (prompt loop, processor, tools)
│   │   ├── agent/                 Agent definitions (build/plan/explore/general)
│   │   ├── tool/                  Tool implementations (read/edit/write/bash/grep/...)
│   │   └── config/                Config loading (opencode.json)
│   ├── core/src/                  Shared domain layer (v2 session store, runner)
│   │   ├── session/               SessionV2, SessionRunner, SessionStore
│   │   ├── tool/                  Tool registry, tool primitives
│   │   └── system-context/        Composable system prompt sources
│   ├── llm/src/                   LLM abstraction (providers, routes, events)
│   ├── tui/src/                   Terminal UI (SolidJS)
│   ├── sdk/js/src/                Client SDK (HTTP → generated typed client)
│   ├── server/src/                Shared server handlers
│   └── protocol/src/              API protocol schemas
└── specs/v2/                      Design specs
```

---

## Entry Points

### 1. `opencode` (default interactive mode)

```
packages/opencode/src/index.ts:33          ← yargs CLI root
  ↓ $0 [project]
packages/opencode/src/cli/cmd/tui.ts       ← spawns TUI Worker
  ↓ Worker
packages/opencode/src/cli/tui/worker.ts    ← boots in-process HTTP server + bridges events to SolidJS TUI
  ↓
packages/tui/src/index.tsx                 ← terminal UI renders prompts, diffs, tool output
```

### 2. `opencode run "message"` / `--mini`

```
packages/opencode/src/index.ts:81          ← RunCommand registered
  ↓
packages/opencode/src/cli/cmd/run.ts       ← creates/resumes session, streams results
  ↓ --mini
packages/opencode/src/cli/cmd/run/runtime.ts   ← runInteractiveLocalMode / runInteractiveMode
```

### 3. Server mode

```
packages/opencode/src/server/server.ts     ← Effect HttpApi + Node HTTP
  ↓ routes
packages/opencode/src/server/routes/instance/httpapi/
```

---

## The Full Prompt Pipeline

### CLI → Runtime

```
packages/opencode/src/cli/cmd/run/runtime.ts:181   runInteractiveRuntime()
```

This is the top-level orchestrator. It:

1. **Boots** — resolves TUI config, model info, session history in parallel
2. **Creates lifecycle** — renderer + footer (TUI split pane)
3. **Starts stream transport** — subscribes to SDK events (lazily for fresh sessions)
4. **Runs prompt queue** — drains user inputs until the footer closes

The two entry points are:
- `runInteractiveMode()` — SDK client already exists (attach mode)
- `runInteractiveLocalMode()` — local in-process mode (creates SDK client backed by in-process HTTP)

### Prompt Queue

```
packages/opencode/src/cli/cmd/run/runtime.queue.ts:59   runPromptQueue()
```

- Subscribes to footer prompt events (user types → hits enter)
- Serializes one prompt at a time
- Ordinary prompts submitted during an active turn are queued and shown for edit/removal
- `/exit`, `/quit` → close footer; `/new` → create new session
- Each turn gets an `AbortController` tied to the interrupt signal

```typescript
// Simplified queue loop
const submit = (prompt) => {
  state.queue.push(prompt)
  drain()  // processes queue sequentially
}

const drain = async () => {
  while (state.queue.length > 0) {
    const prompt = state.queue.shift()
    state.active = sent
    await input.run(sent, ctrl.signal)   // ← calls stream transport
    state.active = undefined
  }
}
```

### Stream Transport (SDK Event Bridge)

```
packages/opencode/src/cli/cmd/run/stream.transport.ts:1452   createSessionTransport()
```

Creates a long-lived **global event subscription** (`sdk.global.event()`) and wires it through reducers into the footer.

**Bootstrap** (line 676):
1. Fetches existing session messages, permissions, questions, and child sessions from the server
2. If replay mode, renders prior scrollback into the footer
3. Seeds blocker tracking for any pending permissions/questions

**Background event loop** (line 1127, `watch`):
- Consumes every SDK event from the stream
- Filters to the current session tree (parent + subagent children)
- Runs events through `reduceSessionData()` → produces scrollback commits + footer patches
- Buffers events during bootstrap/replay, then drains

**Prompt turn** (line 1187, `runPromptTurn`):
1. Creates a `Wait` deferred — resolves when session goes idle
2. Arms a 250ms polling fallback (in case status events are missed)
3. Sends the prompt via ONE of:
   - `sdk.session.promptAsync(req)` — normal text prompt
   - `sdk.session.shell(...)` — shell mode (`!command`)
   - `sdk.session.command(...)` — slash command
4. Waits for the turn to complete (idle event or abort)

```typescript
// Simplified send
const send = next.prompt.mode === "shell"
  ? sdk.session.shell({ sessionID, agent, model, command })
  : next.prompt.command
    ? sdk.session.command({ sessionID, agent, model, command, arguments })
    : sdk.session.promptAsync({ sessionID, messageID, agent, model, parts })
```

---

## Server-Side Session Handling

### HTTP Handler

```
packages/server/src/handlers/session.ts  (shared server)
  ↓ then routed to
packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts
```

Key endpoints:
| Endpoint | Handler | What it does |
|---|---|---|
| `session.create` | `session.create()` | Creates a new session with agent, model, location |
| `session.prompt` | `session.prompt()` | Queues a user message for processing |
| `session.shell` | `session.shell()` | Runs a shell command in session context |
| `session.command` | `session.command()` | Runs a slash command |
| `session.abort` | `session.interrupt()` | Interrupts active processing |
| `session.events` | `session.events()` | SSE stream of session events |
| `session.history` | `session.history()` | Paginated message history |
| `session.compact` | `session.compact()` | Triggers context compaction |

### Session Execution & Run Coordinator

```
packages/core/src/session/execution/local.ts:11
```

The `SessionExecution` service routes from a session ID to the runner owned by that session's Location (directory).

```
SessionExecutionLocal.layer
  ↓ uses
SessionRunCoordinator<SessionID, RunError>  (packages/core/src/session/run-coordinator.ts:24)
```

The **run coordinator** serializes execution per session while allowing different sessions to run concurrently:

```typescript
// Each session key gets one active drain at a time
// Explicit runs (resume) force a drain; wakes coalesce into one pending follow-up
// Interrupts stop the active fiber

const settle = (key, entry, exit) => {
  if (success && !stopping && entry.pendingWake) {
    start(key, entry, false, true)   // immediate successor with pending work
  } else if (entry.pendingWake) {
    const successor = makeEntry()     // fresh entry runs next
    active.set(key, successor)
    start(key, successor, false, true)
  } else {
    active.delete(key)                // done — nothing pending
  }
}
```

---

## The Agent Loop (Session Runner)

```
packages/core/src/session/runner/llm.ts:93   ← THE CORE
```

This is the implementation of `SessionRunner.Service`. It runs one durable coding-agent session until it settles.

### Run Orchestration

```typescript
// packages/core/src/session/runner/llm.ts:383
const run = (input: { sessionID, force }) => {
  // Check for pending steering input or queued prompts
  const hasSteer = SessionInput.hasPending(sessionID, "steer")
  const hasQueue = hasSteer ? false : SessionInput.hasPending(sessionID, "queue")
  if (!force && !hasSteer && !hasQueue) return

  // Fail any interrupted tools left from a prior run
  failInterruptedTools(sessionID)

  let promotion = hasSteer ? "steer" : hasQueue ? "queue" : undefined
  let shouldRun = force || hasSteer || hasQueue

  while (shouldRun) {                      // ← outer: process queued inputs
    let needsContinuation = true
    let step = 1
    while (needsContinuation) {            // ← inner: tool → continue loop
      const result = runTurn(sessionID, promotion, step)
      needsContinuation = result.needsContinuation
      step = result.step + 1
      promotion = "steer"
      // Check for user steering that arrived during the turn
      if (!needsContinuation)
        needsContinuation = SessionInput.hasPending(sessionID, "steer")
    }
    shouldRun = SessionInput.hasPending(sessionID, "queue")
    promotion = shouldRun ? "queue" : undefined
  }
}
```

### One Provider Turn

```typescript
// packages/core/src/session/runner/llm.ts:173
const runTurnAttempt = (sessionID, promotion, step, recoverOverflow?) => {
  // 1. Load session, verify location match
  const session = getSession(sessionID)

  // 2. Load agent config
  const agent = agents.select(session.agent)

  // 3. Initialize system context (or reconcile if already running)
  const system = SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
  //    ^ This loads: environment, date, skill guidance, reference guidance,
  //      system prompt, agent prompt, and opens a context epoch

  // 4. Resolve model (provider + model ID + auth)
  const model = models.resolve(session)

  // 5. Load message history from the context epoch's baseline
  const entries = SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
  const context = entries.map(e => e.message)

  // 6. Materialize tools (per agent permissions)
  const toolMaterialization = tools.materialize(agent.info?.permissions)
  //    ^ Returns { definitions: ToolDefinition[], settle: (call) => Settlement }

  // 7. Build the LLM request
  const request = LLM.request({
    model,
    system: [agent.info?.system, system.baseline].filter(Boolean).map(SystemPart.make),
    messages: [
      ...toLLMMessages(context, model),
      ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : []),
    ],
    tools: toolMaterialization?.definitions ?? [],
    toolChoice: isLastStep ? "none" : undefined,
  })

  // 8. Compaction check — if context is overflowing, compact and restart
  if (compaction.compactIfNeeded({ sessionID, entries, model, request }))
    throw continueAfterCompaction(currentStep)

  // 9. Stream from LLM provider
  const providerStream = llm.stream(request).pipe(
    Stream.runForEach((event) => {
      // Publish text deltas, reasoning, usage
      publish(event)

      // On tool-call: settle immediately
      if (event.type === "tool-call" && !event.providerExecuted) {
        toolMaterialization.settle({
          sessionID, agent: agent.id,
          assistantMessageID, call: event,
        })
        // ^ Executes tool, publishes result back as event
      }
    })
  )

  // 10. Handle completion: capture snapshot, publish step-end event
  // 11. Return { needsContinuation: true } if tools were called
}
```

### Tool Settlement & Continuation

When the LLM calls a tool:

1. **Tool call published** → `SessionEvent.Tool.Called` event stored durably
2. **Tool executed** via `toolMaterialization.settle()`:
   - Permission check against agent ruleset
   - Tool runs with `{ sessionID, agent, assistantMessageID, toolCallID }` context
   - Output bound to `ToolOutputStore` (large outputs truncated to files)
3. **Result published** → `LLMEvent.toolResult()` → fed back as a tool-result message
4. **All tools run concurrently** via `FiberSet`
5. **On next loop iteration**: reloaded history includes the assistant message with tool calls + tool result messages → model decides next action

---

## System Context Assembly

```
packages/core/src/system-context/index.ts
packages/core/src/system-context/builtins.ts
packages/core/src/system-context/registry.ts
```

System context is a composable, typed system for building the system prompt. Each source is independently refreshable:

```typescript
// Each source has: key, codec, load, baseline, update, removed
const environmentSource = SystemContext.make({
  key: "core/environment",
  codec: Schema.String,
  load: Effect.succeed(`<env>Working directory: ${dir}\nPlatform: ${platform}\n...</env>`),
  baseline: (env) => `Here is some useful information about the environment:\n${env}`,
  update: (prev, env) => `The environment is now:\n${env}`,
})
```

**Built-in sources** (`builtins.ts`):
- `core/environment` — working directory, workspace root, git status, platform
- `core/date` — today's date

Additional sources are registered by plugins, skills, references, and agent prompts.

**Context epochs** (`context-epoch.ts`) manage the lifecycle:
- **Initialize** — first run: load all sources, generate baseline, snapshot values
- **Reconcile** — subsequent turns: detect changes, produce minimal update text
- **Replace** — full context rebuild (e.g., after compaction)

---

## Tool System

```
packages/core/src/tool/registry.ts       ← ToolRegistry
packages/core/src/tool/tool.ts           ← Tool primitives (make, define, settle)
packages/opencode/src/tool/              ← Tool implementations
```

### Available Tools

| Tool | File | Description |
|---|---|---|
| `read` | `tool/read.ts` | Read files with line numbers |
| `write` | `tool/write.ts` | Create/overwrite files |
| `edit` | `tool/edit.ts` | Exact string replacement in files |
| `bash` | `tool/bash.ts` | Execute shell commands (with tree-sitter parsing for permission enforcement) |
| `glob` | `tool/glob.ts` | Fast file pattern matching |
| `grep` | `tool/grep.ts` | Content search via ripgrep |
| `webfetch` | `tool/webfetch.ts` | Fetch and parse URLs |
| `websearch` | `tool/websearch.ts` | Web search |
| `question` | `tool/question.ts` | Ask user a question |
| `skill` | `tool/skill.ts` | Invoke a skill |
| `task` | `tool/task.ts` | Spawn subagent |
| `todowrite` | `tool/todowrite.ts` | Create/update task list |
| `apply_patch` | `tool/apply-patch.ts` | Apply unified diffs |

### Tool Materialization

```typescript
// registry.ts:23
interface Materialization {
  definitions: ToolDefinition[]      // schema sent to LLM
  settle: (input: ExecuteInput) => Effect<Settlement, Error>
}

interface Settlement {
  result: ToolResultValue            // { type: "text", text } | { type: "error", value }
  output?: ToolOutput                // structured output
  outputPaths?: string[]             // paths to truncated output files
}
```

Each tool is defined as an `AnyTool` with: `description`, `input` schema, `output` schema, `execute` function, and `toModelOutput` converter.

### Permission Model

Each agent has a permission ruleset that gates tools:
- `"*": "allow"` — default allow
- `"external_directory": { "*": "ask" }` — file writes outside workspace require confirmation
- `"read": { "*.env": "ask" }` — sensitive files require confirmation
- Pattern matching via `Permission.fromConfig()` → merges defaults, agent config, and user config

---

## Event Streaming → TUI

The entire session state is event-sourced. All state changes flow as typed events:

### Event Types

```
SessionEvent.Tool.Called      — LLM requested a tool call
SessionEvent.Tool.Completed   — Tool executed successfully
SessionEvent.Tool.Failed      — Tool execution failed
SessionEvent.Step.Ended       — Provider turn finished (tokens, cost, snapshot)
SessionEvent.Message.Updated  — Message content changed
SessionEvent.Message.Part.*   — Part-level delta/replacement
SessionEvent.Permission.*     — Permission asked/replied
SessionEvent.Question.*       — Question asked/replied/rejected
SessionEvent.Session.Status   — idle/running/error
```

### Event Flow

```
SessionRunnerLLM.publish()           ← durable event persisted to SQLite
       ↓
SDK global event stream (SSE/WS)     ← sent to all connected clients
       ↓
stream.transport.ts:watch()          ← background consumer loop
       ↓
reduceSessionData()                  ← event → scrollback commits + footer state
       ↓
syncFooter()                         ← writes commits to scrollback, updates status bar
       ↓
packages/opencode/src/cli/cmd/run/stream.ts  ← renders text, diffs, tool output to TUI
```

### Session Data Reducer

```typescript
// session-data.ts
reduceSessionData({ data, event, sessionID, thinking, limits }) → {
  data: SessionData       // updated session state
  commits: StreamCommit[] // new scrollback entries
  footer?: FooterOutput   // status bar updates
}
```

The reducer tracks:
- Active text parts (streaming deltas)
- Tool call state (pending → running → completed/error)
- Permission requests (blocker tracking)
- Question requests
- Reasoning blocks (thinking mode)
- Usage/cost stats

---

## Bug-Fix Walkthrough

Here's the concrete flow when you paste a test failure:

### Step 1: User Input

```
User: "My Browser4 project has a test failure:
       FAIL: test_login_redirect — expected '/dashboard' got '/login'
       at tests/auth.test.ts:42"
```

### Step 2: Enter → Queue → Transport

1. Footer (TUI) emits prompt event
2. `runPromptQueue.submit()` creates: `{ text: "...", parts: [], messageID: "msg_..." }`
3. Queue drains → `runPromptTurn()` called
4. Transport sends: `sdk.session.promptAsync({ sessionID, parts: [{ type: "text", text: "..." }] })`

### Step 3: Server → Session Runner

1. HTTP handler receives prompt → `SessionV2.prompt()`
2. `SessionExecution.resume(sessionID)` → `SessionRunCoordinator.run()`
3. `SessionRunner.run({ force: true })` starts the agent loop

### Step 4: Agent Context Assembly

```
Agent: "build" (default — has read/write/edit/bash/grep/glob)
System prompt selection based on model:
  - Anthropic → anthropic.txt
  - OpenAI → gpt.txt (includes: "If the user pastes an error description or a bug report,
    help them diagnose the root cause. You can try to reproduce it...")
  - Default → default.txt (includes: "Search tools to understand → implement → verify with tests")

System context:
  - core/environment: "Working directory: /Users/.../Browser4\nPlatform: darwin\nIs git: yes"
  - core/date: "Today's date: 2026-08-03"
  - Agent system prompt
  - Skill guidance (if any .opencode/skills defined)
  - Reference guidance (if any .opencode/references defined)
```

### Step 5: LLM Turn 1 — Investigation

```
Model receives:
  system: [environment, date, build agent instructions, tool descriptions]
  messages: [
    { role: "user", content: "My Browser4 project has a test failure..." }
  ]

Model response (streaming):
  "I'll investigate this test failure. Let me start by reading the failing test..."
  → tool_call: read { file_path: "tests/auth.test.ts", offset: 35, limit: 20 }
```

### Step 6: Tool Execution

```
ToolRegistry.settle({
  sessionID, agent: "build",
  assistantMessageID, call: { name: "read", arguments: { ... } }
})

→ Read tool executes
→ Permission: "read" with "*": "allow" → granted
→ Returns: file contents with line numbers
→ Published as tool result event
→ Stored as message part
```

### Step 7: LLM Turn 2 — Deeper Investigation

```
Model receives updated history:
  [user message, assistant (partial + tool_call), tool_result (file contents)]

Model continues:
  "I can see the test expects /dashboard but gets /login. Let me check the auth handler..."
  → tool_call: read { file_path: "src/auth/handler.ts" }
  → tool_call: grep { pattern: "redirect.*login|redirect.*dashboard", path: "src/" }
```

### Step 8: LLM Turn 3 — Fix

```
Model after reading auth handler:
  "Found it — the redirect after login uses req.path instead of the stored redirect URL.
   Let me fix it..."
  → tool_call: edit {
      file_path: "src/auth/handler.ts",
      old_string: "const redirectTo = req.path || '/dashboard'",
      new_string: "const redirectTo = session.redirectUrl || '/dashboard'"
    }
```

### Step 9: LLM Turn 4 — Verify

```
Model:
  "Now let me run the test to verify..."
  → tool_call: bash { command: "cd Browser4 && npm test -- tests/auth.test.ts" }

Tool output: "PASS: test_login_redirect (1.2s)\nTests: 1 passed, 1 total"

Model:
  "The test passes now. The bug was in src/auth/handler.ts:42 — the redirect
   after login was using `req.path` (the current request path, which is always
   `/login`) instead of `session.redirectUrl` (the URL the user originally
   requested before being redirected to login)."
```

### Step 10: Turn Completes

```
needsContinuation = false   ← model called no more tools, gave final answer
SessionEvent.Step.Ended published (tokens, cost, snapshot)
Deferred.succeed(wait.done) → runPromptTurn() resolves
Queue drains next prompt (if any)
```

### End-to-End Sequence Diagram

```
User              TUI/Footer        Transport         SDK/HTTP          Server           Runner            LLM Provider
 │                   │                  │                  │                │                │                   │
 │  paste failure    │                  │                  │                │                │                   │
 ├──────────────────►│                  │                  │                │                │                   │
 │                   │  submit(prompt)  │                  │                │                │                   │
 │                   ├─────────────────►│                  │                │                │                   │
 │                   │                  │  promptAsync()   │                │                │                   │
 │                   │                  ├─────────────────►│                │                │                   │
 │                   │                  │                  │  POST /prompt  │                │                   │
 │                   │                  │                  ├───────────────►│                │                   │
 │                   │                  │                  │                │  resume(id)    │                   │
 │                   │                  │                  │                ├───────────────►│                   │
 │                   │                  │                  │                │                │  load context     │
 │                   │                  │                  │                │                │  (system, history)│
 │                   │                  │                  │                │                │  resolve model    │
 │                   │                  │                  │                │                │  materialize tools│
 │                   │                  │                  │                │                │                   │
 │                   │                  │                  │                │                │  llm.stream()     │
 │                   │                  │                  │                │                ├──────────────────►│
 │                   │                  │                  │                │                │◄──────────────────┤
 │                   │                  │                  │                │                │  text delta       │
 │                   │  append(text)    │  reduce(data)    │  SSE event     │                │                   │
 │                   │◄─────────────────┤◄─────────────────┤◄───────────────┤◄───────────────┤                   │
 │  "I'll read..."   │                  │                  │                │                │                   │
 │◄──────────────────┤                  │                  │                │                │                   │
 │                   │                  │                  │                │                │                   │
 │                   │                  │                  │                │                │  tool_call: read  │
 │                   │                  │                  │                │                ├──────────────────►│
 │                   │                  │                  │                │                │◄──────────────────┤
 │                   │                  │                  │                │  settle(read)  │                   │
 │                   │                  │                  │                │  → execute     │                   │
 │                   │                  │                  │                │  → tool_result │                   │
 │                   │                  │                  │                │                │                   │
 │                   │  append(result)  │  reduce(result)  │  SSE event     │                │                   │
 │                   │◄─────────────────┤◄─────────────────┤◄───────────────┤◄───────────────┤                   │
 │  (shows result)   │                  │                  │                │                │                   │
 │◄──────────────────┤                  │                  │                │                │                   │
 │                   │                  │                  │                │                │                   │
 │                  ...                 ...                ...              ...              ...                 ...
 │                   │                  │                  │                │                │                   │
 │                   │                  │                  │                │  needsCont=false│                   │
 │                   │  idle            │  idle            │  status:idle   │                │                   │
 │                   │◄─────────────────┤◄─────────────────┤◄───────────────┤◄───────────────┤                   │
 │  "Done, fixed"    │                  │                  │                │                │                   │
 │◄──────────────────┤                  │                  │                │                │                   │
```

### System Prompts That Guide This Behavior

From `packages/opencode/src/session/prompt/`:

**default.txt** (used for most models):
```
## Task Workflow
- Use search tools (grep, glob) to understand the codebase
- Implement the solution
- Verify with tests
- Run lint/typecheck
```

**gpt.txt** (OpenAI models):
```
If the user pastes an error description or a bug report, help them diagnose
the root cause. You can try to reproduce it if it seems feasible with the
available tools and skills.
```

**beast.txt / copilot-gpt-5.txt**:
```
Implement the fix incrementally, test after each change, and iterate until
the root cause is fixed and all tests pass.
```

**kimi.txt**:
```
For a bug fix, you typically need to check error logs or failed tests, scan
over the codebase to find the root cause... If user mentioned any failed
tests, you should make sure they pass after the changes.
```

---

## Key File Index

### CLI & Runtime
| File | Role |
|---|---|
| `packages/opencode/src/index.ts` | CLI entry, yargs command registration |
| `packages/opencode/src/cli/cmd/run.ts` | `opencode run` command |
| `packages/opencode/src/cli/cmd/run/runtime.ts` | Top-level orchestrator (boot → lifecycle → queue) |
| `packages/opencode/src/cli/cmd/run/runtime.queue.ts` | Serial prompt queue |
| `packages/opencode/src/cli/cmd/run/stream.transport.ts` | SDK event subscription, prompt turn coordination |
| `packages/opencode/src/cli/cmd/run/stream.ts` | Writes commits to scrollback |
| `packages/opencode/src/cli/cmd/run/session-data.ts` | Event → session state reducer |
| `packages/opencode/src/cli/cmd/run/session-replay.ts` | Replay bootstrap from server state |

### Server
| File | Role |
|---|---|
| `packages/opencode/src/server/server.ts` | HTTP server (Effect HttpApi) |
| `packages/server/src/handlers/session.ts` | Shared session HTTP handlers |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` | Instance-specific session handlers |

### Agent Loop
| File | Role |
|---|---|
| `packages/core/src/session/runner/llm.ts` | **Core agent loop** — run, runTurn, LLM streaming, tool settlement |
| `packages/core/src/session/runner/model.ts` | Model resolution (provider/model/auth) |
| `packages/core/src/session/runner/to-llm-message.ts` | History → LLM message format conversion |
| `packages/core/src/session/runner/publish-llm-event.ts` | LLM event → durable SessionEvent publisher |
| `packages/core/src/session/runner/max-steps.ts` | Agent step limit enforcement |
| `packages/core/src/session/run-coordinator.ts` | Per-session serialization with wake coalescing |
| `packages/core/src/session/execution/local.ts` | Wires coordinator → session runner |
| `packages/core/src/session.ts` | SessionV2 service (create, prompt, compact, etc.) |

### Tools
| File | Role |
|---|---|
| `packages/core/src/tool/registry.ts` | Tool registry (register, materialize, settle) |
| `packages/core/src/tool/tool.ts` | Tool primitives (AnyTool, make, define, permission) |
| `packages/opencode/src/tool/read.ts` | Read file tool |
| `packages/opencode/src/tool/edit.ts` | Edit file tool |
| `packages/opencode/src/tool/write.ts` | Write file tool |
| `packages/opencode/src/tool/bash.ts` | Bash tool (with tree-sitter parsing) |
| `packages/opencode/src/tool/grep.ts` | Grep/ripgrep tool |
| `packages/opencode/src/tool/glob.ts` | Glob tool |
| `packages/opencode/src/tool/task.ts` | Subagent spawn tool |
| `packages/opencode/src/tool/webfetch.ts` | Web fetch tool |
| `packages/opencode/src/tool/websearch.ts` | Web search tool |
| `packages/opencode/src/tool/question.ts` | User question tool |
| `packages/opencode/src/tool/skill.ts` | Skill invocation tool |

### Agents & Prompts
| File | Role |
|---|---|
| `packages/opencode/src/agent/agent.ts` | Agent definitions (build/plan/explore/general) |
| `packages/opencode/src/agent/prompt/explore.txt` | Explore agent system prompt |
| `packages/opencode/src/session/prompt/default.txt` | Default system prompt |
| `packages/opencode/src/session/prompt/gpt.txt` | OpenAI system prompt |
| `packages/opencode/src/session/prompt/anthropic.txt` | Anthropic system prompt |
| `packages/opencode/src/session/system.ts` | System prompt selection by model |

### System Context
| File | Role |
|---|---|
| `packages/core/src/system-context/index.ts` | Composable system context framework |
| `packages/core/src/system-context/builtins.ts` | Built-in sources (environment, date) |
| `packages/core/src/system-context/registry.ts` | Source registration |
| `packages/core/src/session/context-epoch.ts` | Context epoch lifecycle (init/reconcile/replace) |

### LLM Package
| File | Role |
|---|---|
| `packages/llm/src/llm.ts` | LLMEvent types, LLM request interface |
| `packages/llm/src/route/index.ts` | Client routing |
| `packages/llm/src/providers/anthropic.ts` | Anthropic provider |
| `packages/llm/src/providers/openai.ts` | OpenAI provider |
| `packages/llm/src/providers/google.ts` | Google provider |
| `packages/llm/src/tool.ts` | LLM-side tool definitions |
| `packages/llm/src/tool-runtime.ts` | Tool execution runtime |
