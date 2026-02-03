# Core Loop Orchestration & State Management

This document explains how OpenCode orchestrates multi-turn LLM interactions,
manages tool execution, assembles context, and handles state transitions. It is
written at a level of detail sufficient for a developer to reimplement the core
loop from scratch.

**Key source files** (all paths relative to `packages/opencode/src/`):

| File | Responsibility |
|---|---|
| `session/prompt.ts` | Outer multi-turn loop, tool resolution, context assembly |
| `session/processor.ts` | Inner stream processing, tool lifecycle, retry logic |
| `session/llm.ts` | LLM API call (`streamText`), system prompt construction |
| `session/compaction.ts` | Context window overflow detection, pruning, summarisation |
| `session/message-v2.ts` | Message/part schemas, conversion to model messages |
| `session/system.ts` | Model-specific base system prompts |
| `session/instruction.ts` | User instruction file discovery (`AGENTS.md`, `CLAUDE.md`, etc.) |
| `session/retry.ts` | Retry classification and exponential backoff |
| `agent/agent.ts` | Agent definitions and permission rulesets |
| `tool/registry.ts` | Tool registration and filtering |
| `permission/next.ts` | Permission evaluation, ask/allow/deny gating |

---

## 1. Data Model

Before describing the loop, you need to understand the structures it operates
on.

### 1.1 Session

```
Session.Info {
  id              string          -- ULID, descending (newest first)
  slug            string          -- human-readable slug
  projectID       string          -- owning project
  directory       string          -- working directory
  parentID?       string          -- if this is a child/subtask session
  title           string          -- auto-generated or user-set
  permission?     Ruleset         -- session-level permission overrides
  time            { created, updated, compacting?, archived? }
  revert?         { messageID, partID?, snapshot?, diff? }
}
```

### 1.2 Messages

Every conversation is a flat list of messages stored as
`["message", sessionID, messageID]` in the storage layer. Messages come in two
roles:

**User message** (`MessageV2.User`):
```
{
  id, sessionID, role: "user",
  agent        string        -- which agent this turn targets
  model        { providerID, modelID }
  system?      string        -- per-message system prompt override
  tools?       Record<string, boolean>  -- per-message tool overrides (deprecated)
  variant?     string        -- model variant selection
  time         { created }
}
```

**Assistant message** (`MessageV2.Assistant`):
```
{
  id, sessionID, role: "assistant",
  parentID     string        -- links to the user message that triggered this
  agent        string        -- which agent produced this message
  model info   (providerID, modelID)
  finish?      string        -- finish reason ("stop", "tool-calls", "length", etc.)
  error?       NamedError    -- if the turn errored
  summary?     boolean       -- true if this is a compaction summary message
  cost         number        -- dollar cost of this turn
  tokens       { input, output, reasoning, cache: { read, write } }
  path         { cwd, root } -- filesystem paths at time of generation
  time         { created, completed? }
}
```

### 1.3 Parts

Each message has an ordered list of **parts**, stored separately at
`["part", messageID, partID]`. Parts are the atomic units of content:

| Part type | Description |
|---|---|
| `text` | Text content (user prompt or assistant response). Has optional `synthetic` and `ignored` flags. |
| `file` | Attached file (image, text file, directory listing). Carries `mime`, `url`, `filename`. |
| `agent` | Agent invocation marker (when user uses `@agent` syntax). |
| `tool` | A tool call. Contains `callID`, `tool` name, and a `state` discriminated union (see below). |
| `reasoning` | Chain-of-thought / extended thinking content. |
| `compaction` | Marker that triggers context compaction on next loop iteration. |
| `subtask` | Marker that triggers subtask execution on next loop iteration. Contains `prompt`, `agent`, `model`. |
| `step-start` | Snapshot marker at the beginning of an LLM step. |
| `step-finish` | Token usage, cost, and snapshot at the end of an LLM step. |
| `patch` | Filesystem diff captured between step-start and step-finish. |
| `retry` | Records a retry attempt with error details. |

### 1.4 Tool State Machine

Every `ToolPart` has a `state` field that follows this state machine:

