import type { AgentApi } from "@Mackery6969/client/promise/api"
import type { Agent } from "@Mackery6969/schema/agent"
import type { Types } from "effect"
import type { Transform } from "./registration.js"

export interface AgentEditor {
  list(): readonly Types.DeepMutable<Agent.Info>[]
  get(id: string): Types.DeepMutable<Agent.Info> | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: Types.DeepMutable<Agent.Info>) => void): void
  remove(id: string): void
}

export interface AgentDomain extends AgentApi {
  readonly transform: Transform<AgentEditor>
  readonly reload: () => Promise<void>
}
