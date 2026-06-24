import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { LLMClient, LLMEvent, LLMResponse, Usage } from "@opencode-ai/llm"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { Evolution, EvolutionProject } from "../../../src/evolution/index"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { EvolutionDecisionEngine } from "../../../src/evolution/decision/engine"
import { ExecutionPipeline } from "../../../src/evolution/execution/pipeline"
import { AsyncAuditLogger } from "../../../src/evolution/audit/async-logger"
import { AuditLedger } from "../../../src/evolution/audit/ledger"
import { ContextComposer } from "../../../src/evolution/context"
import { REGISTERED_AGENTS } from "../../../src/evolution/decision/agents/register"
import { Activation } from "../../../src/evolution/decision/activation/index"
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
        ? { reasoningStrength: "high", rationale: "Context analysis complete", proposedAction: "Accept proposal", tags: ["e2e-test"] }
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

function makeEngineLayer() {
  return mockResponses().pipe(
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
}

const mockAsyncLogger = Layer.effect(
  AsyncAuditLogger.Service,
  Effect.succeed({
    log: () => Effect.void,
    flush: Effect.void,
    start: Effect.void,
    stop: Effect.void,
    getQueueDepth: Effect.succeed(0),
  }),
)

describe("E2E — Activation → Engine → Bridge → Pipeline", () => {
  test("engine.reconcile produces valid data through real engine layer", async () => {
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
            instruction: "E2E test",
            tags: ["e2e-test"],
          },
          decisionCriteria: {
            key: "e2e-activation-test",
            instruction: "E2E test",
            tags: ["e2e-test"],
          },
          minCandidateConfidence: 0.3,
        })

        return output
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(makeEngineLayer()),
      ),
    )

    expect(result.outcome).toBe("PROPOSAL_SUBMITTED")
    expect(result.consensusOutcome).toBe("UNANIMOUS_APPROVED")
    expect(result.proposedAction).toBeTruthy()
    expect(result.rationale).toBeTruthy()
    expect(result.selectedAgentId).toBe("context-analyst")
    expect(result.participants).toBeDefined()
    expect(result.participants!.length).toBe(3)
    expect(result.enrichments).toBeDefined()
    expect(result.enrichments!.length).toBe(2)
  }, TIMEOUT)

  test("Activation.invoke with real pipeline + mock logger", async () => {
    const fullLayer = makeEngineLayer().pipe(
      Layer.provideMerge(ExecutionPipeline.layer),
      Layer.provideMerge(mockAsyncLogger),
    )

    const disposition = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Activation.invoke({
          instruction: "E2E test",
          tags: ["e2e-test"],
        })
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(fullLayer),
      ),
    )

    const validDispositions = ["AUTO_EXECUTED", "HELD_FOR_REVIEW", "PENDING_APPROVAL"] as const
    expect(validDispositions).toContain(disposition as typeof validDispositions[number])
  }, TIMEOUT)

  test("Activation.invoke with real pipeline + real async logger", async () => {
    const fullRealLayer = makeEngineLayer().pipe(
      Layer.provideMerge(ExecutionPipeline.layer),
      Layer.provideMerge(AsyncAuditLogger.layer),
    )

    const disposition = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Activation.invoke({
          instruction: "E2E test",
          tags: ["e2e-test"],
        })
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(fullRealLayer),
      ),
    )

    const validDispositions = ["AUTO_EXECUTED", "HELD_FOR_REVIEW", "PENDING_APPROVAL"] as const
    expect(validDispositions).toContain(disposition as typeof validDispositions[number])
  }, TIMEOUT)
})