```
             ┌──────────┐
             │ pending   │  Created when LLM starts streaming tool input
             └────┬──────┘
                  │  tool-call event (input fully received)
                  ▼
             ┌──────────┐
             │ running   │  Tool's execute() function is in progress
             └────┬──────┘
                  │
          ┌───────┴────────┐
          ▼                ▼
   ┌────────────┐   ┌──────────┐
   │ completed   │   │  error   │
   └────────────┘   └──────────┘
```

**State shapes:**

```typescript
// pending: LLM is still streaming the tool call arguments
{ status: "pending", input: {}, raw: string }

// running: Tool execute() is in progress
{ status: "running", input: Record, time: { start }, title?, metadata? }

// completed: Tool returned successfully
{ status: "completed", input, output: string, title, metadata, time: { start, end, compacted? }, attachments? }

// error: Tool threw or was aborted
{ status: "error", input, error: string, time: { start, end }, metadata? }
```

If the stream ends with tools still in `pending` or `running`, the processor
forces them to `error` with message `"Tool execution aborted"`.

---

## 2. The Outer Loop (`SessionPrompt.loop`)

**Location:** `session/prompt.ts:262-644`

This is the top-level orchestrator. It runs a `while (true)` loop where each
iteration represents one **turn** (one LLM API call and its tool executions).

### 2.1 Entry Point

```
SessionPrompt.prompt(input) {
  1. Create user message from input parts
  2. If noReply=true, return immediately (message-only, no LLM call)
  3. Call loop(sessionID) to start the multi-turn execution
}
```

### 2.2 Concurrency Guard

Only one loop can run per session at a time:

```
state[sessionID] = {
  abort: AbortController,     -- cancellation signal
  callbacks: []               -- promises from concurrent callers who are waiting
}
```

If `loop()` is called while already running, the caller's promise is queued in
`callbacks` and resolved when the loop finishes. The `cancel(sessionID)`
function aborts the controller and rejects all queued callbacks.

### 2.3 Loop Body (Pseudocode)

```python
def loop(sessionID):
    abort = start(sessionID)           # acquire lock, get AbortSignal
    step = 0
    session = Session.get(sessionID)

    while True:
        if abort.aborted: break

        # ── 1. Load messages ──
        msgs = filterCompacted(MessageV2.stream(sessionID))

        # ── 2. Find key messages ──
        lastUser       = most recent user message
        lastAssistant  = most recent assistant message
        lastFinished   = most recent assistant with a finish reason
        tasks          = pending compaction/subtask parts (from unfinished messages)

        # ── 3. Check exit condition ──
        if lastAssistant.finish not in ["tool-calls", "unknown"]
           and lastUser.id < lastAssistant.id:
            break  # LLM is done

        step += 1
        if step == 1: fire-and-forget title generation

        model = resolve model from lastUser

        # ── 4. Handle pending subtask ──
        task = tasks.pop()
        if task.type == "subtask":
            execute TaskTool inline
            create assistant message with tool part
            store result
            if task.command: add synthetic "Continue" user message
            continue  # next iteration

        # ── 5. Handle pending compaction ──
        if task.type == "compaction":
            result = SessionCompaction.process(msgs)
            if result == "stop": break
            continue

        # ── 6. Check context overflow ──
        if lastFinished tokens exceed model limit:
            SessionCompaction.create(...)   # inserts compaction part
            continue

        # ── 7. Normal processing ──
        agent = Agent.get(lastUser.agent)
        maxSteps = agent.steps or Infinity
        isLastStep = step >= maxSteps

        # Insert reminders for mid-loop user messages
        msgs = insertReminders(msgs, agent, session)

        # Create new assistant message shell
        processor = SessionProcessor.create(assistantMessage, model, abort)

        # Resolve tools (built-in + MCP + plugins, filtered by permissions)
        tools = resolveTools(agent, model, session, processor, msgs)

        # Wrap mid-loop user messages in <system-reminder> tags
        if step > 1:
            for queued user messages after lastFinished:
                wrap text in system-reminder XML

        # Transform via plugins
        Plugin.trigger("experimental.chat.messages.transform", msgs)

        # ── 8. Call the processor ──
        result = processor.process({
            user: lastUser,
            agent, abort, sessionID,
            system: [environment prompt, instruction prompt],
            messages: toModelMessages(msgs) + (MAX_STEPS warning if isLastStep),
            tools, model
        })

        if result == "stop": break
        if result == "compact":
            SessionCompaction.create(...)
        continue

    # ── 9. Post-loop cleanup ──
    SessionCompaction.prune(sessionID)   # prune old tool outputs
    return last assistant message
```

