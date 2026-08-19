# ACP Elicitation for Questions

## Problem

The `question` tool can block indefinitely when opencode is used through ACP. The registered opencode tool currently uses the legacy question service and publishes `question.asked`; the core V2 question service publishes the equivalent `question.v2.asked` event. In both cases the tool creates a pending question request and then waits for the matching reply or reject.

ACP has the matching protocol concept: the agent can call `elicitation/create` on the client and wait for an accept, decline, or cancel response. The ACP adapter should bridge opencode's `QuestionV2` event to ACP elicitation and then settle the original question request.

## Current Shape

The core question path is:

```text
LLM tool call
  -> question tool execute
  -> QuestionV2.ask(...)
  -> publish question.asked or question.v2.asked
  -> wait for reply/reject
```

The app and desktop clients handle this by consuming question events, adapting V2 events to the existing app state shape when needed, rendering `SessionQuestionDock`, then calling the question HTTP API with the real request ID.

ACP already does a similar bridge for permissions:

```text
permission.asked
  -> connection.requestPermission(...)
  -> sdk.permission.reply(...)
```

Questions should follow the same pattern:

```text
question.asked / question.v2.asked
  -> connection.unstable_createElicitation(...)
  -> sdk.question.reply(...) or sdk.question.reject(...)
```

## Design

`packages/opencode/src/acp/event.ts` should treat `question.asked` as the current source of truth for ACP elicitation and should also handle `question.v2.asked` defensively for the core V2 path.

Do not derive elicitation from `message.part.updated` question tool parts. Tool parts describe projected transcript state; they do not carry the `QuestionV2` request ID needed to unblock the pending question. A tool part's `callID` is the model/tool call ID, not the question request ID.

The event contains both identities needed by the bridge:

- `event.properties.id`: the real question request ID. Use this for `sdk.question.reply` and `sdk.question.reject`.
- `event.properties.tool?.callID`: the originating tool call ID. Use this as ACP `toolCallId` when present.

The ACP event subscription should add handlers for both `question.asked` and `question.v2.asked`:

```text
on question.asked or question.v2.asked:
  find ACP session by event.properties.sessionID
  if session is unknown:
    return

  if the client did not advertise elicitation support:
    reject event.properties.id
    return

  if connection.unstable_createElicitation is unavailable:
    reject event.properties.id
    return

  call unstable_createElicitation({
    mode: "form",
    sessionId: event.properties.sessionID,
    toolCallId: event.properties.tool?.callID,
    message,
    requestedSchema,
  })

  if response.action is "accept":
    convert response.content to QuestionV2 answers
    reply event.properties.id
    return

  reject event.properties.id
```

`initialize` should record whether the ACP client advertised elicitation support. The bridge should not infer support only from method presence because the ACP SDK type may expose optional methods that a client did not negotiate.

## Schema Mapping

Each `QuestionV2.Info` should become one property in the ACP form schema.

Single-select question:

```text
type: "string"
title: question.header
description: question.question
enum: question.options[].label
```

Multi-select question:

```text
type: "array"
title: question.header
description: question.question
items.anyOf: question.options[].label as const/title entries
```

Use `question.header` as the property key because it is the short user-facing label already used by the question tool. Duplicate headers are ambiguous; the first implementation may preserve current behavior, but production code should either disambiguate duplicate keys or reject the elicitation safely.

On accept, convert ACP response content back into `QuestionV2.Reply.answers` in the original question order:

- string value -> single selected label
- array value -> selected labels
- missing or empty value -> empty answer array

## Capability Behavior

If a client does not advertise `clientCapabilities.elicitation`, opencode should not leave the tool blocked.

The conservative behavior is to reject the pending question request. This matches the existing issue goal: clients that cannot answer questions should not hang the session. A rejection becomes a `QuestionV2.RejectedError`, which the runner can treat as a declined user interaction.

## Event Ordering

