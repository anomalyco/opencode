import type { AgentApi } from "@opencode-ai/client/effect/api"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface AgentDraft {
  list(): readonly Types.DeepMutable<Agent.Info>[]
  get(id: string): Types.DeepMutable<Agent.Info> | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: Types.DeepMutable<Agent.Info>) => void): void
  remove(id: string): void
}

export interface AgentDomain extends AgentApi<unknown> {
  readonly transform: Transform<AgentDraft>
  readonly reload: () => Effect.Effect<void>
}