### 2.4 Exit Conditions

The loop breaks when any of these are true:

| Condition | Where |
|---|---|
| `abort.aborted` | User cancelled the session |
| `lastAssistant.finish` is a terminal reason (`"stop"`, `"length"`, etc.) and the user message predates it | The LLM produced a final response |
| Processor returns `"stop"` | Error, abort, or permission denial |
| Compaction processing returns `"stop"` | Compaction agent errored |

### 2.5 Step Limit

Each agent can define a `steps` limit. When `step >= agent.steps`, a prefilled
assistant message is injected containing a "max steps" warning that tells the
LLM it's on its final turn and should wrap up. This prevents runaway loops.

---

## 3. The Processor (`SessionProcessor`)

**Location:** `session/processor.ts:19-407`

The processor handles a single turn: one `LLM.stream()` call and its streaming
events. It also contains a retry loop for transient API errors.

### 3.1 Creation

```typescript
SessionProcessor.create({
  assistantMessage,  // the shell assistant message (no content yet)
  sessionID,
  model,
  abort,             // AbortSignal for cancellation
})
```

Internal state:
- `toolcalls: Record<callID, ToolPart>` -- tracks in-flight tool calls
- `snapshot: string | undefined` -- filesystem snapshot hash
- `blocked: boolean` -- set true if permission denied
- `attempt: number` -- retry counter
- `needsCompaction: boolean` -- set true if context overflowed mid-stream

### 3.2 Processing Loop (Pseudocode)

```python
def process(streamInput):
    while True:  # retry loop
        try:
            stream = LLM.stream(streamInput)

            for event in stream.fullStream:
                abort.throwIfAborted()

                match event.type:
                    "start":
                        set session status = "busy"

                    "reasoning-start/delta/end":
                        accumulate ReasoningPart, persist to storage

                    "text-start":
                        create TextPart shell
                    "text-delta":
                        append text, persist with delta for streaming UI
                    "text-end":
                        trim, run plugin hook, finalize

                    "tool-input-start":
                        create ToolPart with status="pending"
                        register in toolcalls map

                    "tool-call":
                        update ToolPart to status="running"
                        check doom loop (3 identical calls → ask permission)

                    "tool-result":
                        update ToolPart to status="completed"
                        store output, metadata, title, attachments
                        remove from toolcalls map

                    "tool-error":
                        update ToolPart to status="error"
                        if PermissionRejected: set blocked=true
                        remove from toolcalls map

                    "start-step":
                        take filesystem snapshot

                    "finish-step":
                        compute token usage and cost
                        update assistant message
                        if snapshot changed: record PatchPart with file diffs
                        check context overflow → needsCompaction

                    "error":
                        throw (handled by catch below)

                if needsCompaction: break out of stream loop

        except error:
            classify error via SessionRetry.retryable()
            if retryable:
                attempt++
                delay = exponential backoff (respects Retry-After headers)
                set session status = "retry"
                sleep(delay)
                continue  # retry the stream

            # non-retryable error
            store error on assistant message
            publish error event
            set session status = "idle"

        # cleanup: force any incomplete tools to "error"
        for tool in assistantMessage.parts:
            if tool.status not in ["completed", "error"]:
                tool.status = "error", error = "Tool execution aborted"

        assistantMessage.time.completed = now
        persist assistant message

        # return control to outer loop
        if needsCompaction: return "compact"
        if blocked: return "stop"
        if assistantMessage.error: return "stop"
        return "continue"
```

### 3.3 Return Values

| Return | Meaning | Outer loop action |
|---|---|---|
| `"continue"` | LLM finished with `finish_reason: "tool-calls"` | Loop continues (new turn) |
| `"stop"` | Error, abort, or permission denial | Break out of outer loop |
| `"compact"` | Token count exceeded context window | Create compaction marker, then continue |

### 3.4 Doom Loop Detection

