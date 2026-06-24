import { Context, Effect, Layer, Option, Schema } from "effect"
import { LLM, Model, LLMError } from "@opencode-ai/llm"
import type { Model as LLMModel } from "@opencode-ai/llm"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { Evolution } from "@/evolution/index"
import { DecisionProposalSchema, type DecisionProposal } from "@/evolution/decision/proposal"
import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"
import { SCORING_CONTRACT } from "@/evolution/decision/proposal-candidate"
import { collect } from "@/evolution/decision/coordinator"
import type { AgentManifest, AgentCapability } from "@/evolution/decision/agents/types"
import type { AgentCriteria } from "@/evolution/decision/agents/types"
import type { ReconciliationLog, ParticipantEntry } from "@/evolution/decision/reconciliation-log"
import { ReconciliationLogSchema } from "@/evolution/decision/reconciliation-log"
import { runCommittee } from "@/evolution/orchestration/committee"
import type { AgentOutput, ContextAnalystOutput, RiskAnalystOutput, PlanningAnalystOutput, ConsensusOutcome, DecisionCategory } from "@/evolution/decision/p6-types"
import type { EvolutionContext } from "@/evolution/context"
import { ROUTE_EVOLUTION } from "@/evolution/decision/agents/route"
import { computeDiversity } from "@/evolution/decision/diversity"
import type { DiversityMetrics } from "@/evolution/decision/diversity"
import { Provider } from "@/provider/provider"
import { LLMNative } from "@/session/llm/native-request"
import type { ReconcileOutput, OutputParticipant, OutputEnrichment } from "@/evolution/decision/types"

export class DecisionEngineError extends Schema.TaggedErrorClass<DecisionEngineError>()("EvolutionDecisionEngineError", {
  message: Schema.String,
}) {}

export interface DecisionCriteria {
  readonly key: string
  readonly instruction: string
  readonly tags?: readonly string[]
}

export interface ProposalSubmissionResult {
  readonly proposalId: string
  readonly status: "ACCEPTED" | "REJECTED"
  readonly rejectionReason?: string
}

// G3-D02: ReconcileInput — criteria for reconciliation pipeline.
export interface ReconcileInput {
  readonly agents: readonly AgentManifest[]
  readonly context: EvolutionContext
  readonly criteria: AgentCriteria
  readonly decisionCriteria: DecisionCriteria
  readonly minCandidateConfidence: number
  readonly dryRun?: boolean
  readonly decisionCategory?: DecisionCategory
}

export { type ReconcileOutput, type OutputParticipant, type OutputEnrichment }

export interface Interface {
  readonly propose: (criteria: DecisionCriteria) => Effect.Effect<
    ProposalSubmissionResult,
    DecisionEngineError | LLMError
  >
  readonly reconcile: (input: ReconcileInput) => Effect.Effect<
    ReconcileOutput,
    DecisionEngineError | LLMError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionDecisionEngine") {}

function calcConfidence(candidate: ProposalCandidate): number {
  return SCORING_CONTRACT[candidate.reasoningStrength]
}

function caps(...items: AgentCapability[]): AgentCapability[] { return items }

function toAssessment(s: string): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  switch (s.toUpperCase()) {
    case "LOW": return "LOW"
    case "MEDIUM": return "MEDIUM"
    case "HIGH": return "HIGH"
    case "CRITICAL": return "CRITICAL"
    default: return "LOW"
  }
}

export function summariseAdvisorOutput(output: unknown): string {
  const obj = output as Record<string, unknown>
  if (Array.isArray(obj?.risks)) return `${obj.risks.length} risks identified`
  if (Array.isArray(obj?.phases)) {
    const steps = obj.phases.reduce((s: number, p: any) => s + (Array.isArray(p.steps) ? p.steps.length : 0), 0)
    return `${obj.phases.length} phases, ${steps} steps`
  }
  if (Array.isArray(obj?.steps)) return `${obj.steps.length} steps`
  return "completed"
}

function buildParticipants(
  allResults: readonly { manifest: AgentManifest; output: unknown }[],
  generatorResults: readonly { manifest: AgentManifest; output: unknown }[],
  winnerAgentId: string | null,
): ParticipantEntry[] {
  return allResults.map((r) => {
    const isGenerator = r.manifest.capabilities.includes("proposal" as AgentCapability)
    const candidate = isGenerator ? (r.output as ProposalCandidate) : null
    const confidence = candidate ? calcConfidence(candidate) : 0
    return {
      agentId: r.manifest.id,
      capabilities: r.manifest.capabilities,
      contributionType: isGenerator ? "proposal" : r.manifest.capabilities[0] ?? "unknown",
      confidenceScore: confidence,
      selected: winnerAgentId === r.manifest.id,
    }
  })
}

