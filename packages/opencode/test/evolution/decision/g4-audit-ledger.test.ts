import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { testEffect } from "../../lib/effect"
import { AuditLedger } from "@/evolution/audit/ledger"
import { TestConfig } from "../../fixture/config"
import os from "os"

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

const it = testEffect(
  Layer.mergeAll(enabledCfg, FSUtil.defaultLayer),
)

function withTmpdir<A, E, R>(fn: (dir: string, fs: FSUtil.Interface) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R | FSUtil.Service> {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const dir = yield* Effect.sync(() => `${os.tmpdir()}/audit-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    return yield* fn(dir, fs)
  })
}

describe("G4 — Audit Ledger", () => {
  it.live("append and query: proposal_submit", () =>
    withTmpdir((dir, fs) =>
      Effect.gen(function* () {
        const ledger = AuditLedger.make(dir, fs)
        const r = yield* ledger.append("proposal_submit", {
          proposalId: "p1",
          status: "SUBMITTED",
          origin: { agent: "test-agent", sessionId: "s1" },
        })
        expect(r.type).toBe("proposal_submit")
        expect(r.id).toBeTruthy()
        expect(r.previousHash).toBe("")
        expect(r.hash).toBeTruthy()

        const records = yield* ledger.query({ type: "proposal_submit" })
        expect(records.length).toBe(1)
        expect(records[0].id).toBe(r.id)
      }),
    )
  )

  it.live("append and query: reconciliation", () =>
    withTmpdir((dir, fs) =>
      Effect.gen(function* () {
        const ledger = AuditLedger.make(dir, fs)
        yield* ledger.append("reconciliation", {
          reconciliationId: "r1",
          candidates: ["a", "b"],
          winner: "a",
          edi: 0.7,
        })
        const records = yield* ledger.query({ type: "reconciliation" })
        expect(records.length).toBe(1)
        expect((records[0].data as AuditLedger.AuditReconciliation).winner).toBe("a")
      }),
    )
  )

  it.live("append and query: rejection", () =>
    withTmpdir((dir, fs) =>
      Effect.gen(function* () {
        const ledger = AuditLedger.make(dir, fs)
        yield* ledger.append("rejection", {
          rejectionId: "rj1",
          code: "DUPLICATE_KEY",
          reason: "Key exists",
        })
        const records = yield* ledger.query({ type: "rejection" })
        expect(records.length).toBe(1)
      }),
    )
  )

  it.live("query with proposalId filter", () =>
    withTmpdir((dir, fs) =>
      Effect.gen(function* () {
        const ledger = AuditLedger.make(dir, fs)
        yield* ledger.append("proposal_submit", {
          proposalId: "target",
          status: "SUBMITTED",
          origin: { agent: "a", sessionId: "s1" },
        })
        yield* ledger.append("proposal_submit", {
          proposalId: "other",
          status: "SUBMITTED",
          origin: { agent: "b", sessionId: "s2" },
        })
        const matches = yield* ledger.query({ proposalId: "target" })
        expect(matches.length).toBe(1)
        expect((matches[0].data as AuditLedger.AuditProposalSubmit).proposalId).toBe("target")
      }),
    )
  )

  it.live("hash chain integrity", () =>
    withTmpdir((dir, fs) =>
      Effect.gen(function* () {
        const ledger = AuditLedger.make(dir, fs)
        const r1 = yield* ledger.append("proposal_submit", {
          proposalId: "p1", status: "SUBMITTED", origin: { agent: "a", sessionId: "s1" },
        })
        const r2 = yield* ledger.append("proposal_submit", {
          proposalId: "p2", status: "SUBMITTED", origin: { agent: "b", sessionId: "s2" },
        })
        expect(r1.previousHash).toBe("")
        expect(r2.previousHash).toBe(r1.hash)
      }),
    )
  )

  it.live("query with timeRange", () =>
    withTmpdir((dir, fs) =>
      Effect.gen(function* () {
        const ledger = AuditLedger.make(dir, fs)
        const before = Date.now()
        yield* ledger.append("proposal_submit", {
          proposalId: "p1", status: "SUBMITTED", origin: { agent: "a", sessionId: "s1" },
        })
        const after = Date.now()
        const matches = yield* ledger.query({ timeRange: { from: before, to: after } })
        expect(matches.length).toBe(1)
      }),
    )
  )

  it.live("query with no matches returns empty array", () =>
    withTmpdir((dir, fs) =>
      Effect.gen(function* () {
        const ledger = AuditLedger.make(dir, fs)
        yield* ledger.append("proposal_submit", {
          proposalId: "p1", status: "SUBMITTED", origin: { agent: "a", sessionId: "s1" },
        })
        const matches = yield* ledger.query({ type: "reconciliation" })
        expect(matches).toHaveLength(0)
      }),
    )
  )
})