If the last 3 tool parts on the current assistant message are the same tool
with identical inputs, the processor requests a `doom_loop` permission check.
This prompts the user: "The agent is calling the same tool repeatedly. Allow?"
This prevents infinite retry loops where the LLM keeps calling a failing tool.

```
Threshold: DOOM_LOOP_THRESHOLD = 3
Check: last 3 tool parts same tool name + JSON.stringify(input) matches
Action: PermissionNext.ask({ permission: "doom_loop", patterns: [toolName] })
```

### 3.5 Retry Logic

**Location:** `session/retry.ts`

Errors are classified by `SessionRetry.retryable()`:

- `APIError` with `isRetryable: true` → retry
- Rate limit errors (`too_many_requests`, `rate_limit`) → retry
- Provider overloaded → retry
- Resource exhausted/unavailable → retry
- Everything else → non-retryable, stop

Backoff calculation:
1. Check `Retry-After-Ms` header → use that value
2. Check `Retry-After` header (seconds or HTTP date) → use that value
3. Otherwise: `2000ms * 2^(attempt-1)`, capped at 30s without headers

---

## 4. The LLM Call (`LLM.stream`)

**Location:** `session/llm.ts:46-266`

This function constructs the final `streamText()` call to the Vercel AI SDK.

### 4.1 Inputs

```typescript
type StreamInput = {
  user: MessageV2.User         // the triggering user message
  sessionID: string
  model: Provider.Model        // resolved model with capabilities, limits, etc.
  agent: Agent.Info            // active agent definition
  system: string[]             // environment + instruction prompts
  abort: AbortSignal
  messages: ModelMessage[]     // conversation history (already converted)
  small?: boolean              // use small/fast model variant (for titles, etc.)
  tools: Record<string, Tool>  // resolved AI SDK tool definitions
  retries?: number             // max retries (default 0)
}
```

### 4.2 System Prompt Assembly

The system prompt is built from multiple layers, concatenated in order:

```
Layer 1: Agent prompt OR model-specific base prompt
         - agent.prompt if set (custom agents, explore, compaction, etc.)
         - OR SystemPrompt.provider(model) which selects:
             - Claude models    → anthropic.txt
             - GPT models       → beast.txt
             - Gemini models    → gemini.txt
             - Others           → qwen.txt (anthropic without todo)

Layer 2: Additional system prompts passed in (environment + instructions)
         - Assembled by the outer loop (see Section 5)

Layer 3: Per-message system override (user.system)
```

These are joined into a single string, then optionally transformed by plugins
via `experimental.chat.system.transform`. The result is split into at most 2
parts for prompt caching (stable header + variable tail).

### 4.3 Tool Filtering

Before passing tools to `streamText`, `LLM.resolveTools()` removes:
- Tools the user explicitly disabled (`user.tools[name] === false`)
- Tools the agent's permission ruleset denies (`PermissionNext.disabled()`)

This is a **pre-filter** — tools denied here never appear in the LLM's tool
list. Tools with `action: "ask"` still appear but will prompt the user at
execution time.

### 4.4 Tool Call Repair

If the LLM generates a tool call with an unrecognised name, the SDK calls
`experimental_repairToolCall`:

1. Try lowercasing the tool name (handles case mismatches)
2. If still unknown, reroute to the `invalid` tool with the error message

### 4.5 Model Parameters

Parameters are assembled from multiple sources, merged in order (later wins):

```
base options (from ProviderTransform)
  ← model.options
    ← agent.options
      ← variant options (if variant selected)
```

Temperature, topP, topK come from the agent config, falling back to
provider-specific defaults.

### 4.6 Final `streamText` Call

```typescript
streamText({
  model: wrapLanguageModel(language, middleware),
  system: [systemPart1, systemPart2],
  messages: [...system, ...conversation],
  tools,
  activeTools: Object.keys(tools).filter(x => x !== "invalid"),
  maxOutputTokens,
  temperature, topP, topK,
  providerOptions,
  headers,
  abortSignal: abort,
})
```

The Vercel AI SDK handles multi-step tool execution internally: when the LLM
emits a tool call, the SDK executes the tool function, feeds the result back to
the LLM, and continues streaming. A single `LLM.stream()` call can contain
multiple **steps** (LLM response → tool execution → LLM response → ...).

