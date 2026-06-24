import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { LLMClient, LLMEvent, LLMResponse, Usage } from "@opencode-ai/llm"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { Evolution, EvolutionProject } from "../../../src/evolution/index"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { EvolutionDecisionEngine } from "../../../src/evolution/decision/engine"
import { AuditLedger } from "../../../src/evolution/audit/ledger"
import { ContextComposer } from "../../../src/evolution/context"
import { REGISTERED_AGENTS } from "../../../src/evolution/decision/agents/register"
import { withTmpdirInstance } from "../../fixture/fixture"

const TIMEOUT = 60_000

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

function mockResponses() {
  let callCount = 0
  return Layer.mock(LLMClient.Service, {
    generate: () => {
      callCount++
      const input = callCount === 1
        ? { reasoningStrength: "high", rationale: "Context analysis complete", proposedAction: "Accept proposal", tags: ["test"] }
        : callCount === 2
        ? { risks: [{ description: "Low test risk", severity: "low", category: "technical" }], overallSeverity: "low", recommendationCategory: "APPROVE", rationale: "Risk assessment complete" }
        : { phases: [{ name: "Phase 1", steps: ["Step 1"], estimatedEffort: "1 day" }], estimatedComplexity: 2, rationale: "Plan complete" }
      return Effect.succeed(new LLMResponse({
        events: [
          LLMEvent.toolCall({
            id: `mock-call-${callCount}`,
            name: "generate_object",
            input,
          }),
        ],
        usage: new Usage({ outputTokens: 100 }),
      }))
    },
  })
}

const mockEvolution = Layer.effect(
  Evolution.Service,
  Effect.gen(function* () {
    const decisions = yield* EvolutionDecisions.Service
    return Evolution.Service.of({
      memory: () => ({
        retrieve: () => Effect.succeed([]),
        all: () => Effect.succeed([]),
        save: (e: any) => Effect.succeed({ ...e, id: "1", created: Date.now(), updated: Date.now() }),
        search: () => Effect.succeed([]),
        summarize: () => Effect.succeed({ count: 0, lastUpdate: null, types: {} }),
        compact: () => Effect.void,
        verify: () => Effect.never,
        detectAnomalies: () => Effect.succeed([]),
      }),
      decisions: () => decisions,
      project: () => ({
        profile: () => Effect.succeed<EvolutionProject.ProjectProfile>({ root: "/mock", name: "mock", vcs: "git", languages: [], frameworks: [], packages: [], structure: "single", hasDocker: false, hasTests: false, hasCI: false, detectedAt: 0 }),
        detectFrameworks: () => Effect.succeed([]),
        getStructure: () => Effect.succeed("single"),
        hasDependency: () => Effect.succeed(false),
        refresh: () => Effect.succeed<EvolutionProject.ProjectProfile>({ root: "/mock", name: "mock", vcs: "git", languages: [], frameworks: [], packages: [], structure: "single", hasDocker: false, hasTests: false, hasCI: false, detectedAt: 0 }),
      }),
      status: () => Effect.succeed({ enabled: true, mode: "assist" as const, memory: { count: 0, lastUpdate: null }, decisions: { count: 0 }, project: { detected: false, root: "", frameworks: [] } }),
      getConfig: () => Effect.succeed({ enabled: true, mode: "assist" }),
      getMemories: () => Effect.succeed([]),
      getDecisions: () => Effect.succeed([]),
      getProjectContext: () => Effect.succeed<EvolutionProject.ProjectProfile>({ root: "/mock", name: "mock", vcs: "git", languages: [], frameworks: [], packages: [], structure: "single", hasDocker: false, hasTests: false, hasCI: false, detectedAt: 0 }),
    })
  }),
)

const mockAuditLedger = Layer.mock(AuditLedger.Service, {
  append: () => Effect.succeed({
    id: "mock",
    type: "reconciliation" as const,
    timestamp: Date.now(),
    data: { reconciliationId: "mock", candidates: [], winner: "mock" },
    previousHash: "",
    hash: "mock",
  }),
  query: () => Effect.succeed([]),
})

