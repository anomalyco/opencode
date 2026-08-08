## subagent-messaging

The goal is to let an operator correct a running subagent mid-task by delivering a message into its context deterministically, using the existing plugin hook system, without polling or a daemon.

### discovered behavior

`tool.execute.after` in `packages/plugin/src/index.ts` fires for every session including subagents. It receives the session id and the tool output, and its return value replaces the output the model sees next turn. This behavior is currently undocumented and the payload shape is not versioned.

### proposed contract

```typescript
// packages/schema/src/plugin.ts — versioned hook payload

interface ToolExecuteAfterInput {
  sessionID: string       // from packages/schema/src/session-id.ts
  tool: string
  result: string          // tool output text
}

interface ToolExecuteAfterResult {
  result: string          // mutated output, delivered to the model next turn
}
```

The hook must be allowed to return a transformed output. This is the only guarantee the feature needs. The current implementation already returns the mutated result string. This spec proposes documenting that contract and versioning it.

### delivery model

Cross-session delivery extends the existing `session-delivery.ts` schema rather than introducing a new primitive. Add a bus variant alongside the existing `steer` and `queue` types:

```typescript
// packages/schema/src/session-delivery.ts

export const Delivery = Schema.Literals(["steer", "queue", "bus"])
```

A `bus` delivery means a message was injected via a plugin hook into the session context, as opposed to `steer` (session-managed direction) or `queue` (buffered for later delivery).

### reference implementation

A working transport is at `semanticRig/cross-session-agent-messaging`. It uses a maildir spool (tmp/new/cur atomic renames) for crash-safe message delivery, a TypeScript plugin for context injection via `tool.execute.after`, and MCP server wrappers for operator tools. Validated on OpenCode 1.18.15 with 10 parallel subagents.

The maildir transport stays external. This spec only proposes documenting and versioning the hook contract and extending the delivery schema. The transport choice is left to the plugin author.

### non-goals

- Aborting or redirecting a subagent mid-execution (that would be a `steer` delivery, already covered)
- A built-in message bus in the core (the hook is the interface; the transport is external)
- Retroactive injection (the hook fires after a tool call; a subagent that ends its turn with no tool call receives the message on its next tool turn)

### related

- Issue #41304 — "plugin hooks fire for subagents, so you can correct them mid-task"
- Reference implementation: https://github.com/semanticRig/cross-session-agent-messaging