---

## 5. Context Assembly

This section describes exactly what the LLM sees on each turn.

### 5.1 Message Array Structure

The final messages array passed to `streamText` is:

```
[
  { role: "system", content: systemPromptPart1 },   // base prompt (cacheable)
  { role: "system", content: systemPromptPart2 },   // env + instructions (variable)
  ...conversationMessages,                           // full history
  { role: "assistant", content: MAX_STEPS }          // only if on final step
]
```

### 5.2 System Prompt Components

**Part 1 — Base prompt** (from `SystemPrompt.provider` or `agent.prompt`):
- Model-specific instruction set (how to use tools, coding guidelines, etc.)
- Stable across turns → benefits from prompt caching

**Part 2 — Environment + Instructions** (assembled in outer loop):

Environment (`SystemPrompt.environment`):
```xml
You are powered by the model named {model.api.id}. The exact model ID is {providerID}/{model.api.id}
Here is some useful information about the environment you are running in:
<env>
  Working directory: /path/to/project
  Is directory a git repo: yes
  Platform: linux
  Today's date: Tue Feb 03 2026
</env>
<directories>
</directories>
```

Instructions (`InstructionPrompt.system`):
- Reads instruction files in this priority order:
  1. Project-level: `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` (found by walking
     up from cwd to worktree root)
  2. Global: `~/.config/opencode/AGENTS.md` or `~/.claude/CLAUDE.md`
  3. Config-specified: paths from `config.instructions` (files or URLs)
- Each file is prefixed with `"Instructions from: /path/to/file"`
- URL-based instructions are fetched with a 5-second timeout

### 5.3 Conversation Message Conversion

`MessageV2.toModelMessages()` converts the internal message format to the
Vercel AI SDK's `UIMessage` format, then calls `convertToModelMessages()`.

**User messages:**
- `TextPart` → `{ type: "text", text }` (skipped if `ignored: true`)
- `FilePart` → `{ type: "file", url, mediaType }` (only non-text, non-directory files)
- `CompactionPart` → `{ type: "text", text: "What did we do so far?" }`
- `SubtaskPart` → `{ type: "text", text: "The following tool was executed by the user" }`

**Assistant messages:**
- Skipped entirely if the message has a non-aborted error and no meaningful parts
- `TextPart` → `{ type: "text", text }`
- `ReasoningPart` → `{ type: "reasoning", text }`
- `ToolPart (completed)` → tool call + result pair. Output is the tool's string
  output, or `"[Old tool result content cleared]"` if pruned.
- `ToolPart (error)` → tool call + error result
- `ToolPart (pending/running)` → tool call + error `"[Tool execution was interrupted]"`
- `StepStartPart` → `{ type: "step-start" }` (used by AI SDK for multi-step)

### 5.4 Mid-Loop User Messages (Reminders)

When the user sends a message while the agent is already mid-execution
(`step > 1`), the text is wrapped to prevent the agent from abandoning its
current task:

```xml
<system-reminder>
The user sent the following message:
{original text}

Please address this message and continue with your tasks.
</system-reminder>
```

### 5.5 Agent-Specific Reminders

The `insertReminders` function adds synthetic text parts based on agent mode:

- **Plan agent**: Injects a detailed plan-mode instruction set (Phase 1-5
  workflow: understand, design, review, write plan, call plan_exit)
- **Switching from plan to build**: Injects a "build switch" prompt, optionally
  referencing the plan file
- These are appended to the last user message's parts

### 5.6 Max Steps Warning

If `step >= agent.steps`, a prefilled assistant message is injected:

```
{ role: "assistant", content: MAX_STEPS_TEXT }
```

This tells the LLM it's on its final allowed turn and should produce a final
response rather than more tool calls.

### 5.7 Compacted Message Filtering

`MessageV2.filterCompacted()` walks messages in reverse. When it finds a user
message with a `CompactionPart` whose corresponding assistant summary is
complete, it stops — all older messages are excluded from context.

This means after compaction, the LLM sees:
```
[compaction user message] → [compaction summary] → [continue message] → [new turns...]
```

---

## 6. Tool System

