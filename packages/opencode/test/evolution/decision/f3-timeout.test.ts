import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { ProposalStore } from "../../../src/evolution/brain/proposal-store"
import { withTmpdirInstance, TestInstance } from "../../fixture/fixture"
import path from "path"

const TIMEOUT = 30_000

function instanceTest(
  name: string,
  fn: () => Effect.Effect<void, any, any>,
  configOverrides?: Record<string, unknown>,
) {
  return test(name, async () => {
    const cfg = TestConfig.layer({
      get: () => Effect.succeed({
        evolution: {
          enabled: true as const,
          mode: "assist" as const,
          ...(configOverrides?.evolution as Record<string, unknown> ?? {}),
        },
      }),
    })
    const layer = EvolutionDecisions.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(cfg, FSUtil.defaultLayer)),
    )
    const inner = fn().pipe(withTmpdirInstance({ git: true }), Effect.scoped)
    await Effect.runPromise(inner.pipe(Effect.provide(layer)) as Effect.Effect<void, any>)
  }, TIMEOUT)
}

function instanceTestWithConfig(configOverrides: Record<string, unknown>) {
  return (name: string, fn: () => Effect.Effect<void, any, any>) => instanceTest(name, fn, configOverrides)
}

const VALID_INPUT = {
  key: "test-key-1",
  title: "Use Effect.gen for Composition",
  context: "We need a standard pattern for Effect composition across the codebase",
  proposedDecision: "All new Effect workflows must use Effect.gen(function* () { ... })",
  consequences: "Consistent pattern, easier code reviews",
  tags: ["effect", "architecture"],
  origin: { proposerId: "user-1", sessionId: "session-1" },
}

const SELF_APPROVAL_INPUT = {
  ...VALID_INPUT,
  key: "self-approval-test",
  origin: { proposerId: "evolution" },
}

describe("TG-08 — AC-06 Timeout Enforcement", () => {
  instanceTest(
    "TG-08-01: normal validation completes within timeout → ACCEPTED",
    () =>
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        const result = yield* decisions.submit(VALID_INPUT)
        expect(result.status).toBe("ACCEPTED")
      }),
  )

  instanceTest(
    "TG-08-02: Tier 2 exceeds timeout → REJECTED with VALIDATION_TIMEOUT",
    () =>
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        const result = yield* decisions.submit(VALID_INPUT)
        expect(result.status).toBe("REJECTED")
        expect(result.rejectionReason).toBe("VALIDATION_TIMEOUT")
      }),
    { evolution: { validation: { timeoutMs: 1 } } },
  )

  instanceTest(
    "TG-08-03: runtime failure during Tier 2 → REJECTED with VALIDATION_ERROR",
    () =>
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        const fs = yield* FSUtil.Service
        const test = yield* TestInstance
        const pdir = path.join(test.directory, ".opencode", "evolution", "proposals")
        yield* fs.writeWithDirs(`${pdir}/corrupt.json`, `{ "broken": true }`).pipe(
          Effect.catch(() => Effect.void),
        )
        const result = yield* decisions.submit(VALID_INPUT).pipe(Effect.option)
        if (Option.isNone(result)) return expect("submit failed with no result").toBe("")
        expect(result.value.status).toBe("REJECTED")
        expect(result.value.rejectionReason).toBe("VALIDATION_ERROR")
      }),
  )

  instanceTest(
    "TG-08-04: ACCEPTED proposal is terminal (no outgoing transitions)",
    () =>
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        const result = yield* decisions.submit(VALID_INPUT)
        expect(result.status).toBe("ACCEPTED")
        expect(result.acceptedAt).toBeGreaterThan(0)
        expect(result.rejectedAt).toBeUndefined()
      }),
  )

  instanceTest(
    "TG-08-05: REJECTED proposal is terminal (no outgoing transitions)",
    () =>
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        const result = yield* decisions.submit(SELF_APPROVAL_INPUT)
        expect(result.status).toBe("REJECTED")
        expect(result.rejectedAt).toBeGreaterThan(0)
        expect(result.acceptedAt).toBeUndefined()
      }),
  )

  instanceTest(
    "TG-08-06: no proposal remains in VALIDATING after submit() completes",
    () =>
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        const fs = yield* FSUtil.Service
        const test = yield* TestInstance
        const pdir = path.join(test.directory, ".opencode", "evolution", "proposals")
        yield* decisions.submit(VALID_INPUT).pipe(Effect.ignore)
        yield* decisions.submit(SELF_APPROVAL_INPUT).pipe(Effect.ignore)

        const validating = yield* ProposalStore.listByStatus(fs, pdir, "VALIDATING")
        expect(validating.length).toBe(0)
      }),
  )

  instanceTest(
    "TG-08-07: acceptedAt/rejectedAt mutual exclusion invariant",
    () =>
      Effect.gen(function* () {
        const decisions = yield* EvolutionDecisions.Service
        const accepted = yield* decisions.submit(VALID_INPUT)
        expect(accepted.status).toBe("ACCEPTED")
        expect(accepted.acceptedAt).toBeGreaterThan(0)
        expect(accepted.rejectedAt).toBeUndefined()

        const rejected = yield* decisions.submit(SELF_APPROVAL_INPUT)
        expect(rejected.status).toBe("REJECTED")
        expect(rejected.rejectedAt).toBeGreaterThan(0)
        expect(rejected.acceptedAt).toBeUndefined()
      }),
  )
})
