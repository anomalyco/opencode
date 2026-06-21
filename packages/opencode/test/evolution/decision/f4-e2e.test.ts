import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { LLMClient, LLMError, LLMEvent, LLMResponse, Usage } from "@opencode-ai/llm"
import { AuditLedger } from "../../../src/evolution/audit/ledger"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { Evolution } from "../../../src/evolution/index"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { EvolutionDecisionEngine } from "../../../src/evolution/decision/engine"
import { withTmpdirInstance } from "../../fixture/fixture"

const TIMEOUT = 30_000

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

function makeMockLLM(input: Record<string, unknown>) {
  return Layer.mock(LLMClient.Service, {
    generate: () => Effect.succeed(
      new LLMResponse({
        events: [
          LLMEvent.toolCall({
            id: "mock-call-e2e",
            name: "generate_object",
            input: {
              id: "mock-id",
              key: "e2e-key",
              title: "E2E Test Proposal",
              context: "Generated for end-to-end test",
              proposedDecision: "Accept this proposal",
              consequences: "Positive outcomes",
              tags: ["test"],
              origin: { proposerId: "evolution" },
              createdAt: Date.now(),
              status: "SUBMITTED",
              ...input,
            },
          }),
        ],
        usage: new Usage({ input: 50, output: 100 }),
      }),
    ),
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

function testLayer(mockInput: Record<string, unknown>) {
  const decisionsLayer = EvolutionDecisions.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)),
  )
  const evolutionLayer = mockEvolution.pipe(Layer.provideMerge(decisionsLayer))
  const mockAuditLedger = Layer.mock(AuditLedger.Service, {
    append: () => Effect.void,
    query: () => Effect.succeed([]),
  })
  return EvolutionDecisionEngine.layer.pipe(
    Layer.provideMerge(evolutionLayer),
    Layer.provideMerge(makeMockLLM(mockInput)),
    Layer.provideMerge(mockAuditLedger),
  )
}

const engineTest = <E, R>(
  name: string,
  fn: () => Effect.Effect<void, E, R>,
  llmInput?: Record<string, unknown>,
) =>
  test(name, async () => {
    const inner = fn().pipe(withTmpdirInstance({ git: true }), Effect.scoped)
    await Effect.runPromise(inner.pipe(Effect.provide(testLayer(llmInput ?? {}))) as Effect.Effect<void, E>)
  }, TIMEOUT)

describe("TG-E2E — Full Workflow", () => {
  engineTest("propose → submit → ACCEPTED", () =>
    Effect.gen(function* () {
      const engine = yield* EvolutionDecisionEngine.Service
      const result = yield* engine.propose({
        key: "e2e-key-1",
        instruction: "Propose a decision",
      })
      expect(result.status).toBe("ACCEPTED")
      expect(result.proposalId).toBeTruthy()
    }),
    { key: "e2e-key-1" },
  )

  engineTest("propose → submit → REJECTED (duplicate key)", () =>
    Effect.gen(function* () {
      const engine = yield* EvolutionDecisionEngine.Service
      yield* engine.propose({ key: "dup-key", instruction: "First" })
      const second = yield* engine.propose({ key: "dup-key", instruction: "Duplicate" })
      expect(second.status).toBe("REJECTED")
      expect(second.rejectionReason).toBe("DUPLICATE_KEY")
    }),
    { key: "dup-key" },
  )
})
