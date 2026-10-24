import { Effect } from "effect"

// Shared reconcile cell: McpTool registers its reconcile function here during
// layer construction so the MCP service can await it after mutations without
// introducing a circular layer dependency (McpTool depends on Mcp).
export const cell: { reconcile: Effect.Effect<void, never, never> | null } = { reconcile: null }