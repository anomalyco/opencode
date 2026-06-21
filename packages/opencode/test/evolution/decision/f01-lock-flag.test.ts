import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, Ref } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { Evolution } from "../../../src/evolution/index"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { EvolutionDecisionEngine } from "../../../src/evolution/decision/engine"
import { Activation } from "../../../src/evolution/decision/activation/index"
import { ExecutionPipeline } from "../../../src/evolution/execution/pipeline"
import { AsyncAuditLogger } from "../../../src/evolution/audit/async-logger"
import { Context } from "effect"
import { withTmpdirInstance } from "../../fixture/fixture"
import type { ReconcileOutput } from "../../../src/evolution/decision/types"

const TIMEOUT = 30_000

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

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
      }),
      decisions: () => decisions,
      project: () => ({
        profile: () => Effect.succeed({ root: "/mock", name: "mock", vcs: "git", languages: [], frameworks: [], packages: [], structure: "single", hasDocker: false, hasTests: false, hasCI: false, detectedAt: 0 }),
        detectFrameworks: () => Effect.succeed([]),
        getStructure: () => Effect.succeed("single"),
        hasDependency: () => Effect.succeed(false),
        refresh: () => Effect.succeed({}),
      }),
      status: () => Effect.succeed({ enabled: true, mode: "assist" as const, memory: { count: 0, lastUpdate: null }, decisions: { count: 0 }, project: { detected: false, root: "", frameworks: [] } }),
      getConfig: () => Effect.succeed({ enabled: true, mode: "assist" }),
      getMemories: () => Effect.succeed([]),
      getDecisions: () => Effect.succeed([]),
      getProjectContext: () => Effect.succeed({} as any),
    })
  }),
)

const defaultReconcileOutput: ReconcileOutput = {
  outcome: "PROPOSAL_SUBMITTED",
  consensusOutcome: "UNANIMOUS_APPROVED",
  proposedAction: "mock action",
  rationale: "mock rationale",
  tags: ["mock"],
  selectedAgentId: "context-analyst",
  participants: [],
  enrichments: [],
}

// Delayed reconcile: returns after 500ms — concurrent call should hit busy lock
const delayedLayer = Layer.effect(
  EvolutionDecisionEngine.Service,
  Effect.gen(function* () {
    return EvolutionDecisionEngine.Service.of({
      propose: () => Effect.succeed({ proposalId: "mock", status: "ACCEPTED" as const }),
      reconcile: () => Effect.sleep(Duration.millis(500)).pipe(
        Effect.andThen(Effect.succeed({ ...defaultReconcileOutput })),
      ),
    })
  }),
)

// Fast reconcile for basic test
const fastLayer = Layer.effect(
  EvolutionDecisionEngine.Service,
  Effect.gen(function* () {
    return EvolutionDecisionEngine.Service.of({
      propose: () => Effect.succeed({ proposalId: "mock", status: "ACCEPTED" as const }),
      reconcile: () => Effect.succeed({ ...defaultReconcileOutput }),
    })
  }),
)

// Fail-on-reconcile layer for error recovery test
const errLayer = Layer.effect(
  EvolutionDecisionEngine.Service,
  Effect.gen(function* () {
    return EvolutionDecisionEngine.Service.of({
      propose: () => Effect.succeed({ proposalId: "mock", status: "ACCEPTED" as const }),
      reconcile: () => Effect.fail(new Error("Simulated failure")),
    })
  }),
)

const mockPipeline = Layer.effect(
  ExecutionPipeline.Service,
  Effect.succeed({
    processDecision: () => Effect.succeed("AUTO_EXECUTED" as const),
    approveDecision: () => Effect.succeed(true),
    rejectDecision: () => Effect.succeed(true),
    getHumanReviewQueue: Effect.succeed([]),
  }),
)

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

function testLayer(engineLayer: Layer.Layer<EvolutionDecisionEngine.Service>) {
  const decisionsLayer = EvolutionDecisions.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)),
  )
  return engineLayer.pipe(
    Layer.provideMerge(mockEvolution.pipe(
      Layer.provideMerge(decisionsLayer),
    )),
    Layer.provideMerge(mockPipeline.pipe(
      Layer.provideMerge(mockAsyncLogger),
    )),
  )
}

describe("F-01 — Lock Flag", () => {
  test("basic invoke succeeds when not busy", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Activation.invoke({ dryRun: true })
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(testLayer(fastLayer)),
      ),
    )
    expect(result).toBeDefined()
    expect(result).toBe("AUTO_EXECUTED")
  }, TIMEOUT)

  test("concurrent invoke fails with ActivationBusyError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Activation.invoke({ dryRun: true }).pipe(Effect.forkChild)
        yield* Effect.sleep(Duration.millis(50))
        const second = yield* Activation.invoke({ dryRun: true }).pipe(
          Effect.catchTag("EvolutionActivationBusyError", () => Effect.succeed("BUSY" as const)),
          Effect.catch(() => Effect.succeed("OTHER_ERROR" as const)),
        )
        return second
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(testLayer(delayedLayer)),
      ),
    )
    expect(result).toBe("BUSY")
  }, TIMEOUT)

  test("flag resets after error (Effect.fail)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Activation.invoke({ dryRun: true }).pipe(
          Effect.catch(() => Effect.void),
        )
        const second = yield* Activation.invoke({ dryRun: true }).pipe(
          Effect.catchTag("EvolutionActivationBusyError", () => Effect.succeed("BUSY" as const)),
          Effect.catch(() => Effect.succeed("OK" as const)),
        )
        return second
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(testLayer(errLayer)),
      ),
    )
    expect(result).not.toBe("BUSY")
  }, TIMEOUT)
})
