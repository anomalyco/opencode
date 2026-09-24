import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect } from "effect"
import { it } from "./lib/effect"

const jobsLayer = LayerNode.compile(BackgroundJob.node)

/** Mirrors the hierarchical cancellation query in run-state.ts:
 *  finds running children whose `parentSessionId` metadata matches a cancelled parent. */
function cancelChildrenOf(jobs: BackgroundJob.Interface, parentID: string) {
  return Effect.gen(function* () {
    const jobsList = yield* jobs.list()
    const children = jobsList.filter((job) => job.status === "running" && job.metadata?.parentSessionId === parentID)
    yield* Effect.forEach(children, (child) => jobs.cancel(child.id), { discard: true })
    return children.length
  })
}

describe("BackgroundJob fan-out and hierarchical cancellation", () => {
  it.live("runs concurrent children and observes each completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      // Parent launches two children that complete independently; parent joins both.
      const parent = yield* jobs.start({
        type: "parent",
        run: Effect.gen(function* () {
          const first = yield* jobs.start({
            type: "child",
            metadata: { parentType: "parent", label: "a" },
            run: Effect.succeed("a-done"),
          })
          const second = yield* jobs.start({
            type: "child",
            metadata: { parentType: "parent", label: "b" },
            run: Effect.succeed("b-done"),
          })
          const result = yield* Effect.all([jobs.wait({ id: first.id }), jobs.wait({ id: second.id })])
          return `${result[0].info?.output}|${result[1].info?.output}`
        }),
      })

      const result = yield* jobs.wait({ id: parent.id, timeout: 5000 })
      expect(result.timedOut).toBe(false)
      expect(result.info?.status).toBe("completed")
      expect(result.info?.output).toBe("a-done|b-done")

      const children = (yield* jobs.list()).filter((job) => job.metadata?.parentType === "parent")
      expect(children).toHaveLength(2)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("fans out N children concurrently, completing all before parent", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const started: Deferred.Deferred<void>[] = []
      for (let i = 0; i < 6; i++) started.push(yield* Deferred.make<void>())
      const release = yield* Deferred.make<void>()

      const parent = yield* jobs.start({
        type: "parent",
        run: Effect.gen(function* () {
          // Fork 6 children that each signal ready then block on release.
          const childStarts = started.map((latch) =>
            jobs.start({
              type: "child",
              metadata: { parentType: "parent", fanoutTest: true },
              run: Deferred.succeed(latch, undefined).pipe(
                Effect.andThen(() => Deferred.await(release).pipe(Effect.as("released"))),
              ),
            }),
          )
          // Start all children concurrently (each registers + forks its own run fiber).
          const children = yield* Effect.all(childStarts, { concurrency: "unbounded" })
          // Wait for every child to signal ready — proving they were forked concurrently.
          for (const latch of started) yield* Deferred.await(latch)
          // Release all simultaneously — proves concurrent completion, not sequential.
          yield* Deferred.succeed(release, undefined)
          // Wait for each child to settle before parent completes.
          for (const child of children) yield* jobs.wait({ id: child.id, timeout: 5000 })
          return "parent-done"
        }),
      })

      const result = yield* jobs.wait({ id: parent.id, timeout: 5000 })
      expect(result.info?.status).toBe("completed")

      const kids = (yield* jobs.list()).filter((j) => j.metadata?.fanoutTest === true)
      expect(kids).toHaveLength(6)
      expect(kids.every((k) => k.status === "completed")).toBe(true)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("canceling a parent cascades to children via parentSessionId metadata", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const parentHold = yield* Deferred.make<void>()
      const childHold = yield* Deferred.make<void>()

      const parent = yield* jobs.start({
        type: "parent",
        run: Deferred.await(parentHold).pipe(Effect.as("parent-held")),
      })

      const childA = jobs.start({
        type: "child",
        metadata: { parentType: "parent", parentSessionId: parent.id, label: "a" },
        run: Deferred.await(childHold).pipe(Effect.as("child-held")),
      })
      const childB = jobs.start({
        type: "child",
        metadata: { parentType: "parent", parentSessionId: parent.id, label: "b" },
        run: Deferred.await(childHold).pipe(Effect.as("child-held")),
      })
      yield* Effect.all([childA, childB], { discard: true })

      yield* Effect.sleep("50 millis")
      const before = (yield* jobs.list()).filter((j) => j.metadata?.parentSessionId === parent.id)
      expect(before).toHaveLength(2)
      expect(before.every((j) => j.status === "running")).toBe(true)

      // Cascade: cancel parent, then find + cancel its running children by metadata.
      yield* jobs.cancel(parent.id)
      const cancelled = yield* cancelChildrenOf(jobs, parent.id)
      expect(cancelled).toBe(2)

      yield* Effect.sleep("10 millis")
      const parentAfter = yield* jobs.get(parent.id)
      expect(parentAfter?.status).toBe("cancelled")
      const runningChildren = (yield* jobs.list()).filter(
        (j) => j.metadata?.parentSessionId === parent.id && j.status === "running",
      )
      expect(runningChildren).toHaveLength(0)
    }).pipe(Effect.provide(jobsLayer)),
  )
})
