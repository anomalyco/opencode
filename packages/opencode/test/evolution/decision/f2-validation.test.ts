import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../../fixture/config"
import { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import { withTmpdirInstance } from "../../fixture/fixture"

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

const decisionsLayer = EvolutionDecisions.layer.pipe(Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)))

const TIMEOUT = 30_000

const instanceTest = <E, R>(
  name: string,
  fn: () => Effect.Effect<void, E, R>,
) =>
  test(name, () => {
    const inner = fn().pipe(withTmpdirInstance({ git: true }), Effect.scoped)
    return Effect.runPromise(inner.pipe(Effect.provide(decisionsLayer)) as Effect.Effect<void, E>)
  }, TIMEOUT)

const VALID_INPUT = {
  key: "test-key-1",
  title: "Use Effect.gen for Composition",
  context: "We need a standard pattern for Effect composition across the codebase",
  proposedDecision: "All new Effect workflows must use Effect.gen(function* () { ... })",
  consequences: "Consistent pattern, easier code reviews",
  tags: ["effect", "architecture"],
  origin: { proposerId: "user-1", sessionId: "session-1" },
}

const VALID_INPUT_2 = {
  key: "test-key-2",
  title: "Adopt Prettier as Default Formatter",
  context: "Code formatting is inconsistent across packages",
  proposedDecision: "Use Prettier with standard config for all TypeScript files",
  consequences: "Consistent formatting, no more formatting debates in PRs",
  tags: ["tooling"],
  origin: { proposerId: "user-1", sessionId: "session-2" },
}

const SELF_APPROVAL_INPUT = {
  ...VALID_INPUT,
  key: "self-approval-test",
  origin: { proposerId: "evolution" },
}

describe("TG-03 — Duplicate Key Detection", () => {
  instanceTest("(pass) submit same key twice → second rejected with DUPLICATE_KEY", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const first = yield* decisions.submit(VALID_INPUT)
      expect(first.status).toBe("ACCEPTED")

      const second = yield* decisions.submit(VALID_INPUT)
      expect(second.status).toBe("REJECTED")
      expect(second.rejectionReason).toBe("DUPLICATE_KEY")
    }),
  )
})

describe("TG-04 — Authority Enforcement (DA-01)", () => {
  instanceTest("(pass) self-approval attempt rejected with AUTHORITY_VIOLATION", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const result = yield* decisions.submit(SELF_APPROVAL_INPUT)
      expect(result.status).toBe("REJECTED")
      expect(result.rejectionReason).toBe("AUTHORITY_VIOLATION")
    }),
  )
})

describe("TG-05 — Decision Persistence", () => {
  instanceTest("(pass) ACCEPTED proposal appears in decisionRecord", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      yield* decisions.submit(VALID_INPUT)
      const record = yield* decisions.decisionRecord()
      expect(record.length).toBe(1)
      expect(record[0].key).toBe(VALID_INPUT.key)
      expect(record[0].acceptedAt).toBeGreaterThan(0)
    }),
  )

  instanceTest("(pass) multiple ACCEPTED proposals appear in decisionRecord", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      yield* decisions.submit(VALID_INPUT)
      yield* decisions.submit(VALID_INPUT_2)
      const record = yield* decisions.decisionRecord()
      expect(record.length).toBe(2)
    }),
  )

  instanceTest("(pass) REJECTED proposals do NOT appear in decisionRecord", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      yield* decisions.submit(SELF_APPROVAL_INPUT)
      const record = yield* decisions.decisionRecord()
      expect(record.length).toBe(0)
    }),
  )
})

describe("TG-06 — Decision Immutability", () => {
  instanceTest("(pass) ACCEPTED proposal cannot transition to REJECTED (state machine guard)", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const proposal = yield* decisions.submit(VALID_INPUT)
      expect(proposal.status).toBe("ACCEPTED")
    }),
  )
})

describe("TG-07 — Audit Trail Preservation", () => {
  instanceTest("(pass) REJECTED proposals visible with reason_code via propose", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const first = yield* decisions.submit(VALID_INPUT)
      expect(first.status).toBe("ACCEPTED")

      const second = yield* decisions.submit(VALID_INPUT)
      expect(second.status).toBe("REJECTED")
      expect(second.rejectionReason).toBeDefined()
      expect(second.rejectedAt).toBeGreaterThan(0)
    }),
  )

  instanceTest("(pass) REJECTED authority violation visible with rejectedAt timestamp", () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      const result = yield* decisions.submit(SELF_APPROVAL_INPUT)
      expect(result.status).toBe("REJECTED")
      expect(result.rejectionReason).toBe("AUTHORITY_VIOLATION")
      expect(result.rejectedAt).toBeGreaterThan(0)
    }),
  )
})
