# Systematic Root-Cause Analysis: Roo Code Orphaned `tool_use` Error

## Phase 1: Root Cause Investigation

### 1.1 The Error (Read Carefully)

```
messages.12: `tool_use` ids were found without `tool_result` blocks immediately after:
  tooluse_gcKGmk7V7opjkl8G2V6v0N, tooluse_ldg9S86J2GK8UzcQqvOQXR.
Each `tool_use` block must have a corresponding `tool_result` block in the next message.
```

**What this tells us precisely:**

| Fact                                                 | Implication                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `messages.12`                                        | The **13th message** (0-indexed) in the conversation array is the problem         |
| Two IDs: `tooluse_gcKG…`, `tooluse_ldg9…`            | The assistant called **exactly 2 tools** in that turn                             |
| "without `tool_result` blocks **immediately after**" | Message 13 (the next user message) does NOT contain matching `tool_result` blocks |
| Cost `$0.0000`                                       | API rejects the request **before** processing — this is a pre-validation error    |
| First attempt at 7%, $1.61 spent                     | **~6 successful API round-trips** happened before this (at ~$0.25/turn)           |
| IDs start with `tooluse_`                            | This is Anthropic's native tool calling format (not OpenAI-style `call_*`)        |

### 1.2 Reproducing the Scenario

**User's task:** "Create a latest DMG for me, before that redesign the SVG for the app icon. Use Skill UI UX Pro Max."

This task would trigger the following tool sequence:

1. **read_file** — Read existing SVG icon file(s)
2. **list_files** — Scan project structure for icon locations
3. **write_to_file** — Write new SVG design
4. **execute_command** — Build/package DMG

The **"Use Skill UI UX Pro Max"** instruction is key — it tells the assistant to use a custom mode/skill, which could trigger a **`switch_mode`** or **`skill`** tool call alongside regular tools.

At the point of failure (message 12, ~7% progress, $1.61), the assistant would have been in the early **file reading/scanning phase**, likely calling 2 tools in parallel.

### 1.3 Backward Trace: From Error to Root Cause

```
Error received by: Anthropic API server
  ↑ Sent by: this.api.createMessage() at Task.ts:4271
    ↑ Built from: cleanConversationHistory at Task.ts:4193
      ↑ Derived from: effectiveHistory → mergedForApi → messagesWithoutImages
        ↑ Sourced from: this.apiConversationHistory (the persistent storage)
          ↑ CORRUPTED HERE: message 12 has tool_use but message 13 lacks tool_result
```

**The question is: HOW did message 13 get saved without the tool_results?**

There are exactly 3 code paths that save user messages with `tool_result` blocks:

#### Path A: Normal tool execution flow (`recursivelyMakeClineRequests`)

```
Task.ts:3542  → Save assistant message (with tool_use blocks)
Task.ts:3561  → presentAssistantMessage(this) → executes tools → pushToolResult()
Task.ts:3581  → pWaitFor(() => this.userMessageContentReady)
Task.ts:2651  → addToApiConversationHistory({ role: "user", content: finalUserContent })
```

In this path, `finalUserContent` at line 2641 includes `this.userMessageContent` which is populated by `pushToolResult` during tool execution. The `pWaitFor` at 3581 blocks until all tools complete.

**Could this path lose tool_results?** → Only if `presentAssistantMessage` fails to call `pushToolResult`.

#### Path B: `flushPendingToolResultsToHistory()` (delegation via `new_task`)

```
Task.ts:1048  → Check userMessageContent.length > 0
Task.ts:1067  → Wait for assistantMessageSavedToHistory (30s timeout)
Task.ts:1085  → Build user message from this.userMessageContent
Task.ts:1096  → Push to apiConversationHistory
```

**Could this path lose tool_results?** → Yes, if abort/timeout triggers.

#### Path C: Task resume (`resumeTaskFromHistory`)

```
Task.ts:2109-2117  → Generate placeholder tool_results for all tool_use blocks
Task.ts:2142-2159  → Find missing tool_results and fill them in
Task.ts:2217       → overwriteApiConversationHistory(modifiedApiConversationHistory)
```

**Could this path lose tool_results?** → No, it explicitly generates them.

---

### 1.4 The Root Cause: `presentAssistantMessage` + `AskIgnoredError` = Silent Failure

Here is the critical code path that causes the corruption:

#### Step 1: Stream completes, assistant has 2 tool_use blocks

At [`Task.ts:3542`](references/Roo-Code/src/core/task/Task.ts:3542):

```ts
await this.addToApiConversationHistory(
  { role: "assistant", content: assistantContent }, // Contains 2 tool_use blocks
  reasoningMessage || undefined,
)
this.assistantMessageSavedToHistory = true // ← message 12 is now persisted
```

