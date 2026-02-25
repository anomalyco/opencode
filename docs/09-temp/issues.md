# OpenCode — Parallel Agent & Retry Storm Issues

> **Created**: 2025-02-25  
> **Source**: Combined RCA by Cline + Antigravity  
> **Status**: Approved for implementation

---

## Issue #1: `processor-max-retries` — Infinite Retry Loop in processor.ts

### Priority: P0 — Stop The Bleeding

### What is the issue?
The session processor retries failed API calls in an infinite `while(true)` loop with **no maximum retry count**. When an error is classified as "retryable" by `retry.ts`, the processor will retry it forever — user observed **2,244 identical retries over 3.5 hours** before manual abort.

### What is the bug?
`packages/opencode/src/session/processor.ts` line ~53 has a `while(true)` loop. When the catch block determines an error is retryable via `SessionRetry.retryable(error)`, it increments `attempt` and `continue`s the loop. There is **no guard** like `if (attempt >= MAX_RETRIES) break`.

### Where it can happen?
- Any API call that returns a retryable error (transient network issues, rate limits, Bedrock context overflow misclassified as retryable)
- Most critically: Bedrock "prompt is too long" errors that get misclassified as retryable by the catch-all in `retry.ts` (see Issue #2)
- Affects both parent sessions and subagent sessions independently

### What any agent needs to look for?
```
File: packages/opencode/src/session/processor.ts
Location: The while(true) loop (~line 53)
Pattern: Look for the catch block that calls SessionRetry.retryable() and does `continue`
```

### How to make the fix?
Add a `MAX_RETRIES` constant and guard before the `continue`:

```typescript
// At top of file or inside the function
const MAX_RETRIES = 10

// Inside the catch block, before `continue`:
if (attempt >= MAX_RETRIES) {
  input.assistantMessage.error = {
    name: "RetryLimitExceeded",
    message: `Maximum retries (${MAX_RETRIES}) exceeded. Last error: ${retry}`,
  }
  break
}
```

The error should be stored on `input.assistantMessage.error` so the session stops and the UI shows the error. Make sure the status is set to idle after breaking.

### Testing
- Trigger a retryable error (e.g., rate limit) and verify it stops after 10 attempts
- Verify the error message appears in the session UI
- Verify the session status returns to "idle" (not stuck in "retry")

---

## Issue #2: `bedrock-undefined-message` — error.ts Fails to Parse Bedrock Error Messages

### Priority: P0 — Stop The Bleeding

### What is the issue?
When Amazon Bedrock returns an API error (e.g., "prompt is too long"), the `message()` function in `error.ts` receives `e.message = "undefined"` (the literal string, not the JS undefined value). The function only checks for empty string `""`, so it passes `"undefined"` through to `isOverflow()`, which fails to match any overflow pattern. This means **Bedrock context overflow errors are never detected as overflow**, preventing compaction from triggering.

### What is the bug?
`packages/opencode/src/provider/error.ts` function `message()` (~line 50-80):
```typescript
const msg = e.message
if (msg === "") {
  if (e.responseBody) return e.responseBody
  // ...
}
```
When Bedrock SDK sets `e.message` to the literal string `"undefined"`, this check passes through. The actual error details are in `e.responseBody` but never extracted.

### Where it can happen?
- Any Bedrock API call that returns an error (context overflow, validation errors, throttling)
- The Bedrock SDK wraps errors differently than the Anthropic direct SDK
- Specifically observed with "prompt is too long: 208845 tokens > 200000 maximum" errors

### What any agent needs to look for?
```
File: packages/opencode/src/provider/error.ts
Location: The message() function, specifically the `if (msg === "")` check
Also check: isOverflow() function and the OVERFLOW_PATTERNS regex
```

### How to make the fix?
Extend the empty-message check to also handle `"undefined"`:

```typescript
function message(providerID: string, e: APICallError) {
  return iife(() => {
    const msg = e.message
    if (msg === "" || msg === "undefined") {
      if (e.responseBody) return e.responseBody
      // ... rest of existing fallback logic
    }
    return msg
  })
}
```

This ensures the actual error body (which contains "prompt is too long") is used for overflow detection instead of the meaningless `"undefined"` string.

### Testing
- Mock a Bedrock APICallError with `message: "undefined"` and `responseBody: "prompt is too long: 208845 tokens > 200000 maximum"`
- Verify `message()` returns the responseBody, not `"undefined"`
- Verify `isOverflow()` correctly detects the overflow pattern from the responseBody

---

## Issue #3: `task-swallows-errors` — task.ts Silently Swallows Subagent Failures

### Priority: P0 — Stop The Bleeding

### What is the issue?
When a subagent (child session spawned by the `task` tool) fails with an error, the parent session shows it as **successfully completed with empty output**. The user sees a green ✅ checkmark for a task that actually errored. This is THE primary cause of "failures not reflected in main chat."

### What is the bug?
`packages/opencode/src/tool/task.ts` line ~145:
```typescript
const result = await SessionPrompt.prompt({...})
const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
```

`result.info` contains an `.error` field when the child session errored (set by `processor.ts` at `input.assistantMessage.error = error`). But `task.ts` **never checks `result.info.error`** — it only looks for text parts. When the child errored, there are no text parts, so `text = ""`, and the parent receives `<task_result>\n\n</task_result>` as a "successful" empty result.

### Where it can happen?
- Any subagent failure: context overflow, API error, tool execution error, rate limit
- Parallel subagents: if 1 of 3 subagents fails, parent sees 3 "completed" tasks with one having empty output
- The parent LLM may then hallucinate that the task completed or silently move on

### What any agent needs to look for?
```
File: packages/opencode/src/tool/task.ts
Location: After the `SessionPrompt.prompt()` call, before building the output
Pattern: result.info should have an error field — check result.info type definition
Also check: packages/opencode/src/session/prompt.ts for the return type of prompt()
```

### How to make the fix?
Add an error check immediately after the `SessionPrompt.prompt()` call:

```typescript
const result = await SessionPrompt.prompt({...})

// Check if child session errored
if (result.info.error) {
  const error = result.info.error
  const msg = error.message ?? error.name ?? "Subagent task failed"
  return {
    title: params.description,
    metadata: { sessionId: session.id, model },
    output: [
      `task_id: ${session.id}`,
      "",
      "<task_result>",
      `ERROR: ${msg}`,
      `The subtask encountered an error and could not complete.`,
      "</task_result>",
    ].join("\n"),
  }
}

const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
```

**Important**: Check the actual type of `result.info` to use proper typing instead of `(result.info as any).error`. Look at how `processor.ts` sets the error on `input.assistantMessage.error` to understand the shape.

### Testing
- Trigger a subagent error (e.g., invalid tool call, context overflow)
- Verify the parent session shows "ERROR: ..." in the task result, not empty
- Verify the parent LLM receives the error and can report it to the user

---

## Issue #4: `bedrock-context-cap` — Bedrock Provider Missing Context Limit Override

### Priority: P0 — This Sprint

### What is the issue?
The `models-snapshot.ts` file (auto-generated from models.dev) lists Claude Opus 4.6 on Bedrock with `context: 1,000,000`. This is the model's capability WITH the `context-1m` beta header. However, the Bedrock provider handler in `provider.ts` **never sends the 1M beta header**, so Bedrock actually enforces a 200K limit. The result: UI shows "20% context usage" when the user is actually at 100% of the real limit, and compaction never triggers.

### What is the bug?
Two bugs combine:

1. **`models-snapshot.ts`** lists Opus 4.6 Bedrock models at 1M context (reflects model capability, not runtime limit)
2. **`provider.ts`** `"amazon-bedrock"` handler has NO logic to:
   - Send `additionalModelRequestFields: { anthropic_beta: ["context-1m-2025-08-07"] }` to enable 1M
   - Override the context limit to 200K when 1M beta is NOT active

**Affected models in snapshot**:
```
amazon-bedrock / anthropic.claude-opus-4-6-v1:          context=1,000,000 ❌
amazon-bedrock / us.anthropic.claude-opus-4-6-v1:       context=1,000,000 ❌  
amazon-bedrock / eu.anthropic.claude-opus-4-6-v1:       context=1,000,000 ❌
amazon-bedrock / global.anthropic.claude-opus-4-6-v1:   context=1,000,000 ❌
```

All other Bedrock Claude models correctly show 200K.

### Where it can happen?
- Any user running Claude Opus 4.6 via Amazon Bedrock
- Compaction threshold is calculated from `model.limit.context` → 1M → threshold ~900K
- Bedrock rejects at 200K → 700K token gap where compaction never fires but API always rejects
- Combined with Issue #1 (infinite retries), this causes the 3.5-hour freeze

### What any agent needs to look for?
```
File: packages/opencode/src/provider/provider.ts
Location: The "amazon-bedrock" entry in CUSTOM_LOADERS (~line 211)
Pattern: The returned object has options (providerOptions) and getModel() but NO context limit override
Also: Look at how compaction.ts uses model.limit.context (~line 33)
Also: Look at how Cline handles this — they use additionalModelRequestFields for Bedrock

DO NOT edit models-snapshot.ts directly — it is auto-generated by build.ts
```

### How to make the fix?
**Option A (Recommended)**: Add provider-level context limit override in the model resolution logic. When provider is "amazon-bedrock" and model is Claude, cap context at 200K unless a 1M configuration is explicitly enabled.

Look at where models are resolved and limits are applied. The fix should go in `provider.ts` where models are loaded/resolved, adding a context limit override:

```typescript
// Inside amazon-bedrock handler or model resolution
if (providerID === "amazon-bedrock" && modelData.limit?.context > 200000) {
  // Cap at 200K unless 1M beta is explicitly configured
  modelData.limit.context = 200000
}
```

**Option B (Future)**: Implement Cline's `:1m` suffix pattern — user explicitly opts into 1M context, which triggers adding `anthropic_beta: ["context-1m-2025-08-07"]` via `additionalModelRequestFields`.

### Testing
- Configure Bedrock with Opus 4.6
- Verify UI shows context limit as 200K (not 1M)
- Verify compaction triggers before hitting Bedrock's actual 200K limit
- Verify no "prompt is too long" errors during normal usage

---

## Issue #5: `subagent-timeout` — task.ts Has No Execution Timeout

### Priority: P0 — This Sprint

### What is the issue?
The `task` tool calls `SessionPrompt.prompt()` with **no timeout or deadline**. If a subagent gets stuck (infinite retry storm, permission hang, or any other blocking issue), the parent tool call never resolves. The parent session appears frozen with a spinning "running" indicator forever.

### What is the bug?
`packages/opencode/src/tool/task.ts`:
```typescript
const result = await SessionPrompt.prompt({
  messageID,
  sessionID: session.id,
  model: { modelID: model.modelID, providerID: model.providerID },
  agent: agent.name,
  tools: { ... },
  parts: promptParts,
})
// ← No timeout wrapper, no AbortController deadline
```

This Promise can hang indefinitely if the child session encounters:
- Infinite retry loop (Issue #1 before fix)
- Permission hang (Issue #6)
- Slow API responses that never complete

### Where it can happen?
- Any subagent execution, but especially:
  - When subagent hits context overflow with retries
  - When subagent needs permission and user is watching parent
  - When API provider is slow or unresponsive

### What any agent needs to look for?
```
File: packages/opencode/src/tool/task.ts
Location: The SessionPrompt.prompt() call
Pattern: Check if there's an AbortSignal or timeout mechanism available
Also check: How the abort signal flows from processor.ts → tool execution → task.ts
Also check: ctx parameter in execute() — does it carry an abort signal?
```

### How to make the fix?
Wrap the `SessionPrompt.prompt()` call with an AbortController timeout:

```typescript
const timeout = 5 * 60 * 1000 // 5 minutes (configurable)
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), timeout)

try {
  const result = await SessionPrompt.prompt({
    // ... existing params ...
    abort: controller.signal, // Pass abort signal if prompt() supports it
  })
  clearTimeout(timer)
  // ... process result ...
} catch (e) {
  clearTimeout(timer)
  if (controller.signal.aborted) {
    return {
      title: params.description,
      metadata: { sessionId: session.id, model },
      output: `ERROR: Subtask timed out after ${timeout / 1000}s. The task may still be running in session ${session.id}.`,
    }
  }
  throw e
}
```

Check if `SessionPrompt.prompt()` already accepts an `abort` parameter. If not, trace how `processor.ts` passes its abort signal and ensure the plumbing exists.

### Testing
- Trigger a subagent that would hang (e.g., long-running task)
- Verify it times out after the configured deadline
- Verify the parent receives a timeout error message, not silent hang
- Verify the child session is properly cleaned up

---

## Issue #6: `permission-abort` — next.ts Permission Promises Hang Forever in Subagents

### Priority: P0 — This Sprint

### What is the issue?
When a subagent's tool requires permission (e.g., file write, command execution), the permission prompt appears **only in the child session**. If the user is watching the parent session, they never see the prompt. The child session hangs forever waiting for permission, which blocks the parent's tool call.

### What is the bug?
`packages/opencode/src/permission/next.ts` lines ~143-156:
```typescript
export function ask(input: AskInput) {
  return new Promise<void>((resolve, reject) => {
    // ... sets up permission request ...
    // NO abort signal listener
    // NO timeout
    // Promise resolves only when user explicitly grants/denies
  })
}
```

`grep -c "abort" next.ts` returns **0** — there is zero abort signal awareness in the entire file.

### Where it can happen?
- Any subagent tool call that requires permission
- Parallel subagents: one hangs on permission → parent hangs → all other parallel results blocked
- Even with auto-approve policies, edge cases (new tools, destructive operations) may still prompt

### What any agent needs to look for?
```
File: packages/opencode/src/permission/next.ts
Location: The ask() function (exported, ~line 143)
Pattern: The Promise constructor — no abort/timeout handling
Also check: How ask() is called from tool execution context
Also check: Whether an AbortSignal is available in the call chain
Also check: packages/opencode/src/session/prompt.ts for where permissions are requested
```

### How to make the fix?
Add AbortSignal support to the `ask()` function:

```typescript
export function ask(input: AskInput & { abort?: AbortSignal }) {
  return new Promise<void>((resolve, reject) => {
    // Check if already aborted
    if (input.abort?.aborted) {
      return reject(new Error("Permission request aborted"))
    }
    
    // Listen for abort
    const onAbort = () => {
      reject(new Error("Permission request aborted"))
    }
    input.abort?.addEventListener("abort", onAbort, { once: true })
    
    // ... existing permission logic ...
    // Clean up abort listener in resolve/reject paths
  })
}
```

**Important**: The abort signal must be plumbed from `processor.ts` through the tool execution chain to `next.ts`. Trace the call path:
```
processor.ts (has abort) → tool execution → specific tool → permission check → next.ts ask()
```

### Testing
- Trigger a subagent that needs permission
- Abort the parent session while permission is pending
- Verify the child permission promise rejects
- Verify the parent tool call resolves with an error (not hangs forever)

---

## Issue #7: `retry-catch-all` — retry.ts Catch-All Makes All JSON Errors Retryable

### Priority: P1 — Robustness

### What is the issue?
The `retryable()` function in `retry.ts` has a catch-all at line ~96 that makes **any error with a parseable JSON response body** retryable. This means Bedrock 400 errors ("prompt is too long"), which should NOT be retried, get classified as retryable — fueling the infinite retry storm.

### What is the bug?
`packages/opencode/src/session/retry.ts` line ~96:
```typescript
// After checking specific patterns (rate limit, overloaded, etc.)...
return JSON.stringify(json) // ← ANY remaining JSON error = retryable
```

The Bedrock "prompt is too long" error response is valid JSON with `"isRetryable": false` in the body, but the catch-all ignores this field and returns the body as a retryable error message.

### Where it can happen?
- Any API error that returns a JSON response body
- Specifically: Bedrock validation errors (400), authentication errors, quota errors
- Combined with Issue #1 (no max retries), this creates infinite retry storms

### What any agent needs to look for?
```
File: packages/opencode/src/session/retry.ts
Location: The retryable() function, specifically the catch-all after all pattern checks
Pattern: The final `return JSON.stringify(json)` that runs for any unmatched JSON error
Also check: What specific patterns ARE checked before the catch-all
Also check: Whether the JSON body contains "isRetryable" or HTTP status fields
```

### How to make the fix?
Replace the blanket catch-all with HTTP status-aware classification:

```typescript
// Instead of: return JSON.stringify(json)
// Use:
const status = (json as any).status ?? (json as any).statusCode
if (typeof status === "number" && status >= 400 && status < 500) {
  // 4xx errors are client errors — NOT retryable (bad request, auth, not found, etc.)
  return undefined
}
// 5xx and truly unknown → retryable (but capped by MAX_RETRIES from Issue #1)
return JSON.stringify(json)
```

Also check for the `isRetryable` field that Bedrock includes:
```typescript
if ((json as any).isRetryable === false) return undefined
```

**Note**: This fix is SAFER when combined with Issue #1 (MAX_RETRIES), since any misclassification is bounded by the retry cap.

### Testing
- Send a Bedrock 400 "prompt is too long" error → verify NOT retried
- Send a 429 rate limit error → verify IS retried
- Send a 500 server error → verify IS retried (up to MAX_RETRIES)
- Send a JSON error with `isRetryable: false` → verify NOT retried

---

## Issue #8: `tool-error-metadata` — processor.ts Drops Metadata on Tool Errors

### Priority: P1 — Robustness

### What is the issue?
When a tool execution errors, the tool-error handler in `processor.ts` rebuilds the tool state but **drops the `title` and `metadata` fields**. This means the UI loses the tool's display name and any navigation metadata (like `sessionId` for subagent links).

### What is the bug?
`packages/opencode/src/session/processor.ts` lines ~207-218, the `"tool-error"` case:
```typescript
case "tool-error": {
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "error",
        input: value.input ?? match.state.input,
        error: (value.error as any).toString(),
        // ❌ Missing: title: match.state.title,
        // ❌ Missing: metadata: match.state.metadata,
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
      },
    })
  }
}
```

### Where it can happen?
- Any tool that errors during execution
- Most visible for task tool errors — the `sessionId` metadata (used for navigating to child sessions) is lost
- Also affects batch tool parts and any tool with custom title/metadata

### What any agent needs to look for?
```
File: packages/opencode/src/session/processor.ts
Location: The "tool-error" case in the stream event handler
Pattern: Compare the "tool-error" state update with the "tool-result" state update
The "tool-result" case preserves title and metadata, but "tool-error" does not
```

### How to make the fix?
Add `title` and `metadata` preservation to the error state:

```typescript
case "tool-error": {
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "error",
        input: value.input ?? match.state.input,
        error: (value.error as any).toString(),
        title: match.state.title,         // ← ADD
        metadata: match.state.metadata,   // ← ADD
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
      },
    })
  }
}
```

### Testing
- Trigger a tool error (e.g., file read on non-existent path)
- Verify the error part in the UI shows the tool title
- Trigger a subagent error → verify the sessionId metadata is preserved in the error part

---

## Issue #9: `batch-error-details` — batch.ts Output Lacks Per-Tool Error Details

### Priority: P2 — Nice to Have

### What is the issue?
When batch tool calls fail, the output summary only says `"Executed X/Y tools successfully. Z failed."` without including **which tools failed or why**. The LLM receiving this output cannot diagnose or intelligently retry the failures.

### What is the bug?
`packages/opencode/src/tool/batch.ts` output message:
```typescript
const outputMessage = failedCalls > 0
  ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
  : `All ${successfulCalls} tools executed successfully.`
```

Note: Individual tool-call parts ARE written to the database with their errors (via `Session.updatePart` in the catch block), so the UI shows them. But the **summary message returned to the LLM** lacks details.

### Where it can happen?
- Any batch execution where one or more tools fail
- The LLM sees the summary but not the individual error details
- Can cause the LLM to blindly retry the same failing operations

### What any agent needs to look for?
```
File: packages/opencode/src/tool/batch.ts
Location: The outputMessage construction after Promise.all results
Pattern: The results array has { success, tool, error? } for each call
```

### How to make the fix?
Include per-tool error details in the output:

```typescript
const outputMessage = failedCalls > 0
  ? [
      `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`,
      "",
      "Failed tools:",
      ...results
        .filter((r) => !r.success)
        .map((r) => `- ${r.tool}: ${r.error instanceof Error ? r.error.message : String(r.error)}`),
    ].join("\n")
  : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`
```

### Testing
- Execute a batch with one intentionally failing tool (e.g., read non-existent file)
- Verify the output includes the tool name and error message
- Verify the LLM can see which tool failed and why

---

## Implementation Order

```
✅ DONE — Commit 3670d5f2f:
  #1  processor-max-retries     → MAX_RETRIES=10 cap
  #2  bedrock-undefined-message → "undefined" → responseBody fallback
  #3  task-swallows-errors      → result.info.error check in task.ts
  #8  tool-error-metadata       → metadata preserved on tool-error

✅ DONE — Commit a8758b20f:
  #4  bedrock-context-cap       → 200K cap in both fromModelsDevModel + config path
  #7  retry-catch-all           → isRetryable:false + 4xx status guards
  #9  batch-error-details       → per-tool error details in output

REMAINING (P0 — Needs deep plumbing):
  #5  subagent-timeout          → Hung subagent prevention
  #6  permission-abort          → Permission hang prevention
```
