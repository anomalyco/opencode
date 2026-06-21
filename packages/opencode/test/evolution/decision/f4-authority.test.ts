import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { withTmpdirInstance } from "../../fixture/fixture"

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

const decisionsLayer = EvolutionDecisions.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)),
)

const instanceTest = <E, R>(name: string, fn: () => Effect.Effect<void, E, R>) =>
  test(name, () => {
    const inner = fn().pipe(withTmpdirInstance({ git: true }), Effect.scoped)
    return Effect.runPromise(inner.pipe(Effect.provide(decisionsLayer)) as Effect.Effect<void, E>)
  }, 30_000)

const SELF_APPROVAL_INPUT = {
  key: "sa-key",
  title: "Self-approval attempt",
  context: "Trying to self-approve",
  proposedDecision: "Do the thing",
  consequences: "Will be rejected",
  tags: ["test"],
  origin: { proposerId: "evolution" },
}

const VALID_INPUT = {
  key: "valid-key",
  title: "Valid Proposal",
  context: "Context for valid proposal",
  proposedDecision: "Accept this",
  consequences: "Good things",
  tags: ["test"],
  origin: { proposerId: "user-1", sessionId: "session-1" },
}

describe("TG-AUTH — Authority Path (DA-01 Enforcement)", () => {
  instanceTest("self-approval with evolution ID → REJECTED / AUTHORITY_VIOLATION", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const result = yield* decisions.submit(SELF_APPROVAL_INPUT)
      expect(result.status).toBe("REJECTED")
      expect(result.rejectionReason).toBe("AUTHORITY_VIOLATION")
    }),
  )

  instanceTest("self-approval with ef-ai ID → REJECTED / AUTHORITY_VIOLATION", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const result = yield* decisions.submit({ ...VALID_INPUT, key: "ef-ai-key", origin: { proposerId: "ef-ai" } })
      expect(result.status).toBe("REJECTED")
      expect(result.rejectionReason).toBe("AUTHORITY_VIOLATION")
    }),
  )

  instanceTest("non-system proposer → ACCEPTED", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const result = yield* decisions.submit(VALID_INPUT)
      expect(result.status).toBe("ACCEPTED")
    }),
  )
})