function resolveEvolutionModel(): Effect.Effect<LLMModel | undefined> {
  return Effect.gen(function* () {
    const provider = yield* Effect.serviceOption(Provider.Service)
    if (Option.isNone(provider)) return undefined
    const providerSvc = provider.value
    yield* Effect.logInfo("evolution model resolve: provider available, resolving default")
    const defaultInfo = yield* providerSvc.defaultModel().pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!defaultInfo) {
      yield* Effect.logWarning("evolution model resolve: no default model configured")
      return undefined
    }
    yield* Effect.logDebug("evolution model resolve: default model", defaultInfo)
    const pm = yield* providerSvc.getModel(defaultInfo.providerID, defaultInfo.modelID).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!pm) {
      yield* Effect.logWarning("evolution model resolve: model not found in catalog", defaultInfo)
      return undefined
    }
    try {
      const llmModel = LLMNative.model(pm) as unknown as LLMModel
      yield* Effect.logDebug("evolution model resolve: success", { id: llmModel.id, provider: llmModel.provider })
      return llmModel
    } catch (e) {
      yield* Effect.logWarning("evolution model resolve: LLMNative.model failed", { error: String(e) })
      return undefined
    }
  }).pipe(Effect.catch((e) =>
    Effect.logWarning("evolution model resolve: unexpected error", { error: String(e) }).pipe(Effect.andThen(Effect.succeed(undefined)))
  ))
}

function buildOutputParticipants(allResults: readonly { manifest: AgentManifest; output: unknown }[], selectedAgentId: string | null): OutputParticipant[] {
  return allResults.map((r) => ({
    agentId: r.manifest.id,
    contributionType: r.manifest.capabilities.includes("proposal") ? "proposal" : r.manifest.capabilities[0] ?? "unknown",
    executed: true,
    selected: r.manifest.id === selectedAgentId,
  }))
}

function buildOutputEnrichments(advisorResults: readonly { manifest: AgentManifest; output: unknown }[]): OutputEnrichment[] {
  return advisorResults.map((r) => ({
    agentId: r.manifest.id,
    summary: summariseAdvisorOutput(r.output),
  }))
}

