import { describe, expect } from "bun:test"
import { CodeModeJob } from "@opencode/core/codemode/job"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { ToolOutput } from "@opencode/core/tool-output"
import { WaitTool } from "@opencode/core/tool/plugin/wait"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { DateTime, Deferred, Effect, Fiber, Layer, Queue, Schedule, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity, toolNodeReplacements } from "./lib/tool"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Tool.node, Job.node, Database.node, Global.node]), toolNodeReplacements()),
    Flag.testLayer([], { overrides: "full_codemode" }),
    Layer.mock(ToolOutput.Service, { truncate: (result) => Effect.succeed(result) }),
  ),
)

const sessionID = Session.ID.make("ses_wait")

const register = (fullCodeMode: boolean) =>
  registerToolPlugin(WaitTool.Plugin, { event: { subscribe: () => Stream.never } }).pipe(
    Effect.provide(
      Flag.testLayer([
        new Document({
          type: "document",
          info: new Info({ experimental: new ConfigExperimental.Info({ full_codemode: fullCodeMode }) }),
        }),
      ]),
    ),
    Effect.provide(permissionLayer({ assert: () => Effect.void })),
  )

const context = (id = "call_script"): Tool.Context => ({
  sessionID,
  ...toolIdentity,
  id: Tool.CallID.make(id),
  progress: () => Effect.void,
})

type Waited = { readonly jobs: ReadonlyArray<{ id: string; status: string; output?: string }> }

const harness = Effect.fnUntraced(function* (hold: Effect.Effect<void> = Effect.void) {
  const jobs = yield* Job.Service
  const holding = yield* Queue.unbounded<void>()
  // Tells the test once a wait holds its jobs' notifications.
  yield* register(true).pipe(
    Effect.provideService(Job.Service, {
      ...jobs,
      collect: (ids, until) => jobs.collect(ids, Queue.offer(holding, undefined).pipe(Effect.andThen(until))),
    }),
  )
  const registry = yield* Tool.Service
  const notices = yield* Queue.unbounded<{ text: string; metadata?: Record<string, unknown> }>()
  const run = yield* CodeModeJob.make(
    jobs,
    (input) =>
      hold.pipe(
        Effect.andThen(Queue.offer(notices, input)),
        Effect.as({
          type: "synthetic" as const,
          payload: { text: input.text, description: input.description, metadata: input.metadata },
          delivery: "queue" as const,
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          time: { created: DateTime.makeUnsafe(0) },
        }),
      ),
    yield* Scope.make(),
  )
  if (!run) throw new Error("no job runner")
  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], output: value, metadata: {} })
  // A background script that finishes with `value` once `done` resolves.
  const background = (value: string, done: Effect.Effect<void> = Effect.void) =>
    run(context(), () => done.pipe(Effect.as(text(value))), { background: true }).pipe(
      Effect.map((result) => String(result.metadata?.jobID)),
    )
  const wait = (input: { ids?: string[]; timeout?: number }) =>
    executeTool(registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: `call_wait_${Math.random()}`, name: WaitTool.name, input },
    }).pipe(Effect.map((result) => result.output as Waited))
  return { jobs, notices, run, text, background, wait, holding: Queue.take(holding) }
})

