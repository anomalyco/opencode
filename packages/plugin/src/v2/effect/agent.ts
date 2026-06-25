import type { AgentV2Info } from "@opencode-ai/sdk/v2/types"
import type { ReadonlyDeep } from "../options.js"
import type { Hooks } from "./registration.js"

export interface AgentDraft {
  list(): readonly ReadonlyDeep<AgentV2Info>[]
  get(id: string): ReadonlyDeep<AgentV2Info> | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: AgentV2Info) => void): void
  remove(id: string): void
}

export type AgentHooks = Hooks<{
  transform: AgentDraft
}>
