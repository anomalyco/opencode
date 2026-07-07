import type { AgentApi } from "@opencode-ai/client/effect/api"
import type { AgentInfo } from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { TransformHook } from "./registration.js"

export interface AgentDraft {
  list(): readonly AgentInfo[]
  get(id: string): AgentInfo | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: AgentInfo) => void): void
  remove(id: string): void
}

export interface AgentHooks extends AgentApi<unknown> {
  readonly transform: TransformHook<AgentDraft>
  readonly reload: () => Effect.Effect<void>
}