const dryRunReconcile = Effect.fn("EvolutionDecisionEngine.dryRunReconcile")(function* () {
  const now = Date.now()

  const syntheticGenerator = {
    manifest: { id: "context-analyst", capabilities: caps("proposal"), execute: () => Effect.die(new Error("dry-run")) },
    output: { agentId: "context-analyst", reasoningStrength: "medium" as const, rationale: "Synthetic dry-run evaluation. No LLM call was made.", proposedAction: "Accept current architecture with minor improvements", tags: ["dry-run", "synthetic"], producedAt: now },
  }

  const riskOutput = { risks: [{ description: "Synthetic: low risk - standard patterns used", severity: "low", category: "technical" }], overallSeverity: "low", rationale: "Synthetic risk assessment for dry-run" }
  const planOutput = { phases: [{ name: "Phase 1", steps: ["Review architecture", "Apply improvements", "Verify"], estimatedEffort: "2 days" }], estimatedComplexity: 2, rationale: "Synthetic execution plan for dry-run" }

  const syntheticAdvisors = [
    { manifest: { id: "risk-agent", capabilities: caps("risk-analysis"), execute: () => Effect.die(new Error("dry-run")) }, output: riskOutput },
    { manifest: { id: "planning-agent", capabilities: caps("execution-plan"), execute: () => Effect.die(new Error("dry-run")) }, output: planOutput },
  ]

  const allResults = [syntheticGenerator, ...syntheticAdvisors]
  const selectedCandidateAgentId = "context-analyst"

  const diversity = computeDiversity(
    [syntheticGenerator.output].map((c) => ({
      agentId: c.agentId,
      text: `${c.rationale} ${c.proposedAction}`,
    })),
  )

  return {
    outcome: "PROPOSAL_SUBMITTED" as const,
    consensusOutcome: "UNANIMOUS_APPROVED" as ConsensusOutcome,
    proposedAction: syntheticGenerator.output.proposedAction,
    rationale: syntheticGenerator.output.rationale,
    tags: syntheticGenerator.output.tags,
    selectedAgentId: selectedCandidateAgentId,
    participants: buildOutputParticipants(allResults, selectedCandidateAgentId),
    enrichments: buildOutputEnrichments(syntheticAdvisors),
    diversityMetrics: diversity ? { edi: diversity.edi, falseConsensusWarning: diversity.falseConsensusWarning } : undefined,
  }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const evolution = yield* Evolution.Service
    const getModel = yield* Effect.cached(resolveEvolutionModel())

    const propose = Effect.fn("EvolutionDecisionEngine.propose")(function* (criteria: DecisionCriteria) {
      const llmModel = yield* getModel
      const memories = yield* evolution.memory().retrieve({ tags: criteria.tags?.slice() ?? [], limit: 20 }).pipe(
        Effect.catch(() => Effect.succeed([])),
      )
      const contextStr = memories.map((m) => `[${m.type}] ${m.content}`).join("\n")
      const m = llmModel ?? Model.make({ id: "decision-engine", provider: "evolution", route: ROUTE_EVOLUTION })
      const generated = yield* LLM.generateObject({
        schema: DecisionProposalSchema,
        model: m,
        system: `${criteria.instruction}\n\nRelevant context:\n${contextStr}`,
        prompt: "Generate a decision proposal based on the above context.",
        generation: { temperature: 0.1, maxTokens: 2000 },
      })
      const output = generated.object as DecisionProposal
      const result = yield* evolution.decisions().submit({
        key: criteria.key,
        title: output.title,
        context: output.context,
        proposedDecision: output.proposedDecision,
        consequences: output.consequences,
        tags: output.tags ?? criteria.tags,
        origin: { proposerId: "decision-engine" },
      }).pipe(
        Effect.catch((e) => Effect.fail(new DecisionEngineError({ message: `Submission failed: ${(e as Error).message}` }))),
      )

      if (result.status !== "ACCEPTED" && result.status !== "REJECTED") {
        return yield* Effect.fail(
          new DecisionEngineError({ message: "Unexpected non-terminal proposal status" }),
        )
      }

      return {
        proposalId: result.id,
        status: result.status,
        rejectionReason: result.rejectionReason,
      }
    })

    const reconcile = Effect.fn("EvolutionDecisionEngine.reconcile")(function* (input: ReconcileInput) {
      if (input.dryRun) return yield* dryRunReconcile()

      const llmModel = yield* getModel
      // Stage 1: Run all agents
      const allResults = yield* collect(input.agents, input.context, input.criteria, llmModel).pipe(
        Effect.catch((e) => Effect.fail(new DecisionEngineError({ message: `Coordinator failed: ${(e as Error).message}` }))),
      )

      // Stage 2: Split generators (proposal-capable) from advisors
      const generatorResults = allResults.filter((r) => r.manifest.capabilities.includes("proposal" as AgentCapability))
      const advisorResults = allResults.filter((r) => !r.manifest.capabilities.includes("proposal" as AgentCapability))

      if (generatorResults.length === 0) {
        return yield* Effect.fail(new DecisionEngineError({ message: "NO_CANDIDATES: zero proposal-capable agents" }))
      }

      // Stage 3: Build agent outputs for committee consensus
      const candidates = generatorResults.map((r) => r.output as ProposalCandidate)

      // Pre-filter: minimum confidence threshold
      const maxConfidence = Math.max(...candidates.map((c) => SCORING_CONTRACT[c.reasoningStrength]), 0)
      const now = Date.now()

      // Stage 4: Committee consensus (AC-18: Consensus > Score)
      const agentOutputs: AgentOutput[] = allResults.map((r) => {
        if (r.manifest.id === "context-analyst") {
          const c = r.output as ProposalCandidate
          return { agentId: "context-analyst", proposedAction: c.proposedAction, rationale: c.rationale, confidence: SCORING_CONTRACT[c.reasoningStrength] } as ContextAnalystOutput
        }
        if (r.manifest.id === "risk-agent") {
          const output = r.output
          if (typeof output !== "object" || output === null || !("overallSeverity" in output)) {
            throw new DecisionEngineError({ message: "Invalid risk agent output" })
          }
          const ra = output as { overallSeverity: string; recommendationCategory: string; rationale: string; risks: readonly unknown[] }
          const result: RiskAnalystOutput = { agentId: "risk-analyst", assessment: toAssessment(ra.overallSeverity), recommendation: ra.recommendationCategory === "APPROVE" ? "APPROVE" : "REJECT", critical: ra.overallSeverity === "critical", reason: ra.rationale, recommendationCategory: ra.recommendationCategory }
          return result
        }
        if (r.manifest.id === "planning-agent") {
          return { agentId: "planning-analyst", feasible: true, reason: "Completed" } as PlanningAnalystOutput
        }
        throw new Error(`Unknown agent: ${r.manifest.id}`)
      })

      const consensusResult = runCommittee(agentOutputs)

      // Stage 5: Diversity Index — compute EDI from generator proposals
      const diversity: DiversityMetrics | undefined = candidates.length >= 2
        ? computeDiversity(
          candidates.map((c) => ({
            agentId: c.agentId,
            text: `${c.rationale} ${c.proposedAction}`,
          })),
        )
        : undefined

      // Stage 6: Map consensus outcome to reconcile output
      // No side effects — engine only produces data. Activation handles persistence.

      if (consensusResult.outcome === "NO_PROPOSAL") {
        return yield* Effect.fail(new DecisionEngineError({ message: "NO_CANDIDATES: zero proposal-capable agents" }))
      }

      if (consensusResult.outcome === "VETO_HELD") {
        return {
          outcome: "HELD_FOR_REVIEW" as const,
          consensusOutcome: "VETO_HELD" as ConsensusOutcome,
          vetoReason: consensusResult.vetoReason ?? "RiskAnalyst veto",
          selectedAgentId: undefined,
          participants: buildOutputParticipants(allResults, null),
          enrichments: buildOutputEnrichments(advisorResults),
          diversityMetrics: diversity ? { edi: diversity.edi, falseConsensusWarning: diversity.falseConsensusWarning } : undefined,
        }
      }

      if (consensusResult.outcome === "DISAGREEMENT_HELD") {
        return {
          outcome: "HELD_FOR_REVIEW" as const,
          consensusOutcome: "DISAGREEMENT_HELD" as ConsensusOutcome,
          vetoReason: `Agent disagreement: ${(consensusResult.conflicts ?? []).join("; ")}`,
          conflicts: consensusResult.conflicts,
          selectedAgentId: undefined,
          participants: buildOutputParticipants(allResults, null),
          enrichments: buildOutputEnrichments(advisorResults),
          diversityMetrics: diversity ? { edi: diversity.edi, falseConsensusWarning: diversity.falseConsensusWarning } : undefined,
        }
      }

      // UNANIMOUS_APPROVED — check confidence threshold
      if (maxConfidence < (input.minCandidateConfidence ?? 0.3)) {
        return {
          outcome: "BELOW_THRESHOLD" as const,
          consensusOutcome: "UNANIMOUS_APPROVED" as ConsensusOutcome,
          proposedAction: candidates[0]?.proposedAction,
          rationale: candidates[0]?.rationale,
          selectedAgentId: undefined,
          participants: buildOutputParticipants(allResults, null),
          enrichments: buildOutputEnrichments(advisorResults),
          diversityMetrics: diversity ? { edi: diversity.edi, falseConsensusWarning: diversity.falseConsensusWarning } : undefined,
        }
      }

      const selectedAgentId = generatorResults[0]!.manifest.id
      const selected = candidates[0]!

      const outputParticipants = buildOutputParticipants(allResults, selectedAgentId)
      const outputEnrichments = buildOutputEnrichments(advisorResults)

      const reconciliationLog: ReconciliationLog = {
        sessionId: input.decisionCriteria.key,
        contextHash: input.context.budget.configured.toString(),
        candidates: candidates.map((c) => ({
          agentId: c.agentId,
          reasoningStrength: c.reasoningStrength,
          confidenceScore: SCORING_CONTRACT[c.reasoningStrength],
          selected: true,
        })),
        participants: allResults.map((r) => {
          const isGen = r.manifest.capabilities.includes("proposal" as AgentCapability)
          const cand = isGen ? (r.output as ProposalCandidate) : null
          return {
            agentId: r.manifest.id,
            capabilities: [...r.manifest.capabilities],
            contributionType: isGen ? "proposal" : r.manifest.capabilities[0] ?? "unknown",
            confidenceScore: cand ? SCORING_CONTRACT[cand.reasoningStrength] : 0,
            selected: r.manifest.id === selectedAgentId,
          }
        }),
        selectedCandidateAgentId: selectedAgentId,
        selectionReason: "HIGHEST_CONFIDENCE",
        outcome: "PROPOSAL_SUBMITTED",
        submissionStatus: "PENDING",
        diversityMetrics: diversity ? { edi: diversity.edi, falseConsensusWarning: diversity.falseConsensusWarning } : undefined,
        createdAt: now,
      }

      return {
        outcome: "PROPOSAL_SUBMITTED" as const,
        consensusOutcome: "UNANIMOUS_APPROVED" as ConsensusOutcome,
        proposedAction: selected.proposedAction,
        rationale: selected.rationale,
        tags: selected.tags,
        selectedAgentId,
        decisionCategory: input.decisionCategory,
        participants: outputParticipants,
        enrichments: outputEnrichments,
        diversityMetrics: diversity ? { edi: diversity.edi, falseConsensusWarning: diversity.falseConsensusWarning } : undefined,
        reconciliationLog,
      }
    })

    return Service.of({ propose, reconcile })
  }),
)

export const defaultLayer = Layer.mergeAll(
  LLMClient.layer.pipe(Layer.provide(RequestExecutor.defaultLayer)),
  layer,
)

export * as EvolutionDecisionEngine from "./engine"
