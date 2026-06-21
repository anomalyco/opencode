import type { Effect } from "effect"
import type { LLMError, Model } from "@opencode-ai/llm"
import type { EvolutionContext } from "@/evolution/context"

export type AgentCapability = "proposal" | "risk-analysis" | "execution-plan"

export interface AgentCriteria {
  readonly instruction: string
  readonly tags: readonly string[]
}

export interface AgentManifest {
  id: string
  capabilities: AgentCapability[]
  execute: (context: EvolutionContext, criteria: AgentCriteria, model?: Model) => Effect.Effect<unknown, LLMError>
}

export * as EvolutionAgentTypes from "./types"
