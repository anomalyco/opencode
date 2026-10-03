import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { TaskGraphJobs } from "@opencode-ai/core/task-graph-jobs"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { it } from "./lib/effect"

const jobsLayer = LayerNode.compile(BackgroundJob.node)

const gate = (started: Deferred.Deferred<void>, hold: Deferred.Deferred<void>) =>
  Deferred.succeed(started, undefined).pipe(Effect.andThen(() => Deferred.await(hold).pipe(Effect.as("held"))))

describe("TaskGraphJobs", () => {
  it.live("runs every node as a tagged background job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const outcomes = yield* TaskGraphJobs.run(
        jobs,
        [
          { id: "a", run: Effect.succeed("a-done") },
          { id: "b", dependsOn: ["a"], run: Effect.succeed("b-done") },
          { id: "c", dependsOn: ["a"], run: Effect.succeed("c-done") },
          { id: "d", dependsOn: ["b", "c"], run: Effect.succeed("d-done") },
        ],
        { parentSessionID: "ses_parent" },
      )
      expect(outcomes.get("a")).toEqual({ status: "completed", value: "a-done" })
      expect(outcomes.get("d")).toEqual({ status: "completed", value: "d-done" })

      const listed = yield* jobs.list()
      expect(listed).toHaveLength(4)
      expect(listed.every((job) => job.type === "task-graph-node" && job.status === "completed")).toBe(true)
      expect(listed.every((job) => job.metadata?.parentSessionId === "ses_parent")).toBe(true)
      const jobD = listed.find((job) => job.metadata?.nodeId === "d")
      expect(jobD?.title).toBe("d")
      expect(jobD?.metadata?.dependsOn).toEqual(["b", "c"])
      expect(jobD?.output).toBe("d-done")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("keeps typed node values while jobs persist text output", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const outcomes = yield* TaskGraphJobs.run(jobs, [{ id: "count", run: Effect.succeed(42) }])
      expect(outcomes.get("count")).toEqual({ status: "completed", value: 42 })
      const listed = yield* jobs.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]?.status).toBe("completed")
      expect(listed[0]?.output).toBe("42")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("keeps typed node errors while jobs record error text", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const thrown = new Error("boom")
      const outcomes = yield* TaskGraphJobs.run(jobs, [
        { id: "fail", run: Effect.fail(thrown) },
        { id: "child", dependsOn: ["fail"], run: Effect.succeed("unreached") },
        { id: "solo", run: Effect.succeed("solo-done") },
      ])
      expect(outcomes.get("fail")).toEqual({ status: "failed", error: thrown })
      expect(outcomes.get("child")).toEqual({ status: "skipped", reason: "dependency-failed" })
      expect(outcomes.get("solo")).toEqual({ status: "completed", value: "solo-done" })

      const listed = yield* jobs.list()
      expect(listed).toHaveLength(2)
      const failed = listed.find((job) => job.metadata?.nodeId === "fail")
      expect(failed?.status).toBe("error")
      expect(failed?.error).toBe("boom")
      expect(listed.some((job) => job.metadata?.nodeId === "child")).toBe(false)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("cancelling node jobs by parentSessionId aborts the drain", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const started = yield* Deferred.make<void>()
      const hold = yield* Deferred.make<void>()
      const fiber = yield* TaskGraphJobs.run(jobs, [{ id: "blocked", run: gate(started, hold) }], {
        parentSessionID: "ses_parent",
      }).pipe(Effect.forkScoped)
      yield* Deferred.await(started)

      // Mirrors the hierarchical cancellation query in run-state.ts.
      const running = (yield* jobs.list()).filter(
        (job) => job.status === "running" && job.metadata?.parentSessionId === "ses_parent",
      )
      expect(running).toHaveLength(1)
      yield* Effect.forEach(running, (job) => jobs.cancel(job.id), { discard: true })

      const exit = yield* Fiber.join(fiber).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)

      const after = yield* jobs.list()
      expect(after.find((job) => job.metadata?.nodeId === "blocked")?.status).toBe("cancelled")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("interrupting the drain cancels its running node jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const started = yield* Deferred.make<void>()
      const hold = yield* Deferred.make<void>()
      const fiber = yield* TaskGraphJobs.run(jobs, [{ id: "blocked", run: gate(started, hold) }]).pipe(
        Effect.forkScoped,
      )
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)

      const after = yield* jobs.list()
      expect(after).toHaveLength(1)
      expect(after[0]?.status).toBe("cancelled")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("starts no jobs when the graph is invalid", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const error = yield* TaskGraphJobs.run(jobs, [
        { id: "a", dependsOn: ["b"], run: Effect.succeed("a") },
        { id: "b", dependsOn: ["a"], run: Effect.succeed("b") },
      ]).pipe(Effect.flip)
      expect(error._tag).toBe("TaskGraphCycle")
      expect(yield* jobs.list()).toHaveLength(0)
    }).pipe(Effect.provide(jobsLayer)),
  )
})
