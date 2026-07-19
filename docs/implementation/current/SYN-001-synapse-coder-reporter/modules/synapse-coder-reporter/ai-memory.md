# Module AI Memory: synapse-coder-reporter

See parent [ai-memory.md](../../ai-memory.md) for full details.

## Module-specific gotchas

- The `write.ts` tool does NOT return `diff` in metadata (only in the permission ask) — use `input.args.content` as the original
- The `event` hook receives ALL events — filter early by type to avoid overhead
- The `chat.message` hook fires for user messages only, not assistant messages — the model is in the hook input, not in the assistant message
- MCP calls must be fire-and-forget; `await`-ing them in a hook blocks the tool execution loop
