import type { AgentApi } from "@opencode-ai/client/promise/api"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface AgentEditor {
  list(): readonly DeepMutable<Agent.Info>[]
  get(id: string): DeepMutable<Agent.Info> | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: DeepMutable<Agent.Info>) => void): void
  remove(id: string): void
}

export interface AgentDomain extends AgentApi {
  readonly transform: Transform<AgentEditor>
  readonly reload: () => Promise<void>
}