### 6.1 Tool Registry

**Location:** `tool/registry.ts`

The registry collects tools from three sources:

1. **Built-in tools** (hardcoded list):
   `invalid`, `question`, `bash`, `read`, `glob`, `grep`, `edit`, `write`,
   `task`, `webfetch`, `todowrite`, `websearch`, `codesearch`, `skill`,
   `apply_patch`, `lsp`, `batch`, `plan_exit`, `plan_enter`

2. **Custom tools** (from config directories):
   Files matching `{tool,tools}/*.{js,ts}` in config directories are loaded as
   plugin tools.

3. **Plugin tools**: Registered via the plugin system (`Plugin.list()`)

**Filtering rules:**
- `codesearch` and `websearch`: only available for OpenCode provider or with feature flag
- `apply_patch` vs `edit`/`write`: mutually exclusive based on model (GPT uses
  apply_patch, others use edit/write)
- `question`: only available in app/cli/desktop clients
- `plan_exit`/`plan_enter`: only with experimental plan mode flag + CLI client
- `lsp`: only with experimental LSP tool flag
- `batch`: only with experimental batch_tool config

### 6.2 Tool Resolution in the Outer Loop

**Location:** `session/prompt.ts:653-829`

For each turn, `resolveTools()`:

1. Calls `ToolRegistry.tools(model, agent)` to get the filtered built-in list
2. For each tool, wraps it in a Vercel AI SDK `tool()` with:
   - JSON schema for parameters (transformed per provider)
   - An `execute` function that:
     a. Creates a `Tool.Context` with session/message/call IDs
     b. Fires `tool.execute.before` plugin hook
     c. Calls the tool's `execute()` method
     d. Fires `tool.execute.after` plugin hook
     e. Returns `{ title, metadata, output, attachments }`
3. Loads MCP tools via `MCP.tools()` and wraps them similarly, adding
   permission checks and output formatting
4. `LLM.resolveTools()` then removes tools denied by the agent's permission
   ruleset before passing to `streamText`

### 6.3 Tool Context

Every tool execution receives:

```typescript
type Tool.Context = {
  sessionID: string
  messageID: string          // current assistant message
  callID?: string            // unique tool call ID from the LLM
  agent: string              // name of active agent
  abort: AbortSignal         // cancellation
  messages: WithParts[]      // full conversation history
  extra?: Record<string, any>  // model info, bypass flags
  metadata(input): void      // update tool's metadata during execution
  ask(input): Promise<void>  // request permission (blocks until user responds)
}
```

### 6.4 Tool Permission Flow

When a tool calls `ctx.ask()`:

```
1. Evaluate permission + pattern against merged ruleset
   (agent.permission + session.permission + runtime approvals)

2. If action = "allow" → return immediately
3. If action = "deny"  → throw DeniedError (tool fails, may stop loop)
4. If action = "ask"   → block on Promise:
   a. Publish permission.asked event (UI shows prompt)
   b. Wait for user response:
      - "once"   → resolve promise (this call only)
      - "always" → cache approval for matching patterns, resolve
      - "reject" → reject promise → PermissionNext.RejectedError
                   also rejects all other pending permissions for this session
```

---

## 7. Agent System

### 7.1 Agent Definition

```typescript
type Agent.Info = {
  name: string                    // unique identifier
  description?: string
  mode: "primary" | "subagent" | "all"
  permission: PermissionNext.Ruleset    // tool access rules
  model?: { providerID, modelID }       // override default model
  prompt?: string                       // override system prompt
  temperature?: number
  topP?: number
  steps?: number                  // max outer-loop iterations
  options: Record<string, any>    // provider-specific options
  hidden?: boolean                // excluded from UI lists
  native?: boolean                // built-in vs user-defined
}
```

### 7.2 Built-in Agents

| Agent | Mode | Key Permissions | Purpose |
|---|---|---|---|
| `build` | primary | All tools allowed, question allowed, plan_enter allowed | Default coding agent |
| `plan` | primary | Edit tools denied (except plan files), plan_exit allowed | Read-only analysis and planning |
| `general` | subagent | All tools except todoread/todowrite | Multi-step task execution |
| `explore` | subagent | Only grep, glob, list, bash, read, webfetch, websearch, codesearch | Fast codebase exploration |
| `compaction` | primary (hidden) | All tools denied | Context summarisation |
| `title` | primary (hidden) | All tools denied, temperature=0.5 | Session title generation |
| `summary` | primary (hidden) | All tools denied | Session summary generation |

