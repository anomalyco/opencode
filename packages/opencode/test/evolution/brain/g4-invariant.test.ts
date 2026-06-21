import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProposalStore, requireProposalCapability } from "@/evolution/brain/proposal-store"
import type { DecisionProposal } from "@/evolution/decision/proposal"
import { tmpdirScoped } from "../../fixture/fixture"

function makeProposal(id: string): DecisionProposal {
  return {
    id,
    key: `test-${id}`,
    title: "Test",
    context: "test",
    proposedDecision: "accept",
    consequences: "none",
    tags: ["test"],
    origin: { proposerId: "test" },
    createdAt: Date.now(),
    status: "SUBMITTED",
  }
}

const testFsLayer = Layer.mergeAll(FSUtil.defaultLayer, CrossSpawnSpawner.defaultLayer)

describe("TG-WRITE — Invariant Checker (CR-001)", () => {
  test("requireProposalCapability — empty caps harus die dengan InvariantViolationError", async () => {
    const exit = await Effect.exit(requireProposalCapability([], "submit")).pipe(
      Effect.runPromise,
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("requireProposalCapability — proposal caps harus sukses", async () => {
    const result = await requireProposalCapability(["proposal"], "submit").pipe(
      Effect.runPromise,
    )
    expect(result).toBeUndefined()
  })

  test("requireProposalCapability — non-proposal caps harus die", async () => {
    const exit = await Effect.exit(requireProposalCapability(["risk-analysis"], "submit")).pipe(
      Effect.runPromise,
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("TG-WRITE-INVARIANT-REJECT — submit tanpa proposal capability harus die", async () => {
    const exit = await Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* tmpdirScoped()
      const proposal = makeProposal("inv-reject-1")
      return yield* Effect.exit(ProposalStore.submit([], fs, dir, proposal))
    }).pipe(
      Effect.provide(testFsLayer),
      Effect.scoped,
      Effect.runPromise,
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("TG-WRITE-INVARIANT-ALLOW — submit dengan proposal capability harus sukses", async () => {
    const result = await Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* tmpdirScoped()
      const proposal = makeProposal("inv-allow-1")
      yield* ProposalStore.submit(["proposal"], fs, dir, proposal)
      return proposal.id
    }).pipe(
      Effect.provide(testFsLayer),
      Effect.scoped,
      Effect.runPromise,
    )

    expect(result).toBe("inv-allow-1")
  })

  test("TG-WRITE-UPDATESTATUS-INVARIANT — updateStatus tanpa proposal capability harus die", async () => {
    const exit = await Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const dir = yield* tmpdirScoped()
      const proposal = makeProposal("inv-upd-1")
      yield* ProposalStore.submit(["proposal"], fs, dir, proposal)
      return yield* Effect.exit(ProposalStore.updateStatus([], fs, dir, proposal.id, "VALIDATING"))
    }).pipe(
      Effect.provide(testFsLayer),
      Effect.scoped,
      Effect.runPromise,
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
