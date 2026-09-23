import { describe, expect } from "bun:test"
import { AgentManager } from "@opencode-ai/core/agent-manager"
import { Effect } from "effect"
import { it } from "./lib/effect"

describe("AgentManager", () => {
  it.effect("creates idle agents with defaults", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })

      expect(agent.id.startsWith("agt_")).toBe(true)
      expect(agent.status).toBe("idle")
      expect(agent.name).toBe(`agent-${agent.id}`)
      expect(agent.priority).toBe("normal")
      expect(agent.tokensUsed).toBe(0)
      expect(agent.checkpoints).toEqual([])
      expect(agent.logs).toEqual([])
      expect(typeof agent.createdAt).toBe("number")
    }),
  )

  it.effect("rejects blank names on create", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const error = yield* Effect.flip(agents.create({ workspace: "/tmp/work", name: "   " }))

      expect(error._tag).toBe("AgentManagerInvalidUsage")
    }),
  )

  it.effect("runs the full lifecycle plan, start, verify, complete", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const created = yield* agents.create({ workspace: "/tmp/work", name: "worker" })

      const planned = yield* agents.plan(created.id)
      expect(planned.status).toBe("planning")

      const started = yield* agents.start(created.id)
      expect(started.status).toBe("running")
      expect(typeof started.startedAt).toBe("number")

      const verifying = yield* agents.verify(created.id)
      expect(verifying.status).toBe("verifying")

      const completed = yield* agents.complete(created.id, "done")
      expect(completed.status).toBe("completed")
      expect(completed.result).toBe("done")
      expect(typeof completed.completedAt).toBe("number")
      expect(completed.logs.at(-1)).toMatchObject({ level: "info", message: "Completed" })

      const error = yield* Effect.flip(agents.start(created.id))
      expect(error._tag).toBe("AgentManagerInvalidTransition")
      expect(error).toMatchObject({ from: "completed", to: "running" })
    }),
  )

  it.effect("rejects invalid transitions with from and to", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })

      const error = yield* Effect.flip(agents.complete(agent.id, "done"))
      expect(error._tag).toBe("AgentManagerInvalidTransition")
      expect(error).toMatchObject({ id: agent.id, from: "idle", to: "completed" })
    }),
  )

  it.effect("pauses and resumes while preserving the first start", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })

      const started = yield* agents.start(agent.id)
      const paused = yield* agents.pause(agent.id)
      expect(paused.status).toBe("waiting")

      const resumed = yield* agents.resume(agent.id)
      expect(resumed.status).toBe("running")
      expect(resumed.startedAt).toBe(started.startedAt)
    }),
  )

  it.effect("blocks with a reason and unblocks to waiting", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })
      yield* agents.start(agent.id)

      const blocked = yield* agents.block(agent.id, "waiting on review")
      expect(blocked.status).toBe("blocked")
      expect(blocked.logs.at(-1)).toMatchObject({ level: "warn", message: "Blocked: waiting on review" })

      const waiting = yield* agents.unblock(agent.id)
      expect(waiting.status).toBe("waiting")
    }),
  )

  it.effect("fails with an error, retries, cancels, and archives", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })
      yield* agents.start(agent.id)

      const failed = yield* agents.fail(agent.id, "boom")
      expect(failed.status).toBe("failed")
      expect(failed.error).toBe("boom")
      expect(failed.logs.at(-1)).toMatchObject({ level: "error", message: "boom" })

      const retried = yield* agents.start(agent.id)
      expect(retried.status).toBe("running")

      const cancelled = yield* agents.cancel(agent.id)
      expect(cancelled.status).toBe("cancelled")

      const archived = yield* agents.archive(agent.id)
      expect(archived.status).toBe("archived")

      const error = yield* Effect.flip(agents.resume(agent.id))
      expect(error._tag).toBe("AgentManagerInvalidTransition")
      expect(error).toMatchObject({ from: "archived", to: "running" })
    }),
  )

  it.effect("renames and validates the new name", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })

      const renamed = yield* agents.rename(agent.id, "  scout  ")
      expect(renamed.name).toBe("scout")

      const blank = yield* Effect.flip(agents.rename(agent.id, "   "))
      expect(blank._tag).toBe("AgentManagerInvalidUsage")

      yield* agents.cancel(agent.id)
      yield* agents.archive(agent.id)
      const archived = yield* Effect.flip(agents.rename(agent.id, "late"))
      expect(archived._tag).toBe("AgentManagerInvalidTransition")
    }),
  )

  it.effect("duplicates the spec without history", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const source = yield* agents.create({
        workspace: "/tmp/work",
        name: "source",
        parentID: "agt_parent",
        model: "mimo",
        provider: "opencode",
        allowedTools: ["read", "grep"],
        permissions: ["fs.read"],
        tokenBudget: 1000,
        priority: "high",
      })
      yield* agents.start(source.id)
      yield* agents.log(source.id, { level: "info", message: "hello" })
      yield* agents.checkpoint(source.id, { label: "first" })

      const copy = yield* agents.duplicate(source.id, { name: "sibling" })
      expect(copy.id === source.id).toBe(false)
      expect(copy.id.startsWith("agt_")).toBe(true)
      expect(copy.status).toBe("idle")
      expect(copy.name).toBe("sibling")
      expect(copy).toMatchObject({
        parentID: "agt_parent",
        workspace: "/tmp/work",
        model: "mimo",
        provider: "opencode",
        allowedTools: ["read", "grep"],
        permissions: ["fs.read"],
        tokenBudget: 1000,
        priority: "high",
      })
      expect(copy.checkpoints).toEqual([])
      expect(copy.logs).toEqual([])
      expect(copy.tokensUsed).toBe(0)
      expect(copy.result).toBeUndefined()
    }),
  )

  it.effect("clones with history under fresh checkpoint ids", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const source = yield* agents.create({ workspace: "/tmp/work", name: "source", parentID: "agt_parent" })
      yield* agents.start(source.id)
      yield* agents.log(source.id, { level: "info", message: "hello" })
      const point = yield* agents.checkpoint(source.id, { label: "first" })
      const fresh = yield* agents.get(source.id)

      const copy = yield* agents.clone(source.id)
      expect(copy.id === source.id).toBe(false)
      expect(copy.status).toBe("idle")
      expect(copy.name).toBe("source copy")
      expect(copy.parentID).toBe("agt_parent")
      expect(copy.logs).toEqual(fresh?.logs ?? [])
      expect(copy.checkpoints).toHaveLength(1)
      expect(copy.checkpoints[0]?.label).toBe("first")
      expect(copy.checkpoints[0]?.id === point.id).toBe(false)
    }),
  )

  it.effect("gates forward motion on the token budget but never settling", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work", tokenBudget: 100 })

      const first = yield* agents.recordUsage({ id: agent.id, tokens: 60 })
      expect(first.tokensUsed).toBe(60)
      const second = yield* agents.recordUsage({ id: agent.id, tokens: 50 })
      expect(second.tokensUsed).toBe(110)

      const blocked = yield* Effect.flip(agents.start(agent.id))
      expect(blocked._tag).toBe("AgentManagerBudgetExceeded")
      expect(blocked).toMatchObject({ kind: "tokens", used: 110, budget: 100 })

      const cancelled = yield* agents.cancel(agent.id)
      expect(cancelled.status).toBe("cancelled")
    }),
  )

  it.effect("rejects negative usage and terminal recording", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })

      const negative = yield* Effect.flip(agents.recordUsage({ id: agent.id, tokens: -5 }))
      expect(negative._tag).toBe("AgentManagerInvalidUsage")

      yield* agents.start(agent.id)
      yield* agents.complete(agent.id, "done")
      const terminal = yield* Effect.flip(agents.recordUsage({ id: agent.id, tokens: 5 }))
      expect(terminal._tag).toBe("AgentManagerInvalidTransition")
    }),
  )

  it.effect("enforces the time budget only through explicit checks", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work", timeBudgetMs: 1000 })
      const started = yield* agents.start(agent.id)
      const startedAt = started.startedAt ?? 0
      expect(started.deadlineMs).toBe(startedAt + 1000)

      const inside = yield* agents.checkTimeBudget(agent.id, startedAt + 500)
      expect(inside.status).toBe("running")

      const expired = yield* Effect.flip(agents.checkTimeBudget(agent.id, startedAt + 1500))
      expect(expired._tag).toBe("AgentManagerBudgetExceeded")
      expect(expired).toMatchObject({ kind: "time", used: startedAt + 1500, budget: startedAt + 1000 })
      expect((yield* agents.get(agent.id))?.status).toBe("blocked")

      const settled = yield* agents.create({ workspace: "/tmp/work" })
      yield* agents.start(settled.id)
      yield* agents.complete(settled.id, "done")
      const terminal = yield* Effect.flip(agents.checkTimeBudget(settled.id, Date.now()))
      expect(terminal._tag).toBe("AgentManagerInvalidTransition")
    }),
  )

  it.effect("tracks checkpoints and logs with explicit timestamps", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const agent = yield* agents.create({ workspace: "/tmp/work" })
      yield* agents.start(agent.id)

      const point = yield* agents.checkpoint(agent.id, { label: "baseline", sessionID: "ses_1", now: 1000 })
      expect(point).toMatchObject({ label: "baseline", sessionID: "ses_1", createdAt: 1000 })
      expect(point.id.startsWith("ckpt_")).toBe(true)

      const entry = yield* agents.log(agent.id, { level: "debug", message: "trace", now: 1001 })
      expect(entry).toMatchObject({ level: "debug", message: "trace", createdAt: 1001 })

      const blank = yield* Effect.flip(agents.checkpoint(agent.id, { label: "  " }))
      expect(blank._tag).toBe("AgentManagerInvalidUsage")

      const seen = yield* agents.get(agent.id)
      expect(seen?.checkpoints).toHaveLength(1)
      expect(seen?.logs).toHaveLength(1)
    }),
  )

  it.effect("lists, filters, and reports missing agents", () =>
    Effect.gen(function* () {
      const agents = yield* AgentManager.make
      const parent = yield* agents.create({ workspace: "/tmp/work" })
      const first = yield* agents.create({ workspace: "/tmp/a", parentID: parent.id })
      const second = yield* agents.create({ workspace: "/tmp/b", parentID: parent.id })
      yield* agents.start(second.id)
      yield* agents.start(first.id)
      yield* agents.complete(first.id, "done")
      yield* agents.archive(first.id)

      expect((yield* agents.list()).map((info) => info.id)).toEqual([parent.id, first.id, second.id])
      expect((yield* agents.list({ includeArchived: false })).map((info) => info.id)).toEqual([parent.id, second.id])
      expect((yield* agents.list({ status: "running" })).map((info) => info.id)).toEqual([second.id])
      expect((yield* agents.list({ parentID: parent.id })).map((info) => info.id)).toEqual([first.id, second.id])

      expect(yield* agents.get("agt_missing")).toBeUndefined()
      const missing = yield* Effect.flip(agents.cancel("agt_missing"))
      expect(missing._tag).toBe("AgentManagerNotFound")
    }),
  )
})