### 7.3 Permission Ruleset Structure

```typescript
type Rule = {
  permission: string    // tool name or wildcard ("*", "bash", "edit", "external_directory")
  pattern: string       // file/command pattern ("*", "*.env", "/tmp/*")
  action: "allow" | "deny" | "ask"
}
type Ruleset = Rule[]
```

Evaluation: rules are checked in order, **last matching rule wins**. Rulesets
are merged by concatenation (agent defaults + user config + session overrides).

Default rules applied to all agents:
```
*                  → allow
doom_loop          → ask
external_directory → ask (except truncation output dir)
question           → deny (overridden per agent)
plan_enter         → deny (overridden per agent)
plan_exit          → deny (overridden per agent)
read *.env         → ask
read *.env.*       → ask
read *.env.example → allow
```

---

## 8. Context Window Management

### 8.1 Overflow Detection

**Location:** `session/compaction.ts:30-39`

After each `finish-step` event in the processor:

```typescript
isOverflow(tokens, model) {
  if (config.compaction.auto === false) return false
  count = tokens.input + tokens.cache.read + tokens.output
  usable = model.limit.input || (model.limit.context - maxOutputTokens)
  return count > usable
}
```

### 8.2 Compaction Flow

When overflow is detected:

1. **Processor** returns `"compact"` to the outer loop
2. **Outer loop** calls `SessionCompaction.create()` which inserts a user
   message with a `CompactionPart`
3. **Next iteration** of the outer loop detects the pending compaction part
4. **`SessionCompaction.process()`** is called:
   a. Creates an assistant message with `agent: "compaction"`, `summary: true`
   b. Calls `processor.process()` with:
      - All current messages as context
      - No tools (compaction agent has all tools denied)
      - A prompt asking for a detailed summary of the conversation
   c. The compaction agent produces a text summary
   d. If auto-triggered, inserts a synthetic user message: "Continue if you
      have next steps"
5. On subsequent turns, `filterCompacted()` excludes all messages before the
   compaction point

**Compaction prompt:**
> "Provide a detailed prompt for continuing our conversation above. Focus on
> information that would be helpful for continuing the conversation, including
> what we did, what we're doing, which files we're working on, and what we're
> going to do next considering new session will not have access to our
> conversation."

### 8.3 Pruning

**Location:** `session/compaction.ts:49-90`

Runs after the outer loop exits (`SessionCompaction.prune`). Walks backwards
through messages, counting tool output token estimates:

1. Skip the most recent 2 user turns (protect recent context)
2. Stop at any summary message or already-pruned tool
3. Accumulate token estimates for completed tool outputs
4. Once total > 40,000 tokens (PRUNE_PROTECT), start marking older tools
5. Only actually prune if prunable amount > 20,000 tokens (PRUNE_MINIMUM)
6. Pruned tools get `time.compacted = Date.now()` — their output becomes
   `"[Old tool result content cleared]"` in future context assembly

Protected tools (never pruned): `skill`

---

## 9. Subtask Execution

When a user message contains a `SubtaskPart` (from slash commands or agent
invocations), the outer loop handles it specially:

1. Create an assistant message for the parent session
2. Create a `ToolPart` for the `task` tool with `status: "running"`
3. Execute `TaskTool.execute()` directly (not via LLM):
   - The task tool spawns a **child session** with the specified agent
   - The child session runs its own independent `loop()`
   - Results are collected and returned
4. Update the tool part to `completed` or `error`
5. If the subtask came from a command (`task.command`), insert a synthetic user
   message "Summarize the task tool output above and continue with your task."
6. `continue` — the outer loop proceeds to the next iteration where the LLM
   sees the subtask result and continues

---

## 10. Cancellation

Cancellation propagates through the `AbortSignal`:

```
SessionPrompt.cancel(sessionID)
  → abort.abort()
  → reject all queued callbacks
  → delete state entry
  → set session status to "idle"
```

