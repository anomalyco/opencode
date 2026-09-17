import type { AgentDraft } from "../effect/agent.js"
import type { Hooks } from "./registration.js"

export type { AgentDraft }

export type AgentHooks = Hooks<{
  transform: AgentDraft
}>