`question.asked` and `question.v2.asked` are emitted before the corresponding question service waits on its Deferred. The question event is the earliest reliable point where ACP can ask the user and settle the request.

`message.part.updated` may arrive before, after, or not in time for this bridge depending on projection and stream timing. It is still useful for ACP `session_update` tool-call display, but it should not own question elicitation.

## Implementation Plan

### Production Code Changes

`packages/opencode/src/acp/elicitation.ts`

- Replace the current `QuestionToolPart` input type with a question request input type:

  ```ts
  type QuestionRequest = {
    readonly id: string
    readonly sessionID: string
    readonly questions: ReadonlyArray<QuestionInfo>
    readonly tool?: { readonly messageID: string; readonly callID: string }
  }
  ```

- `Handler.handle(...)` should accept this question request shape, not a `ToolPart`.
- `Handler.process(...)` should:
  - look up the ACP session by `request.sessionID`
  - return without action if the session is unknown
  - reject `request.id` if the request has no questions
  - reject `request.id` if elicitation is unsupported or unavailable
  - call `unstable_createElicitation(buildRequest(request))` when supported
  - reply `request.id` on `accept`
  - reject `request.id` on `decline`, `cancel`, missing response, or client call failure
- `buildRequest(...)` should set:
  - `sessionId: request.sessionID`
  - `toolCallId: request.tool?.callID`
  - `requestedSchema` from `request.questions`
- Remove every use of `part.callID` as a question request ID.

`packages/opencode/src/acp/event.ts`

- Add `question.asked` and `question.v2.asked` to the event switch in `Subscription.handle(...)`.
- Route that event to `this.elicitation.handle(event.properties)`.
- Do not invoke `this.elicitation.handle(...)` from the `message.part.updated` / `handleToolPart(...)` path.
- Keep existing `toolStart(...)`, `runningTool(...)`, completed, and error updates for tool display. The question tool can still appear in ACP `session_update`; it just must not own the elicitation/reply flow.
- Keep `enableElicitation()` as the capability toggle if the implementation keeps negotiation state inside `ACPElicitation.Handler`.

`packages/opencode/src/acp/service.ts`

- Keep the `initialize(...)` capability hook, but remove debug logging.
- On initialize, call `events?.enableElicitation()` only when `params.clientCapabilities?.elicitation` is present.
- Do not advertise or enable the question tool from ACP initialization as part of this bridge. Tool availability should remain controlled by the existing registry logic and tests should opt in explicitly when needed.

### Cleanup Required Before Fixing Behavior

Remove all temporary debug code from production files:

- `packages/opencode/src/acp/elicitation.ts`
  - remove dynamic `import("fs")`
  - remove `/tmp/acp-debug.log` writes
- `packages/opencode/src/acp/event.ts`
  - remove dynamic `import("fs")`
  - remove `/tmp/acp-debug.log` writes in `handle(...)` and `handleToolPart(...)`
- `packages/opencode/src/acp/service.ts`
  - remove dynamic `import("fs")`
  - remove `/tmp/acp-debug.log` writes in `initialize(...)`
- Delete the ad hoc debug entrypoint:
  - `packages/opencode/debug_acp.ts`

Do this before evaluating test results. The debug writes can hide timing problems, leave noisy side effects, and should not ship.

### Hanging Prevention Rules

Every code path that observes a `question.asked` or `question.v2.asked` event for a known ACP session must eventually settle the pending question unless the process is interrupted.

The handler must call exactly one of:

```ts
sdk.question.reply({ requestID: request.id, directory: session.cwd, answers })
sdk.question.reject({ requestID: request.id, directory: session.cwd })
```

for these cases:

- client does not advertise elicitation support: reject
- `connection.unstable_createElicitation` is missing: reject
- question request contains no questions: reject
- `unstable_createElicitation(...)` throws/rejects: reject
- client returns `{ action: "accept" }`: reply
- client returns `{ action: "decline" }`: reject
- client returns `{ action: "cancel" }`: reject
- client returns no response or an invalid response: reject