Inside the processor, `abort.throwIfAborted()` is checked on every stream
event. Tools receive the abort signal and are expected to respect it.

---

## 11. Complete Flow Diagram

```
User sends message
        │
        ▼
SessionPrompt.prompt()
  ├─ Create user message (text, files, agents, subtasks)
  └─ Call loop(sessionID)
        │
        ▼
   Acquire session lock (abort controller)
        │
        ▼
┌──────────────── while(true) ──────────────────────┐
│                                                    │
│  ① Load messages (filterCompacted)                 │
│  ② Find lastUser, lastAssistant, lastFinished      │
│  ③ Check exit: assistant done + no pending user?    │
│     └─ YES → break                                │
│                                                    │
│  ④ Pending subtask?                                │
│     └─ Execute TaskTool inline → continue          │
│                                                    │
│  ⑤ Pending compaction?                             │
│     └─ Run compaction agent → continue             │
│                                                    │
│  ⑥ Context overflow?                               │
│     └─ Insert compaction marker → continue         │
│                                                    │
│  ⑦ Normal turn:                                    │
│     a. Resolve agent + model                       │
│     b. Insert agent reminders (plan mode, etc.)    │
│     c. Create assistant message shell              │
│     d. Resolve tools (registry + MCP + filter)     │
│     e. Wrap mid-loop user msgs in reminders        │
│     f. Plugin transform on messages                │
│     g. Build system prompt                         │
│     h. Convert messages to model format            │
│                                                    │
│  ⑧ processor.process() ──────────────────────┐    │
│     │                                         │    │
│     │  while(true):  # retry loop             │    │
│     │    LLM.stream() → streamText()          │    │
│     │      │                                  │    │
│     │      │ ┌── step ──────────────────┐     │    │
│     │      │ │ LLM generates text       │     │    │
│     │      │ │ LLM emits tool calls     │     │    │
│     │      │ │ SDK executes tools       │     │    │
│     │      │ │ SDK feeds results back   │     │    │
│     │      │ │ LLM continues...         │     │    │
│     │      │ └──────────────────────────┘     │    │
│     │      │ (repeats for multiple steps)     │    │
│     │                                         │    │
│     │  Returns: "continue" | "stop" | "compact"    │
│     └─────────────────────────────────────────┘    │
│                                                    │
│  ⑨ Handle result:                                  │
│     "stop"    → break                              │
│     "compact" → insert compaction marker, continue │
│     "continue"→ continue (next turn)               │
│                                                    │
└────────────────────────────────────────────────────┘
        │
        ▼
   Prune old tool outputs
   Return final assistant message
   Release session lock
```

---

## 12. Key Design Decisions

1. **Two-level loop**: The outer loop handles turn orchestration (subtasks,
   compaction, exit conditions). The inner processor handles a single LLM
   stream with retries. This separation keeps concerns clean.

2. **Tool execution inside streamText**: The Vercel AI SDK's `streamText`
   handles multi-step tool execution internally. The processor just observes
   events. This means a single "turn" can contain multiple LLM
   request-response cycles.

3. **Permission as a blocking promise**: Tool permission checks block the tool's
   `execute()` function with an unresolved Promise. The UI publishes a
   `permission.asked` event, and the Promise resolves when the user replies.
   This keeps the tool code synchronous-looking while supporting async user
   interaction.

4. **Compaction as a message**: Compaction requests are stored as message parts
   (`CompactionPart`), not as out-of-band state. This means the outer loop
   discovers them naturally on the next iteration by scanning messages.

5. **Pruning is separate from compaction**: Pruning (clearing old tool outputs)
   happens post-loop and is purely a storage optimisation. Compaction (LLM
   summarisation) is a context-window management strategy that creates a new
   summary message.

6. **Last-rule-wins permissions**: Permission rules are evaluated by finding the
   last matching rule in the merged ruleset. This allows user overrides to
   always take precedence over defaults by appearing later in the array.

7. **State stored in message parts**: The entire conversation state is
   reconstructable from messages and their parts. There's no separate "turn
   state" or "tool execution state" outside of what's persisted in storage.
   This makes the system resilient to crashes — on restart, the loop can
   resume by reading messages.
