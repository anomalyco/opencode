import type { Effect, Scope } from "effect"

export interface ToolDomain {
  readonly register: (tools: Readonly<Record<string, unknown>>) => Effect.Effect<void, unknown, Scope.Scope>
}