#### Step 2: Tools begin executing via `presentAssistantMessage`

At [`presentAssistantMessage.ts:61`](references/Roo-Code/src/core/assistant-message/presentAssistantMessage.ts:61), the function is called to process each tool_use block. Each tool handler calls `askApproval()` which internally calls `cline.ask()`.

#### Step 3: `ask()` throws `AskIgnoredError` — the silent killer

At [`Task.ts:1304`](references/Roo-Code/src/core/task/Task.ts:1304):

```ts
throw new AskIgnoredError("updating existing partial")
```

And at [`Task.ts:1312`](references/Roo-Code/src/core/task/Task.ts:1312):

```ts
throw new AskIgnoredError("new partial")
```

This error is thrown when:

- A tool starts streaming its approval request as a partial message
- Another partial update comes in before the user responds
- The earlier ask is **silently abandoned**

#### Step 4: `handleError` catches `AskIgnoredError` but DOES NOTHING

At [`presentAssistantMessage.ts:540-544`](references/Roo-Code/src/core/assistant-message/presentAssistantMessage.ts:540):

```ts
const handleError = async (action: string, error: Error) => {
  // Silently ignore AskIgnoredError - this is an internal control flow
  // signal, not an actual error.
  if (error instanceof AskIgnoredError) {
    return // ← NO tool_result pushed! Silent return!
  }
  // ...
  pushToolResult(formatResponse.toolError(errorString))
}
```

**THIS IS THE BUG.**

When `AskIgnoredError` is caught:

- `pushToolResult()` is **never called**
- `hasToolResult` remains `false`
- The `tool_use` block has **no corresponding `tool_result`**
- But the tool handler returns normally (no re-throw)

#### Step 5: The loop continues, user message gets saved incomplete

After `presentAssistantMessage` completes all blocks:

- `userMessageContentReady` is set to `true`
- The `pWaitFor` at [`Task.ts:3581`](references/Roo-Code/src/core/task/Task.ts:3581) resolves
- The user message is saved at [`Task.ts:2651`](references/Roo-Code/src/core/task/Task.ts:2651) with **1 out of 2 tool_results** (or 0 out of 2)
- The `validateAndFixToolResultIds` at [`Task.ts:1016`](references/Roo-Code/src/core/task/Task.ts:1016) SHOULD catch this...

#### Step 6: But wait — does `validateAndFixToolResultIds` catch it?

At [`validateToolResultIds.ts:118-121`](references/Roo-Code/src/core/task/validateToolResultIds.ts:118):

```ts
const missingToolUseIds = toolUseBlocks
  .filter((toolUse) => !existingToolResultIds.has(toolUse.id))
  .map((toolUse) => toolUse.id)
```

Yes, it detects the missing IDs. And at line 220-228:

```ts
const missingToolResults = stillMissingToolUseIds.map((toolUse) => ({
  type: "tool_result" as const,
  tool_use_id: toolUse.id,
  content: "Tool execution was interrupted before completion.",
}))
const finalContent = missingToolResults.length > 0 ? [...missingToolResults, ...correctedContent] : correctedContent
```

**It injects placeholder tool_results!** So... why does the error still happen?

#### Step 7: THE REAL BUG — `askApproval` catches `AskIgnoredError` but the tool handler itself ALSO throws it

Look at the tool handler flow more carefully. The `askApproval` function at [`presentAssistantMessage.ts:494-529`](references/Roo-Code/src/core/assistant-message/presentAssistantMessage.ts:494) calls `cline.ask()`. If `ask()` throws `AskIgnoredError`, it **propagates up through `askApproval`**:

```ts
const askApproval = async (...) => {
  const { response, text, images } = await cline.ask(type, ...) // ← throws AskIgnoredError!
  // code below never executes
}
```

The `AskIgnoredError` escapes `askApproval`, enters the tool handler (e.g., `readFileTool.handle()`), which catches it through `handleError`:

```ts
// Inside a tool handler like readFileTool:
try {
  const approved = await askApproval("tool", ...)  // ← AskIgnoredError thrown here
  // never reaches pushToolResult()
} catch (error) {
  await handleError("reading file", error)  // ← silently returns for AskIgnoredError
}
```

After `handleError` silently returns:

- **No `tool_result` was pushed**
- The tool handler returns normally
- `presentAssistantMessage` moves to the next block

**But this should be caught by `validateAndFixToolResultIds`...** unless there's a timing issue.

#### Step 8: THE ACTUAL ROOT CAUSE — The AskIgnoredError is thrown DURING tool approval streaming, which happens DURING the API response stream

The key insight is **when** this happens:

