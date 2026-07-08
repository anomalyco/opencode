import type { Hooks } from "./registration.js"

export interface ToolDefinition {
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly outputSchema?: Record<string, unknown>
  readonly execute: (input: unknown, context: { sessionID: string }) => Promise<unknown>
}

export interface ToolDraft {
  register(tools: Record<string, ToolDefinition>): void
  unregister(...names: string[]): void
}

export type ToolHooks = Hooks<{
  transform: ToolDraft
}>
