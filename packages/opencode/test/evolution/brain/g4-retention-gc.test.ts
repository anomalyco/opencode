import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { testEffect } from "../../lib/effect"
import { ProposalStore } from "@/evolution/brain/proposal-store"
import type { DecisionProposal } from "@/evolution/decision/proposal"
import { TestConfig } from "../../fixture/config"
import os from "os"

const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})

const it = testEffect(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer))

function makeProposal(id: string, rejectedAt: number): DecisionProposal {
  return {
    id,
    key: `key-${id}`,
    title: `Proposal ${id}`,
    context: "context",
    proposedDecision: "decision",
    consequences: "consequences",
    tags: [],
    origin: { proposerId: "test" },
    createdAt: rejectedAt - 1000,
    status: "REJECTED",
    rejectionReason: "DUPLICATE_KEY",
    rejectedAt,
    validatedAt: rejectedAt,
  }
}

function makeTmpdir(fs: FSUtil.Interface) {
  return Effect.gen(function* () {
    const dir = yield* Effect.sync(() => `${os.tmpdir()}/gc-test-${Date.now()}`)
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    return dir
  })
}

describe("G4 — Retention GC", () => {
  it.live("gc with no expired proposals returns 0", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* makeTmpdir(fs)
      yield* ProposalStore.submit(["proposal"], fs, dir, makeProposal("p1", Date.now()))
      const deleted = yield* ProposalStore.gc(fs, dir, 365)
      expect(deleted).toBe(0)
    })
  )

  it.live("gc with expired proposal deletes it", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* makeTmpdir(fs)
      const old = Date.now() - 200 * 24 * 60 * 60 * 1000
      yield* ProposalStore.submit(["proposal"], fs, dir, makeProposal("p1", old))
      const deleted = yield* ProposalStore.gc(fs, dir, 90)
      expect(deleted).toBe(1)
    })
  )

  it.live("gc with mix of expired and live", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* makeTmpdir(fs)
      const old = Date.now() - 200 * 24 * 60 * 60 * 1000
      yield* ProposalStore.submit(["proposal"], fs, dir, makeProposal("old", old))
      yield* ProposalStore.submit(["proposal"], fs, dir, makeProposal("new", Date.now()))
      const deleted = yield* ProposalStore.gc(fs, dir, 90)
      expect(deleted).toBe(1)

      const remaining = yield* ProposalStore.listByStatus(fs, dir, "REJECTED")
      expect(remaining.length).toBe(1)
      expect(remaining[0].id).toBe("new")
    })
  )

  it.live("gc with retentionDays=0 deletes nothing", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* makeTmpdir(fs)
      const old = Date.now() - 200 * 24 * 60 * 60 * 1000
      yield* ProposalStore.submit(["proposal"], fs, dir, makeProposal("p1", old))
      const deleted = yield* ProposalStore.gc(fs, dir, 0)
      expect(deleted).toBe(0)
    })
  )

  it.live("gc ignores ACCEPTED proposals regardless of age", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* makeTmpdir(fs)
      const old = Date.now() - 200 * 24 * 60 * 60 * 1000
      const accepted: DecisionProposal = {
        ...makeProposal("p1", old),
        status: "ACCEPTED",
        acceptedAt: old,
      }
      yield* ProposalStore.submit(["proposal"], fs, dir, accepted)
      const deleted = yield* ProposalStore.gc(fs, dir, 30)
      expect(deleted).toBe(0)
    })
  )
})
