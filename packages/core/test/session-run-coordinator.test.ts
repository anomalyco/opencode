import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

describe("SessionRunCoordinator", () => {
  it.effect("joins concurrent resumes for one key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.sync(() => runs++).pipe(Effect.andThen(Deferred.await(gate))),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow

        expect(runs).toBe(1)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("starts a drain when woken while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drained = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Deferred.succeed(drained, undefined) })

        yield* coordinator.wake("session")
        yield* Deferred.await(drained)
      }),
    ),
  )

  it.effect("coalesces wakes received during an active run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(Effect.flatMap((run) => (run === 1 ? Deferred.await(gate) : Effect.void))),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Effect.all([coordinator.wake("session"), coordinator.wake("session"), coordinator.wake("session")], {
          concurrency: "unbounded",
        })
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("waits for a coalesced ownership chain to become idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstGate = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const idleSettled = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(firstGate)
                  : Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate))),
              ),
            ),
        })

        yield* coordinator.wake("session")
        const idle = yield* coordinator
          .awaitIdle("session")
          .pipe(Effect.andThen(Deferred.succeed(idleSettled, undefined)), Effect.forkChild)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        expect(yield* Deferred.isDone(idleSettled)).toBeFalse()
        yield* Deferred.succeed(secondGate, undefined)
        yield* Fiber.join(idle)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("reports the first defect after a failed chain becomes idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstGate = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const defect = new Error("defect")
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(firstGate).pipe(Effect.andThen(Effect.die(defect)))
                  : Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate))),
              ),
            ),
        })

        yield* coordinator.wake("session")
        const idle = yield* coordinator
          .awaitIdle("session")
          .pipe(Effect.catchDefect(Effect.succeed), Effect.forkChild({ startImmediately: true }))
        yield* coordinator.wake("session")
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* Deferred.succeed(secondGate, undefined)

        expect(yield* Fiber.join(idle)).toBe(defect)
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("runs again when woken during the coalesced drain", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(firstGate)
                  : run === 2
                    ? Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate)))
                    : Effect.void,
              ),
            ),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(secondGate, undefined)
        yield* Fiber.join(first)

        expect(runs).toBe(3)
      }),
    ),
  )

  it.effect("starts one successor after a wake races with failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const failure = new Error("failed")
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1 ? Deferred.await(gate).pipe(Effect.andThen(Effect.fail(failure))) : Effect.void,
              ),
            ),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(gate, undefined)
        expect(yield* Fiber.join(first).pipe(Effect.flip)).toBe(failure)

        yield* Effect.yieldNow
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("upgrades an active wake when an explicit run joins it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const wakeStarted = yield* Deferred.make<void>()
        const wakeGate = yield* Deferred.make<void>()
        const modes: SessionRunCoordinator.Mode[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: (_key, mode) =>
            Effect.sync(() => modes.push(mode)).pipe(
              Effect.andThen(
                mode === "wake"
                  ? Deferred.succeed(wakeStarted, undefined).pipe(Effect.andThen(Deferred.await(wakeGate)))
                  : Effect.void,
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(wakeStarted)
        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(wakeGate, undefined)
        yield* Fiber.join(run)

        expect(modes).toEqual(["wake", "run"])
      }),
    ),
  )

  it.effect("upgrades a recursive wake drain when an explicit run joins it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runGate = yield* Deferred.make<void>()
        const wakeStarted = yield* Deferred.make<void>()
        const wakeGate = yield* Deferred.make<void>()
        const forcedStarted = yield* Deferred.make<void>()
        const modes: SessionRunCoordinator.Mode[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: (_key, mode) =>
            Effect.gen(function* () {
              modes.push(mode)
              if (modes.length === 1) return yield* Deferred.await(runGate)
              if (modes.length === 2)
                return yield* Deferred.succeed(wakeStarted, undefined).pipe(Effect.andThen(Deferred.await(wakeGate)))
              yield* Deferred.succeed(forcedStarted, undefined)
            }),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(runGate, undefined)
        yield* Deferred.await(wakeStarted)
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(wakeGate, undefined)
        yield* Deferred.await(forcedStarted)
        yield* Fiber.join(first)
        yield* Fiber.join(second)

        expect(modes).toEqual(["run", "wake", "run"])
      }),
    ),
  )

  it.effect("propagates an upgraded explicit run failure before a successful advisory successor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const wakeStarted = yield* Deferred.make<void>()
        const wakeGate = yield* Deferred.make<void>()
        const runStarted = yield* Deferred.make<void>()
        const runGate = yield* Deferred.make<void>()
        const advisoryStarted = yield* Deferred.make<void>()
        const failure = new Error("explicit run failed")
        const modes: SessionRunCoordinator.Mode[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, void, Error>({
          drain: (_key, mode) =>
            Effect.sync(() => modes.push(mode)).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(wakeStarted, undefined).pipe(Effect.andThen(Deferred.await(wakeGate)))
                  : run === 2
                    ? Deferred.succeed(runStarted, undefined).pipe(
                        Effect.andThen(Deferred.await(runGate)),
                        Effect.andThen(Effect.fail(failure)),
                      )
                    : Deferred.succeed(advisoryStarted, undefined),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(wakeStarted)
        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(wakeGate, undefined)
        yield* Deferred.await(runStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(runGate, undefined)
        yield* Deferred.await(advisoryStarted)

        expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
        expect(modes).toEqual(["wake", "run", "wake"])
      }),
    ),
  )

  it.effect("settles active callers when its owning scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const started = yield* Deferred.make<void>()
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      }).pipe(Scope.provide(scope))

      const run = yield* coordinator.run("session").pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const idle = yield* coordinator.awaitIdle("session").pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Scope.close(scope, Exit.void)

      const runExit = yield* Fiber.await(run)
      const idleExit = yield* Fiber.await(idle)
      expect(Exit.isFailure(runExit) && Cause.hasInterruptsOnly(runExit.cause)).toBeTrue()
      expect(Exit.isSuccess(idleExit)).toBeTrue()
    }),
  )

  it.effect("does not start work after its owning scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      let runs = 0
      const coordinator = yield* SessionRunCoordinator.make({
        drain: () => Effect.sync(() => runs++),
      }).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)

      yield* coordinator.wake("session")
      yield* coordinator.awaitIdle("session")
      const runExit = yield* coordinator.run("session").pipe(Effect.exit)

      expect(Exit.isFailure(runExit) && Cause.hasInterruptsOnly(runExit.cause)).toBeTrue()
      expect(runs).toBe(0)
    }),
  )

  it.effect("does not cancel the owner when one joined waiter is interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.sync(() => runs++).pipe(Effect.andThen(Deferred.await(gate))),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Fiber.interrupt(second)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)

        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("runs different keys concurrently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const bothStarted = yield* Deferred.make<void>()
        let active = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++active).pipe(
              Effect.tap(() => (active === 2 ? Deferred.succeed(bothStarted, undefined) : Effect.void)),
              Effect.andThen(Deferred.await(gate)),
            ),
        })

        const first = yield* coordinator.run("first").pipe(Effect.forkChild)
        const second = yield* coordinator.run("second").pipe(Effect.forkChild)
        yield* Deferred.await(bothStarted)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    ),
  )
})
