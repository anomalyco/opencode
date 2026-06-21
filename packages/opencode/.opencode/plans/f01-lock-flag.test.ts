import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../test/fixture/config"
import { Evolution } from "../../src/evolution/index"
import { EvolutionDecisions } from "../../src/evolution/brain/decisions"
import { EvolutionDecisionEngine } from "../../src/evolution/decision/engine"
import { Activation } from "../../src/evolution/decision/activation/index"
import { withTmpdirInstance } from "../../test/fixture/fixture"

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

// Delayed reconcile: returns after 500ms — concurrent call should hit busy lock
const delayedLayer = Layer.effect(
  EvolutionDecisionEngine.Service,
  Effect.gen(function* () {
    return EvolutionDecisionEngine.Service.of({
      propose: () => Effect.succeed({ proposalId: "mock", status: "ACCEPTED" as const }),
      reconcile: () => Effect.sleep(Duration.millis(500)).pipe(
        Effect.andThen(Effect.succeed({
          outcome: "PROPOSAL_SUBMITTED" as const,
          proposalId: "mock",
          submissionResult: { proposalId: "mock", status: "ACCEPTED" as const },
          participants: [],
          enrichments: [],
        })),
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
      reconcile: () => Effect.succeed({
        outcome: "PROPOSAL_SUBMITTED" as const,
        proposalId: "mock",
        submissionResult: { proposalId: "mock", status: "ACCEPTED" as const },
        participants: [],
        enrichments: [],
      }),
    })
  }),
)

// Die-on-reconcile layer for panic recovery test
const dieLayer = Layer.effect(
  EvolutionDecisionEngine.Service,
  Effect.gen(function* () {
    return EvolutionDecisionEngine.Service.of({
      propose: () => Effect.succeed({ proposalId: "mock", status: "ACCEPTED" as const }),
      reconcile: () => Effect.die(new Error("Simulated panic")),
    })
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
    expect(result.outcome).toBe("PROPOSAL_SUBMITTED")
  }, TIMEOUT)

  test("concurrent invoke fails with ActivationBusyError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // First call starts and takes 500ms
        const first = yield* Activation.invoke({ dryRun: true }).pipe(Effect.forkChild)
        // Give it time to acquire lock
        yield* Effect.sleep(Duration.millis(50))
        // Second call should fail with busy
        const second = yield* Activation.invoke({ dryRun: true }).pipe(
          Effect.catchTag("EvolutionActivationBusyError", () => Effect.succeed("BUSY" as const)),
          Effect.catchAll(() => Effect.succeed("OTHER_ERROR" as const)),
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

  test("flag resets after panic (Effect.die)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // First call dies
        yield* Activation.invoke({ dryRun: true }).pipe(
          Effect.catchAll(() => Effect.void),
        )
        // Second call should succeed (flag was reset by Effect.ensuring)
        const second = yield* Activation.invoke({ dryRun: true }).pipe(
          Effect.catchTag("EvolutionActivationBusyError", () => Effect.succeed("BUSY" as const)),
          Effect.catchAll(() => Effect.succeed("OK" as const)),
        )
        return second
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(testLayer(dieLayer)),
      ),
    )
    expect(result).not.toBe("BUSY")
  }, TIMEOUT)
})
