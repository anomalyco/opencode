import { describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@moks/core/effect/layer-node"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { CandidateCard } from "../../src/product/candidate-card"
import { MessageID, SessionID } from "../../src/session/schema"
import { CommitTool, PushTool, StatusTool } from "../../src/tool/decision"
import { Truncate } from "@/tool/truncate"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("msg_test-message"),
  callID: "test-call",
  agent: "recruit",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

describe("tool.decision", () => {
  it.instance(
    "commit then status shows the commit",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "HIRING.md"), "# Role\n"))
        yield* Effect.promise(() =>
          CandidateCard.write(test.directory, {
            id: "cand_ada",
            stage: "sourced",
            extra: { name: "Ada" },
            body: "# Ada\n",
          }),
        )

        const commitInfo = yield* CommitTool
        const commit = yield* commitInfo.init()
        const committed = yield* commit.execute(
          { action: "advance", target_id: "cand_ada", target_kind: "candidate", reason: "next round" },
          ctx,
        )
        const commitBody = JSON.parse(committed.output)
        expect(commitBody.receipt.action).toBe("advance")
        expect(commitBody.receipt.source).toBe("tool")
        expect(commitBody.receipt.state).toBe("committed")

        const statusInfo = yield* StatusTool
        const status = yield* statusInfo.init()
        const listed = yield* status.execute({}, ctx)
        const statusBody = JSON.parse(listed.output)
        expect(statusBody.receipts.some((row: { id: string }) => row.id === commitBody.receipt.id)).toBe(true)
        expect(statusBody.open.some((row: { id: string }) => row.id === commitBody.receipt.id)).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "push dry-runs unless dry_run is false",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "HIRING.md"), "# Role\n"))

        const commitInfo = yield* CommitTool
        const commit = yield* commitInfo.init()
        const committed = yield* commit.execute({ action: "note" }, ctx)
        const commitBody = JSON.parse(committed.output)

        const pushInfo = yield* PushTool
        const push = yield* pushInfo.init()
        const dry = yield* push.execute({ commit_id: commitBody.receipt.id }, ctx)
        const dryBody = JSON.parse(dry.output)
        expect(dryBody.ok).toBe(true)
        expect(dryBody.receipt.dry_run).toBe(true)
        expect(dryBody.receipt.source).toBe("tool")

        const executed = yield* push.execute({ commit_id: commitBody.receipt.id, dry_run: false, confirm: true }, ctx)
        const executedBody = JSON.parse(executed.output)
        expect(executedBody.ok).toBe(true)
        expect(executedBody.receipt.dry_run).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "push adverse without confirm returns needs_confirm",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "HIRING.md"), "# Role\n"))

        const commitInfo = yield* CommitTool
        const commit = yield* commitInfo.init()
        const committed = yield* commit.execute({ action: "reject", target_id: "cand_ada" }, ctx)
        const commitBody = JSON.parse(committed.output)

        const pushInfo = yield* PushTool
        const push = yield* pushInfo.init()
        const result = yield* push.execute({ commit_id: commitBody.receipt.id, dry_run: false }, ctx)
        const body = JSON.parse(result.output)
        expect(body.ok).toBe(false)
        expect(body.code).toBe("needs_confirm")
        expect(result.title).toBe("needs_confirm")
      }),
    { git: true },
  )
})
