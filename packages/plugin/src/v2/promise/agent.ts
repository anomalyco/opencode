import type { AgentApi } from "@opencode-ai/client/promise/api"
import type { AgentDraft } from "../effect/agent.js"
import type { Hooks, Transform } from "./registration.js"

export type { AgentDraft }

export interface AgentHooks {}

export interface AgentDomain extends AgentApi {
  readonly hook: Hooks<AgentHooks>
  readonly transform: Transform<AgentDraft>
  readonly reload: () => Promise<void>
}
