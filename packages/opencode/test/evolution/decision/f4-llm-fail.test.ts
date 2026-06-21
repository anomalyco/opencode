import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { LLMClient, LLMError, TransportReason } from "@opencode-ai/llm"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { Evolution } from "../../../src/evolution/index"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { EvolutionDecisionEngine } from "../../../src/evolution/decision/engine"
import { withTmpdirInstance } from "../../fixture/fixture"
import { AuditLedger } from "../../../src/evolution/audit/ledger"

const TIMEOUT = 30_000

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

const failingLLM = Layer.mock(LLMClient.Service, {
  generate: () => Effect.fail(new LLMError({
    module: "test",
    method: "generateObject",
    reason: new TransportReason({ message: "Simulated provider failure" }),
  })),
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

const decisionsLayer = EvolutionDecisions.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)),
)

const mockAuditLedger = Layer.mock(AuditLedger.Service, {
  append: () => Effect.void,
  query: () => Effect.succeed([]),
})

const testLayer = EvolutionDecisionEngine.layer.pipe(
  Layer.provideMerge(mockEvolution.pipe(Layer.provideMerge(decisionsLayer))),
  Layer.provideMerge(failingLLM),
  Layer.provideMerge(mockAuditLedger),
)

describe("TG-LLM-FAIL — LLM Failure Path", () => {
  test("LLM generate failure → error propagates (not swallowed)", async () => {
    const inner = Effect.gen(function* () {
      const engine = yield* EvolutionDecisionEngine.Service
      const exit = yield* engine.propose({ key: "fail-key", instruction: "This will fail" }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(withTmpdirInstance({ git: true }), Effect.scoped)
    await Effect.runPromise(inner.pipe(Effect.provide(testLayer)))
  }, TIMEOUT)
})