describe("WaitTool", () => {
  it.effect("is only registered, and pinned, with full_codemode", () =>
    Effect.gen(function* () {
      yield* register(false)
      const registry = yield* Tool.Service
      expect((yield* registry.list()).some((tool) => tool.name === WaitTool.name)).toBe(false)
      yield* register(true)
      const tool = (yield* registry.list()).find((tool) => tool.name === WaitTool.name)
      expect(tool?.options?.codemode).toEqual({ pinned: true })
    }),
  )

  it.live("waits for every listed job", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const firstDone = yield* Deferred.make<void>()
      const secondDone = yield* Deferred.make<void>()
      const first = yield* h.background("one", Deferred.await(firstDone))
      const second = yield* h.background("two", Deferred.await(secondDone))
      const waiting = yield* h.wait({ ids: [first, second] }).pipe(Effect.forkChild)
      yield* h.holding
      yield* Deferred.succeed(firstDone, undefined)
      yield* h.jobs.wait({ id: first })
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(secondDone, undefined)
      expect(yield* Fiber.join(waiting)).toEqual({
        jobs: [
          { id: first, status: "completed", output: "one" },
          { id: second, status: "completed", output: "two" },
        ],
      })
    }),
  )

  it.live("without ids, returns once any of the session's jobs finishes", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const slowDone = yield* Deferred.make<void>()
      const fastDone = yield* Deferred.make<void>()
      const slow = yield* h.background("slow", Deferred.await(slowDone))
      const fast = yield* h.background("fast", Deferred.await(fastDone))
      const waiting = yield* h.wait({}).pipe(Effect.forkChild)
      yield* h.holding
      yield* Deferred.succeed(fastDone, undefined)
      expect(yield* Fiber.join(waiting)).toEqual({
        jobs: [
          { id: slow, status: "running" },
          { id: fast, status: "completed", output: "fast" },
        ],
      })
      yield* Deferred.succeed(slowDone, undefined)
    }),
  )

  it.live("returns at its timeout with what is still running", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const id = yield* h.background("late", Effect.never)
      expect(yield* h.wait({ ids: [id], timeout: 30 })).toEqual({ jobs: [{ id, status: "running" }] })
      yield* h.jobs.cancel(id)
    }),
  )

  it.live("returns a job that already finished, and reports unknown IDs", () =>
    Effect.gen(function* () {
      const latch = yield* Deferred.make<void>()
      // Holds the notice back, so the finished job is still tracked.
      const h = yield* harness(Deferred.await(latch))
      const id = yield* h.background("early")
      yield* h.jobs.wait({ id })
      expect(yield* h.wait({ ids: [id, "cm_missing"] })).toEqual({
        jobs: [
          { id, status: "completed", output: "early" },
          { id: "cm_missing", status: "unknown" },
        ],
      })
      yield* Deferred.succeed(latch, undefined)
    }),
  )

  it.live("reports a cancelled job, and an interrupted wait leaves its jobs running", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const id = yield* h.background("never", Effect.never)
      const waiting = yield* h.wait({ ids: [id] }).pipe(Effect.forkChild)
      yield* h.holding
      yield* Fiber.interrupt(waiting)
      expect((yield* h.jobs.get(id))?.status).toBe("running")
      const again = yield* h.wait({ ids: [id] }).pipe(Effect.forkChild)
      yield* h.holding
      yield* h.jobs.cancel(id)
      expect(yield* Fiber.join(again)).toEqual({ jobs: [{ id, status: "cancelled" }] })
    }),
  )

  it.live("a result returned by wait is not notified again", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const latch = yield* Deferred.make<void>()
      const waited = yield* h.background("waited", Deferred.await(latch))
      const notified = yield* h.background("notified", Deferred.await(latch))
      const waiting = yield* h.wait({ ids: [waited] }).pipe(Effect.forkChild)
      yield* h.holding
      yield* Deferred.succeed(latch, undefined)
      expect(yield* Fiber.join(waiting)).toEqual({ jobs: [{ id: waited, status: "completed", output: "waited" }] })
      expect((yield* Queue.take(h.notices)).metadata?.jobID).toBe(notified)
      // Both outbox rows go, so nothing is replayed after a restart, and no other notice was sent.
      yield* h.jobs.pendingBackground.pipe(
        Effect.repeat({ until: (rows) => rows.length === 0, schedule: Schedule.spaced("5 millis") }),
        Effect.timeout("5 seconds"),
      )
      expect(yield* Queue.size(h.notices)).toBe(0)
    }),
  )

  it.effect("keeps its script blocking only while it waits, up to ten minutes after the script began", () =>
    Effect.gen(function* () {
      const h = yield* harness()
      const latch = yield* Deferred.make<void>()
      const job = yield* h.background("job", Deferred.await(latch))
      const script = yield* h
        .run(context("call_waiting"), () =>
          h.wait({ ids: [job], timeout: 5 * 60 * 1_000 }).pipe(Effect.map((result) => h.text(JSON.stringify(result)))),
        )
        .pipe(Effect.forkChild)
      yield* h.holding
      // Past the two-minute block, the script still blocks.
      yield* TestClock.adjust("3 minutes")
      expect(script.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(latch, undefined)
      const result = yield* Fiber.join(script)
      expect(result.metadata?.jobID).toBeUndefined()
      expect(JSON.parse(String(result.output))).toEqual({ jobs: [{ id: job, status: "completed", output: "job" }] })

      // Time spent waiting doesn't count toward the usual two minutes, and the rest of the script gets what is left.
      const quickDone = yield* Deferred.make<void>()
      const quick = yield* h.background("quick", Deferred.await(quickDone))
      const after = yield* h
        .run(context("call_after"), () =>
          Effect.sleep("1 minute").pipe(
            Effect.andThen(h.wait({ ids: [quick] })),
            Effect.andThen(Effect.sleep("8 minutes")),
            Effect.as(h.text("")),
          ),
        )
        .pipe(Effect.forkChild)
      yield* TestClock.adjust("1 minute")
      yield* h.holding
      yield* TestClock.adjust("3 minutes")
      yield* Deferred.succeed(quickDone, undefined)
      yield* h.jobs.wait({ id: quick })
      yield* TestClock.adjust("59 seconds")
      expect(after.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect((yield* Fiber.join(after)).metadata?.jobID).toStartWith("cm_")

      // A longer wait moves its script to the background at ten minutes.
      const other = yield* h.background("other", Effect.never)
      const long = yield* h
        .run(context("call_long"), () => h.wait({ ids: [other], timeout: 60 * 60 * 1_000 }).pipe(Effect.as(h.text(""))))
        .pipe(Effect.forkChild)
      yield* h.holding
      yield* TestClock.adjust("9 minutes")
      expect(long.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 minute")
      expect((yield* Fiber.join(long)).metadata?.jobID).toStartWith("cm_")
      yield* h.jobs.cancel(other)
    }),
  )
})
