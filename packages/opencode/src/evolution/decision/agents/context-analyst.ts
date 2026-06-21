import { Effect, Clock } from "effect"
import { LLM, Model, LLMError } from "@opencode-ai/llm"
import type { Model as LLMModel } from "@opencode-ai/llm"
import { AGENT_OUTPUT_SCHEMA } from "@/evolution/decision/proposal-candidate"
import type { ProposalCandidate, AgentOutput } from "@/evolution/decision/proposal-candidate"
import type { EvolutionContext } from "@/evolution/context"
import { formatEvolutionContext } from "@/evolution/context"
import type { AgentCriteria } from "@/evolution/decision/agents/types"
import { ROUTE_EVOLUTION } from "./route"

export const execute = (
  context: EvolutionContext,
  criteria: AgentCriteria,
  model?: LLMModel,
): Effect.Effect<ProposalCandidate, LLMError> => {
  const system = `Analyst: ${criteria.instruction}\n\n${formatEvolutionContext(context)}`
  const m = model ?? Model.make({ id: "context-analyst", provider: "evolution", route: ROUTE_EVOLUTION })
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const generated = yield* LLM.generateObject({
      schema: AGENT_OUTPUT_SCHEMA,
      model: m,
      system,
      prompt: criteria.tags.join(", "),
      generation: { temperature: 0.1 },
    })
    const output = generated.object as AgentOutput
    return {
      agentId: "context-analyst",
      reasoningStrength: output.reasoningStrength,
      rationale: output.rationale,
      proposedAction: output.proposedAction,
      tags: output.tags,
      producedAt: now,
    }
  })
}

export * as EvolutionContextAnalystAgent from "./context-analyst"
