import { describe, expect } from "bun:test"
import { TaskGraph } from "@opencode-ai/core/task-graph"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { it } from "./lib/effect"

describe("TaskGraph", () => {
  it.effect("groups a diamond into parallel waves", () =>
    Effect.gen(function* () {
      const waves = yield* Effect.sync(() =>
        TaskGraph.layers([
          { id: "a" },
          { id: "b", dependsOn: ["a"] },
          { id: "c", dependsOn: ["a"] },
          { id: "d", dependsOn: ["b", "c"] },
        ]),
      )
      expect(waves).toEqual([["a"], ["b", "c"], ["d"]])
    }),
  )

  it.effect("rejects duplicate node ids", () =>
    Effect.gen(function* () {
      const error = yield* TaskGraph.run([
        { id: "a", run: Effect.succeed("ok") },
        { id: "a", run: Effect.succeed("dup") },
      ]).pipe(Effect.flip)
      expect(error._tag).toBe("TaskGraphDuplicateNode")
    }),
  )

  it.effect("rejects unknown dependencies", () =>
    Effect.gen(function* () {
      const error = yield* TaskGraph.run([{ id: "a", dependsOn: ["missing"], run: Effect.succeed("ok") }]).pipe(
        Effect.flip,
      )
      expect(error._tag).toBe("TaskGraphUnknownDependency")
    }),
  )

  it.effect("rejects dependency cycles", () =>
    Effect.gen(function* () {
      const mutual = yield* TaskGraph.run([
        { id: "a", dependsOn: ["b"], run: Effect.succeed("a") },
        { id: "b", dependsOn: ["a"], run: Effect.succeed("b") },
      ]).pipe(Effect.flip)
      expect(mutual._tag).toBe("TaskGraphCycle")
      const loop = yield* TaskGraph.run([{ id: "a", dependsOn: ["a"], run: Effect.succeed("a") }]).pipe(Effect.flip)
      expect(loop._tag).toBe("TaskGraphCycle")
    }),
  )

  it.effect("runs a chain in dependency order", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<string[]>([])
      const track = (id: string) => Ref.update(order, (all) => [...all, id]).pipe(Effect.as(`${id}-done`))
      const outcomes = yield* TaskGraph.run([
        { id: "a", run: track("a") },
        { id: "b", dependsOn: ["a"], run: track("b") },
        { id: "c", dependsOn: ["b"], run: track("c") },
      ])
      expect(yield* Ref.get(order)).toEqual(["a", "b", "c"])
      expect(outcomes.get("c")).toEqual({ status: "completed", value: "c-done" })
    }),
  )

  it.effect("starts independent nodes concurrently", () =>
    Effect.gen(function* () {
      const startedA = yield* Deferred.make<void>()
      const startedB = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const gate = (started: Deferred.Deferred<void>, value: string) =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(() => Deferred.await(release).pipe(Effect.as(value))))
      const fiber = yield* TaskGraph.run([
        { id: "a", run: gate(startedA, "a-done") },
        { id: "b", run: gate(startedB, "b-done") },
      ]).pipe(Effect.forkScoped)
      // Both nodes must be running before either can complete.
      yield* Deferred.await(startedA)
      yield* Deferred.await(startedB)
      yield* Deferred.succeed(release, undefined)
      const outcomes = yield* Fiber.join(fiber)
      expect(outcomes.get("a")).toEqual({ status: "completed", value: "a-done" })
      expect(outcomes.get("b")).toEqual({ status: "completed", value: "b-done" })
    }),
  )

  it.effect("skips dependents of failed nodes but runs the rest", () =>
    Effect.gen(function* () {
      const outcomes = yield* TaskGraph.run([
        { id: "fail", run: Effect.fail("boom") },
        { id: "child", dependsOn: ["fail"], run: Effect.succeed("unreached") },
        { id: "solo", run: Effect.succeed("solo-done") },
      ])
      expect(outcomes.get("fail")).toEqual({ status: "failed", error: "boom" })
      expect(outcomes.get("child")).toEqual({ status: "skipped", reason: "dependency-failed" })
      expect(outcomes.get("solo")).toEqual({ status: "completed", value: "solo-done" })
    }),
  )

  it.effect("fail-fast skips every remaining wave after a failure", () =>
    Effect.gen(function* () {
      const outcomes = yield* TaskGraph.run(
        [
          { id: "fail", run: Effect.fail("boom") },
          { id: "solo", run: Effect.succeed("solo-done") },
          { id: "child", dependsOn: ["fail"], run: Effect.succeed("unreached") },
        ],
        { failFast: true },
      )
      expect(outcomes.get("fail")).toEqual({ status: "failed", error: "boom" })
      expect(outcomes.get("solo")).toEqual({ status: "completed", value: "solo-done" })
      expect(outcomes.get("child")).toEqual({ status: "skipped", reason: "fail-fast" })
    }),
  )

  it.effect("returns an empty map for an empty graph", () =>
    Effect.gen(function* () {
      expect((yield* TaskGraph.run([])).size).toBe(0)
    }),
  )
})