const testLayer = mockResponses().pipe(
  Layer.provideMerge(
    EvolutionDecisionEngine.layer.pipe(
      Layer.provideMerge(mockAuditLedger),
      Layer.provideMerge(mockEvolution.pipe(
        Layer.provideMerge(
          EvolutionDecisions.layer.pipe(
            Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)),
          ),
        ),
      )),
    ),
  ),
)

describe("G4 Evidence Gate — runtime artifact", () => {
  test("G4-EVIDENCE — engine.reconcile produces participants=3, winner=context-analyst, enrichments=2", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* EvolutionDecisionEngine.Service
        const evolution = yield* Evolution.Service
        const config = yield* evolution.getConfig()
        const composer = ContextComposer.make(evolution, config)
        const context = yield* composer.provide()

        const output = yield* engine.reconcile({
          agents: REGISTERED_AGENTS,
          context,
          criteria: {
            instruction: "Test",
            tags: ["evidence-gate-test"],
          },
          decisionCriteria: {
            key: "evidence-gate-test",
            instruction: "Test",
            tags: ["evidence-gate-test"],
          },
          minCandidateConfidence: 0.3,
        })
        return output
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(testLayer),
      ),
    )

    // Evidence artifact assertions
    expect(result.outcome).toBe("PROPOSAL_SUBMITTED")

    // G4 evidence: participants = all 3 agents
    expect(result.participants).toBeDefined()
    expect(result.participants!.length).toBe(3)

    // Evidence: agent IDs and contribution types
    const ids = result.participants!.map((p) => p.agentId)
    expect(ids).toContain("context-analyst")
    expect(ids).toContain("risk-agent")
    expect(ids).toContain("planning-agent")

    const types = result.participants!.map((p) => p.contributionType)
    expect(types).toContain("proposal")
    expect(types).toContain("risk-analysis")
    expect(types).toContain("execution-plan")

    // Evidence: all agents marked as executed
    expect(result.participants!.every((p) => p.executed)).toBe(true)

    // Evidence: exactly one winner
    const winner = result.participants!.filter((p) => p.selected)
    expect(winner.length).toBe(1)
    expect(winner[0].agentId).toBe("context-analyst")

    // G4 evidence: enrichments from 2 advisors
    expect(result.enrichments).toBeDefined()
    expect(result.enrichments!.length).toBe(2)
    const enrichmentIds = result.enrichments!.map((e) => e.agentId)
    expect(enrichmentIds).toContain("risk-agent")
    expect(enrichmentIds).toContain("planning-agent")

    // Evidence: enrichment summaries present
    for (const e of result.enrichments!) {
      expect(e.summary).toBeTruthy()
      expect(typeof e.summary).toBe("string")
    }

    // Evidence: consensusOutcome present
    expect(result.consensusOutcome).toBe("UNANIMOUS_APPROVED")

    // Evidence: proposedAction and rationale present
    expect(result.proposedAction).toBeTruthy()
    expect(result.rationale).toBeTruthy()
    expect(result.selectedAgentId).toBe("context-analyst")

    // --- Capture evidence artifact ---
    const evidence = {
      gate: "G4 Evidence Gate",
      status: "PASS",
      outcome: result.outcome,
      consensusOutcome: result.consensusOutcome,
      proposedAction: result.proposedAction,
      selectedAgentId: result.selectedAgentId,
      participants: result.participants!.map((p) => ({
        agentId: p.agentId,
        contributionType: p.contributionType,
        executed: p.executed,
        selected: p.selected,
      })),
      winner: winner[0].agentId,
      enrichments: result.enrichments!.map((e) => ({
        agentId: e.agentId,
        summary: e.summary,
      })),
    }

    console.log("\n\n=== G4 EVIDENCE ARTIFACT ===")
    console.log(JSON.stringify(evidence, null, 2))
    console.log("=== END G4 EVIDENCE ARTIFACT ===\n")
  }, TIMEOUT)
})
