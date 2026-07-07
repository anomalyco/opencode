import type { AgentApi } from "@opencode-ai/client/effect/api"
import type { AgentV2Info } from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface AgentDraft {
  list(): readonly AgentV2Info[]
  get(id: string): AgentV2Info | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: AgentV2Info) => void): void
  remove(id: string): void
}

export interface AgentDomain extends AgentApi<unknown> {
  readonly transform: Transform<AgentDraft>
  readonly reload: () => Effect.Effect<void>
}