1. The API response is still streaming (`didCompleteReadingStream = false`)
2. `presentAssistantMessage` is called to present tool #1 (partial)
3. Tool #1 calls `askApproval(type, partialMessage, progressStatus)` with `partial=true`
4. `ask()` throws `AskIgnoredError("new partial")` for the first partial
5. `handleError` silently ignores it — **no tool_result pushed**
6. `presentAssistantMessage` unlocks at line 933 and returns
7. Stream continues, tool #1 becomes complete (non-partial)
8. `presentAssistantMessage` is called again
9. **But now `cline.currentStreamingContentIndex` has already been incremented at line 957**
10. The complete version of tool #1 is **SKIPPED** — it was "already presented" as partial
11. Tool #2 is presented and executed
12. Tool #2's `tool_result` IS pushed

So the final user message has: `[tool_result for tool #2]` but NOT `[tool_result for tool #1]`.

**WAIT** — let me re-read line 940 more carefully:

```ts
if (!block.partial || cline.didRejectTool || cline.didAlreadyUseTool) {
```

This only advances the index when `!block.partial`. A partial block does NOT advance the index. So tool #1 partial → `AskIgnoredError` → returns WITHOUT advancing index → tool #1 complete → presented again → should work.

Let me trace more carefully...

#### Step 8 (Revised): The REAL root cause — `AskIgnoredError` thrown for a NON-PARTIAL tool

The `AskIgnoredError` can be thrown even for non-partial asks. Look at [`Task.ts:1474-1476`](references/Roo-Code/src/core/task/Task.ts:1474):

```ts
throw new AskIgnoredError("superseded")
```

This happens when `this.lastMessageTs !== askTs` — meaning **another ask was created while this one was pending**. This is the "superseded" case.

**Scenario for 2 parallel tools:**

1. Stream completes with 2 tool_use blocks: `[tool_A, tool_B]`
2. `presentAssistantMessage` processes tool_A (complete, non-partial)
3. tool_A calls `askApproval("tool", ...)` → calls `cline.ask("tool", ...)`
4. `ask()` creates a new ClineMessage with `askTs = Date.now()`
5. `ask()` reaches `pWaitFor` at line 1444, waiting for user response
6. **Auto-approval kicks in** at line 1368 → `this.approveAsk()` → sets `askResponse`
7. `pWaitFor` resolves → `ask()` returns → tool_A executes → `pushToolResult()` ✓
8. `presentAssistantMessage` increments index to tool_B
9. tool_B calls `askApproval("tool", ...)` → calls `cline.ask("tool", ...)`
10. This works normally too. ✓

So parallel tools in sequence shouldn't cause the issue with auto-approval. BUT:

#### Step 8 (Final): The TRUE root cause — Mid-stream crash between assistant save and tool execution

Let me look at the exception handler at [`Task.ts:3722-3729`](references/Roo-Code/src/core/task/Task.ts:3722):

```ts
} catch (error) {
  // This should never happen since the only thing that can throw an
  // error is the attemptApiRequest, which is wrapped in a try catch
  // that sends an ask where if noButtonClicked, will clear current
  // task and destroy this instance.
  return true // Needs to be true so parent loop knows to end task.
}
```

And the `presentAssistantMessage` at line 62-64:

