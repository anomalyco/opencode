import { Effect, Context } from "effect"
import { LLMError } from "@opencode-ai/llm"
import type { EvolutionContext } from "@/evolution/context"
import type { AgentCriteria } from "@/evolution/decision/agents/types"
import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"

export interface Interface {
  readonly analyze: (
    context: EvolutionContext,
    criteria: AgentCriteria,
  ) => Effect.Effect<ProposalCandidate, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionAgent") {}

export * as EvolutionAgent from "./agent"
