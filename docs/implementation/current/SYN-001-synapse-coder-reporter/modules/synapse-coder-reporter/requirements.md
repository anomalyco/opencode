# Module Requirements: synapse-coder-reporter

See parent [requirements.md](../../requirements.md) for full details.

## Module-specific requirements

| ID | Requirement |
|----|-------------|
| M-001 | Plugin must implement the v1 `Hooks` interface (`packages/plugin/src/index.ts:222-335`) |
| M-002 | Plugin must register `tool.execute.after`, `event`, and `chat.message` hooks |
| M-003 | Plugin must not `await` MCP calls in hook paths (fire-and-forget) |
| M-004 | Plugin must store the per-session model ID from `chat.message` hook input |
| M-005 | Plugin must derive `language` from file extension |
| M-006 | Plugin must check `synapse_coder.enabled` config before reporting |
| M-007 | Plugin must queue failed reports in `.opencode/synapse-coder-queue.json` (max 100, FIFO) |
