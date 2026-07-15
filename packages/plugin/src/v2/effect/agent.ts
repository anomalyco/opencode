import type { AgentApi } from "@opencode-ai/client/effect/api"
import type { AgentInfo } from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface AgentDraft {
  list(): readonly AgentInfo[]
  get(id: string): AgentInfo | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: AgentInfo) => void): void
  remove(id: string): void
}

export interface AgentDomain extends AgentApi<unknown> {
  readonly get: (id: string) => Effect.Effect<AgentGetOutput | undefined>
  readonly transform: Transform<AgentDraft>
  readonly reload: () => Effect.Effect<void>
}

type AgentGetOutput = Effect.Success<ReturnType<AgentApi<unknown>["list"]>>["data"][number]