```ts
if (cline.abort) {
  throw new Error(`[Task#presentAssistantMessage] task ... aborted`)
}
```

**HERE IS THE ACTUAL ROOT CAUSE:**

1. Assistant message with 2 `tool_use` blocks is saved to history (line 3542) ← **message 12**
2. `this.assistantMessageSavedToHistory = true` (line 3546)
3. `presentAssistantMessage(this)` is called (line 3561) to present partial blocks
4. During tool execution, **`cline.abort` gets set to `true`** (user cancels, or error, or timeout)
5. `presentAssistantMessage` throws at line 63: `throw new Error("...aborted")`
6. This throw propagates up through the tool execution
7. **`pushToolResult` was never called for either tool**
8. The error reaches the `catch` at Task.ts:3722
9. It returns `true` — task ends
10. **BUT message 12 (assistant with 2 tool_use blocks) is ALREADY in the persistent history**
11. **No user message with tool_results was ever saved as message 13**

When the user resumes the task:

- `resumeTaskFromHistory` at Task.ts:2090+ checks the LAST message
- If the last message is the assistant with tool_use, it generates placeholders → **works**
- But if other messages were appended AFTER message 12 before the abort (e.g., error messages, api_req_started), the last message is NOT message 12
- The resume logic only fixes the last assistant-user pair, not arbitrary positions

**The corruption is permanent.**

---

## Phase 2: Pattern Analysis

### Working example

When `abort` is NOT set during tool execution:

1. All tools execute normally
2. All `pushToolResult()` calls complete
3. `userMessageContent` has all `tool_result` blocks
4. User message saved with all results → ✓

### Broken example (this bug)

When `abort` IS set during tool execution (e.g., user clicks cancel, network timeout, extension deactivation):

1. Some tools may have executed, others not
2. `presentAssistantMessage` throws on abort check
3. `userMessageContent` has partial or zero `tool_result` blocks
4. User message is NEVER saved (abort exits the loop)
5. But assistant message with `tool_use` blocks is ALREADY saved → ✗

### The key difference

The **assistant message is saved BEFORE tool execution** (line 3542), but the **user message with tool_results is saved AFTER all tools complete** (line 2651). Any interruption between these two writes creates an orphaned `tool_use`.

---

## Phase 3: Hypothesis

**Hypothesis:** The root cause is that aborting/cancelling a task between the assistant message save (Task.ts:3542) and the user message save (Task.ts:2651) leaves the API conversation history in an invalid state where an assistant message has `tool_use` blocks without a following `tool_result` message. The `validateAndFixToolResultIds` safety net only runs at write-time for new messages, not as a pre-flight check before API calls, so the corruption is never repaired on retry.

**Evidence supporting this:**

1. Error occurs at a fixed position (`messages.12`) — consistent with a single write of assistant message followed by no user message write
2. Two tool_use IDs — consistent with a multi-tool call that was interrupted
3. Task was at 7% progress — early in execution, tools were still being called
4. The error is **permanent** — every retry hits the same corrupted history because no code path repairs it
5. Roo Code explicitly has comments about this risk in the codebase (lines 3401-3404, 1054-1057)

---

## Phase 4: Proposed Fix

### Fix 1: Pre-flight history validation in `attemptApiRequest`

At [`Task.ts:4193`](references/Roo-Code/src/core/task/Task.ts:4193), after building `cleanConversationHistory`, add:

```ts
// Repair orphaned tool_use blocks before sending to API
for (let i = 0; i < cleanConversationHistory.length - 1; i++) {
  const msg = cleanConversationHistory[i]
  const next = cleanConversationHistory[i + 1]

  if (msg.role !== "assistant") continue

  const content = Array.isArray(msg.content) ? msg.content : []
  const toolUseBlocks = content.filter((b) => b.type === "tool_use")
  if (toolUseBlocks.length === 0) continue

  if (next.role !== "user") {
    // Insert a synthetic user message with tool_results
    const toolResults = toolUseBlocks.map((t) => ({
      type: "tool_result",
      tool_use_id: t.id,
      content: "Tool execution was interrupted.",
    }))
    cleanConversationHistory.splice(i + 1, 0, { role: "user", content: toolResults })
    continue
  }

  // Check if next user message has all required tool_results
  const nextContent = Array.isArray(next.content) ? next.content : []
  const resultIds = new Set(nextContent.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id))
  const missing = toolUseBlocks.filter((t) => !resultIds.has(t.id))

  if (missing.length > 0) {
    const repairs = missing.map((t) => ({
      type: "tool_result",
      tool_use_id: t.id,
      content: "Tool execution was interrupted.",
    }))
    next.content = [...repairs, ...nextContent]
  }
}
```

### Fix 2: Ensure abort saves partial tool_results

At [`Task.ts:3722`](references/Roo-Code/src/core/task/Task.ts:3722), before returning:

```ts
} catch (error) {
  // Save any accumulated tool_results to prevent orphaned tool_use blocks
  if (this.userMessageContent.length > 0) {
    await this.flushPendingToolResultsToHistory()
  }
  return true
}
```

### Fix 3: Detect and break the infinite retry loop

In `attemptApiRequest`'s error handler, detect this specific Anthropic error pattern and auto-repair:

```ts
if (error.message?.includes("tool_use` ids were found without `tool_result`")) {
  await this.repairOrphanedToolUseBlocks()
  yield * this.attemptApiRequest(retryAttempt + 1)
  return
}
```

---

## Summary

| Layer             | What happens                                                                                             | File:Line                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Trigger**       | User cancels task, or network drops, or abort signal fires                                               | `Task.ts:62-64`                                                                               |
| **Corruption**    | Assistant message (with `tool_use`) already saved, tool execution interrupted before `tool_result` saved | `Task.ts:3542` (save) → `Task.ts:3561` (execute) → abort before `Task.ts:2651` (save results) |
| **Missing guard** | `presentAssistantMessage` silently drops tool_results when `AskIgnoredError` or abort occurs             | `presentAssistantMessage.ts:225`, `543`                                                       |
| **No recovery**   | `validateAndFixToolResultIds` only runs at write-time, not pre-flight                                    | `Task.ts:1016`                                                                                |
| **Infinite loop** | `attemptApiRequest` retries with same corrupted history                                                  | `Task.ts:4337`                                                                                |
| **No escape**     | User must start a new session; no "repair history" option exists                                         | —                                                                                             |
