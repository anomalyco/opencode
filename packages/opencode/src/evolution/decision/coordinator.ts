import { Effect } from "effect"
import { LLMError } from "@opencode-ai/llm"
import type { Model as LLMModel } from "@opencode-ai/llm"
import type { EvolutionContext } from "@/evolution/context"
import type { AgentCriteria, AgentManifest } from "@/evolution/decision/agents/types"
import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"

export type AgentFn = (
  context: EvolutionContext,
  criteria: AgentCriteria,
) => Effect.Effect<ProposalCandidate, LLMError>

export interface AgentResult {
  manifest: AgentManifest
  output: unknown
}

export const collect = (
  agents: readonly AgentManifest[],
  context: EvolutionContext,
  criteria: AgentCriteria,
  model?: LLMModel,
): Effect.Effect<readonly AgentResult[], LLMError> =>
  Effect.all(agents.map((a) =>
    a.execute(context, criteria, model).pipe(Effect.map((output) => ({ manifest: a, output })))
  ))

export * as EvolutionAgentCoordinator from "./coordinator"
