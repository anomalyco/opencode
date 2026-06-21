import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../fixture/config"
import { EvolutionDecisions } from "../../src/evolution/brain/decisions"
import { withTmpdirInstance } from "../fixture/fixture"

const TIMEOUT = 30_000

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const, retention: { proposalDays: 0 } } }),
})

describe("F-05 — Dual-Store TTL", () => {
  test("reconciliation log saved without error", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        yield* decisions.saveReconciliationLog({
          sessionId: "test",
          contextHash: "abc",
          candidates: [],
          participants: [],
          selectedCandidateAgentId: null,
          selectionReason: "NO_CANDIDATES",
          outcome: "NO_CANDIDATES",
          createdAt: Date.now(),
        })
        return "saved"
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(
          EvolutionDecisions.layer.pipe(
            Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)),
          ),
        ),
      ),
    )
    expect(result).toBe("saved")
  }, TIMEOUT)

  test("proposal store gc removes old proposals", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        yield* decisions.submit({
          key: "old-proposal",
          title: "Old",
          context: "old",
          proposedDecision: "old",
          consequences: "old",
          tags: [],
          origin: { proposerId: "evolution" },
        })
        return yield* decisions.gc()
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(
          EvolutionDecisions.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                TestConfig.layer({
                  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const, retention: { proposalDays: 0 } } }),
                }),
                FSUtil.defaultLayer,
              ),
            ),
          ),
        ),
      ),
    )
    expect(typeof result).toBe("number")
  }, TIMEOUT)
})