The handler should catch reply/reject failures so ACP event processing does not crash, but tests should make those failures visible through assertions where possible.

Do not use `tool.callID` or `part.callID` for `sdk.question.reply(...)` or `sdk.question.reject(...)`. That is the hanging bug. The only valid unblock ID is the question request ID from the question event.

### Testing Changes

`packages/opencode/test/acp/elicitation.test.ts`

- Change the tests to emit `question.asked`, not synthetic `message.part.updated` tool parts.
- Test data must use different IDs:

  ```text
  question request id: que_test
  tool call id: call_test
  ```

- Assertions must verify:
  - `unstable_createElicitation(...)` receives `toolCallId: "call_test"`
  - `sdk.question.reply(...)` receives `requestID: "que_test"`
  - `sdk.question.reject(...)` receives `requestID: "que_test"`
- Keep coverage for:
  - accept maps answers and replies
  - decline rejects
  - cancel rejects
  - unsupported client auto-rejects
  - `unstable_createElicitation` failure rejects
  - multiple questions
  - multi-select questions
  - unknown ACP session does not call elicitation or reply/reject
- Add a regression test that would fail if `tool.callID` is used as `requestID`.

`packages/opencode/test/cli/acp/elicitation.test.ts`

- Keep this as subprocess coverage, but make the test harness fail faster.
- The test must explicitly enable the question tool for ACP. Normal ACP does not expose the question tool because `OPENCODE_CLIENT=acp`; the registry only includes it when `enableQuestionTool` is true.
- Add one happy-path test:
  - initialize with `clientCapabilities.elicitation`
  - create a session
  - model calls `question`
  - test client receives `elicitation/create`
  - test client returns `accept`
  - `session/prompt` returns `stopReason: "end_turn"`
- Add one unsupported-client test:
  - initialize without elicitation support
  - model calls `question`
  - no `elicitation/create` is observed
  - `session/prompt` still returns instead of timing out
- Add one decline test if runtime cost is acceptable:
  - client returns `decline`
  - prompt returns instead of timing out
- The per-test infrastructure timeout can remain high, but the harness should include shorter intent-specific waits. For example, after the model emits the question tool, fail within a few seconds if the expected `elicitation/create` request is not observed.
- The JSON-RPC driver must keep serving inbound requests while `session/prompt` is pending. Do not use a receive loop that can be monopolized by the outbound prompt response wait.

### Expected Diff Shape

The final implementation should primarily touch:

- `packages/opencode/src/acp/elicitation.ts`
- `packages/opencode/src/acp/event.ts`
- `packages/opencode/src/acp/service.ts`
- `packages/opencode/test/acp/elicitation.test.ts`
- `packages/opencode/test/cli/acp/elicitation.test.ts`

It should delete:

- `packages/opencode/debug_acp.ts`

It should not require changes to:

- `packages/core/src/question.ts`
- `packages/core/src/tool/question.ts`
- `packages/opencode/src/tool/registry.ts`
- generated SDK files
- Protocol or Server `HttpApi`

## Non-Goals

Do not teach ACP clients to call opencode's HTTP question API directly. That leaks opencode-specific control flow through the ACP boundary.

Do not use a plugin to bridge question events to ACP. The ACP adapter already has the connection and the opencode SDK; this belongs in the adapter.

Do not make `message.part.updated` the source of truth for replying to questions. It does not contain the request ID that `QuestionV2` requires.

## Open Questions

- Should duplicate question headers be rejected, disambiguated, or encoded under generated stable keys?
- Should ACP advertise an agent capability for elicitation support in `initialize`, or is client capability negotiation sufficient for now?
- Should the question tool remain disabled by default for ACP and only be enabled when the client advertises elicitation support, or should existing `enableQuestionTool` remain the only override?
