import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
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
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("joins a wake-started execution without forcing a successor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const forces: boolean[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (_key, force) =>
            Effect.sync(() => forces.push(force)).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(gate)),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(resumed)

        expect(forces).toEqual([false])
      }),
    ),
  )

  it.effect("starts execution when woken while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drained = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Deferred.succeed(drained, undefined) })

        yield* coordinator.wake("session")
        yield* Deferred.await(drained)
      }),
    ),
  )

  it.effect("snapshots only active executions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (key: string) =>
            Deferred.succeed(key === "first" ? firstStarted : secondStarted, undefined).pipe(
              Effect.andThen(Deferred.await(key === "first" ? firstGate : secondGate)),
            ),
        })

        expect(Array.from(yield* coordinator.active)).toEqual([])
        const first = yield* coordinator.run("first").pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        expect(Array.from(yield* coordinator.active)).toEqual(["first"])

        const second = yield* coordinator.run("second").pipe(Effect.forkChild)
        yield* Deferred.await(secondStarted)
        expect(Array.from(yield* coordinator.active)).toEqual(["first", "second"])

        yield* Deferred.succeed(firstGate, undefined)
        yield* Fiber.join(first)
        expect(Array.from(yield* coordinator.active)).toEqual(["second"])
        yield* Deferred.succeed(secondGate, undefined)
        yield* Fiber.join(second)
        expect(Array.from(yield* coordinator.active)).toEqual([])
      }),
    ),
  )

  it.effect("cleans active executions after failure and defect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = new Error("failed")
        const defect = new Error("defect")
        const settled: Exit.Exit<void, Error>[] = []
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (key: string) => (key === "failure" ? Effect.fail(failure) : Effect.die(defect)),
          settled: (_key, exit) => Effect.sync(() => void settled.push(exit)),
        })

        const failed = yield* coordinator.run("failure").pipe(Effect.exit)
        expect(Exit.isFailure(failed) && Cause.hasFails(failed.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])

        const died = yield* coordinator.run("defect").pipe(Effect.exit)
        expect(Exit.isFailure(died) && Cause.hasDies(died.cause)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])
        expect(settled).toHaveLength(2)
      }),
    ),
  )

  it.effect("preserves settlement hook defects while releasing ownership", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const defect = new Error("terminal publication failed")
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.void,
          settled: () => Effect.die(defect),
        })

        const exit = yield* coordinator.run("session").pipe(Effect.exit)

        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(defect)
        expect(yield* coordinator.active).toEqual(new Set())
      }),
    ),
  )

  it.effect("cleans active executions when its scope closes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const coordinator = yield* Effect.scoped(
        Effect.gen(function* () {
          const coordinator = yield* SessionRunCoordinator.make({
            drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          })
          yield* coordinator.wake("session")
          yield* Deferred.await(started)
          expect(Array.from(yield* coordinator.active)).toEqual(["session"])
          return coordinator
        }),
      )

      expect(Array.from(yield* coordinator.active)).toEqual([])
    }),
  )

  it.effect("coalesces wakes received during active execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstGate)))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        yield* Effect.all([coordinator.wake("session"), coordinator.wake("session"), coordinator.wake("session")], {
          concurrency: "unbounded",
        })
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* Fiber.join(resumed)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("runs again when woken during the follow-up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const thirdStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(firstGate)
                  : run === 2
                    ? Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate)))
                    : Deferred.succeed(thirdStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(secondGate, undefined)
        yield* Deferred.await(thirdStarted)
        yield* Fiber.join(resumed)

        expect(runs).toBe(3)
      }),
    ),
  )

  it.effect("does nothing when interrupted while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reasons: Array<string | undefined> = []
        const coordinator = yield* SessionRunCoordinator.make<string, never, string>({
          drain: () => Effect.void,
          settled: (_key, _exit, reason) => Effect.sync(() => void reasons.push(reason)),
        })
        yield* coordinator.interrupt("session", "user")
        yield* coordinator.run("session")
        expect(reasons).toEqual([undefined])
      }),
    ),
  )

  it.effect("does not attach a late interrupt reason after terminal settlement starts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settling = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const reasons: Array<string | undefined> = []
        const coordinator = yield* SessionRunCoordinator.make<string, never, string>({
          drain: () => Effect.void,
          settled: (_key, _exit, reason) =>
            Deferred.succeed(settling, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(Effect.sync(() => void reasons.push(reason))),
            ),
        })

        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(settling)
        yield* coordinator.interrupt("session", "user")
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(run)
        yield* coordinator.run("session")

        expect(reasons).toEqual([undefined, undefined])
      }),
    ),
  )

  it.effect("a settlement-window wake starts a fresh execution with its own scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settling = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const scopes: SessionInbox.Promotable[] = []
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (_key, _force, scope) => Effect.sync(() => scopes.push(scope)),
          settled: () => Deferred.succeed(settling, undefined).pipe(Effect.andThen(Deferred.await(release))),
        })

        yield* coordinator.wake("session", "steer")
        yield* Deferred.await(settling)
        yield* coordinator.wake("session", "input")
        yield* Deferred.succeed(release, undefined)
        yield* coordinator.awaitIdle("session")

        expect(scopes).toEqual(["steer", "input"])
      }),
    ),
  )

  it.effect("interrupts active execution and clears its pending wake", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        let runs = 0
        const reasons: Array<string | undefined> = []
        const coordinator = yield* SessionRunCoordinator.make<string, never, string>({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
          settled: (_key, _exit, reason) => Effect.sync(() => void reasons.push(reason)),
        })

        const first = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const second = yield* coordinator.run("session").pipe(Effect.forkChild)
        const idle = yield* coordinator.awaitIdle("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* coordinator.interrupt("session", "user")
        yield* Deferred.await(interrupted)

        const exits = yield* Fiber.awaitAll([first, second, idle])
        expect(
          exits.slice(0, 2).every((exit) => Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)),
        ).toBeTrue()
        expect(exits.slice(2).every(Exit.isSuccess)).toBeTrue()
        expect(Array.from(yield* coordinator.active)).toEqual([])
        expect(runs).toBe(1)
        expect(reasons).toEqual(["user"])
      }),
    ),
  )

  it.effect("runs a wake registered during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        let starts = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                      ),
                    )
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
          started: () => Effect.sync(() => starts++).pipe(Effect.asVoid),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(interrupt)
        yield* Deferred.await(secondStarted)

        expect(runs).toBe(2)
        expect(starts).toBe(2)
      }),
    ),
  )

  it.effect("coalesces drain scopes with input taking precedence", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const scopes: SessionInbox.Promotable[] = []
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (_key, _force, scope) =>
            Effect.gen(function* () {
              scopes.push(scope)
              if (scopes.length !== 1) return
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(release)
            }),
        })

        yield* coordinator.wake("session", "steer")
        yield* Deferred.await(firstStarted)
        yield* coordinator.wake("session", "steer")
        yield* coordinator.wake("session", "input")
        yield* Deferred.succeed(release, undefined)
        yield* coordinator.awaitIdle("session")

        expect(scopes).toEqual(["steer", "input"])
      }),
    ),
  )

  it.effect("does not carry a completed input scope into a steer drain", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const scopes: SessionInbox.Promotable[] = []
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (_key, _force, scope) =>
            Effect.gen(function* () {
              scopes.push(scope)
              if (scopes.length !== 1) return
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(release)
            }),
        })

        yield* coordinator.wake("session", "input")
        yield* Deferred.await(firstStarted)
        yield* coordinator.wake("session", "steer")
        yield* Deferred.succeed(release, undefined)
        yield* coordinator.awaitIdle("session")

        expect(scopes).toEqual(["input", "steer"])
      }),
    ),
  )

  it.effect("a cleanup-era wake starts a successor with its own scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const scopes: SessionInbox.Promotable[] = []
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (_key, _force, scope) =>
            Effect.gen(function* () {
              scopes.push(scope)
              if (scopes.length !== 1) return
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Effect.never.pipe(
                Effect.onInterrupt(() =>
                  Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                ),
              )
            }),
        })

        yield* coordinator.wake("session", "input")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        // A new admission during cancellation restarts normally: interruption only
        // claims the wakes recorded before it.
        yield* coordinator.wake("session", "input")
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(interrupt)
        yield* coordinator.awaitIdle("session")

        expect(scopes).toEqual(["input", "input"])
      }),
    ),
  )

  it.effect("starts a resume registered during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const forces: boolean[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (_key, force) => {
            forces.push(force)
            return forces.length === 1
              ? Deferred.succeed(firstStarted, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() =>
                    Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                  ),
                )
              : Deferred.succeed(secondStarted, undefined)
          },
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Effect.all([Fiber.join(interrupt), Fiber.join(resumed)])
        yield* Deferred.await(secondStarted)

        expect(forces).toEqual([false, true])
      }),
    ),
  )

  it.effect("starts one follow-up when a wake races with failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const failure = new Error("failed")
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.await(gate).pipe(Effect.andThen(Effect.fail(failure)))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        const resumed = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session")
        yield* Deferred.succeed(gate, undefined)

        expect(yield* Fiber.join(resumed).pipe(Effect.flip)).toBe(failure)
        yield* Deferred.await(secondStarted)
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("does not cancel execution when a joined waiter is interrupted", () =>
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
        yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      }),
    ),
  )

  it.effect("settles once per execution across coalesced drains", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const idle = yield* Deferred.make<void>()
        let drains = 0
        let starts = 0
        const settled: Exit.Exit<void, never>[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: () =>
            Effect.sync(() => ++drains).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
                  : Effect.void,
              ),
              Effect.asVoid,
            ),
          started: () => Effect.sync(() => starts++).pipe(Effect.asVoid),
          settled: (_key, exit) =>
            Effect.sync(() => void settled.push(exit)).pipe(
              Effect.andThen(Deferred.succeed(idle, undefined)),
              Effect.asVoid,
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        yield* coordinator.wake("session")
        yield* Deferred.succeed(gate, undefined)
        yield* Deferred.await(idle)

        expect(drains).toBe(2)
        expect(starts).toBe(1)
        expect(settled).toHaveLength(1)
        expect(Exit.isSuccess(settled[0]!)).toBe(true)
      }),
    ),
  )

  it.effect("settles interrupted executions before waiters resolve", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const settled: Exit.Exit<void, never>[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate))),
          settled: (_key, exit) => Effect.sync(() => void settled.push(exit)),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        yield* coordinator.interrupt("session")
        yield* coordinator.awaitIdle("session")

        expect(settled).toHaveLength(1)
        expect(settled[0] !== undefined && Exit.isFailure(settled[0]) && Cause.hasInterrupts(settled[0].cause)).toBe(
          true,
        )
        expect(yield* coordinator.active).toEqual(new Set())
      }),
    ),
  )

  it.effect("acknowledges interruption before cleanup settles", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const settled: Array<string | undefined> = []
        const coordinator = yield* SessionRunCoordinator.make<string, never, string>({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
              ),
            ),
          settled: (_key, _exit, reason) => Effect.sync(() => void settled.push(reason)),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        // Interrupt resolves while the cleanup gate is still closed: acceptance, not settlement.
        yield* coordinator.interrupt("session", "user")
        expect(settled).toHaveLength(0)
        expect(Array.from(yield* coordinator.active)).toEqual(["session"])
        // Repeating the interrupt during cleanup stays an immediate no-op.
        yield* coordinator.interrupt("session", "user")

        yield* Deferred.await(cleanupStarted)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* coordinator.awaitIdle("session")

        expect(settled).toEqual(["user"])
        expect(yield* coordinator.active).toEqual(new Set())
      }),
    ),
  )

  it.effect("an interrupt during terminal settlement claims the recorded wake", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settling = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let drains = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () => Effect.sync(() => void drains++),
          settled: () => Deferred.succeed(settling, undefined).pipe(Effect.andThen(Deferred.await(release))),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(settling)
        // The owner has exited; this wake lands on the settling execution's doorbell.
        yield* coordinator.wake("session")
        // The interrupt claims it: settle must not start a successor for the dead intent.
        yield* coordinator.interrupt("session")
        yield* Deferred.succeed(release, undefined)
        yield* coordinator.awaitIdle("session")

        expect(drains).toBe(1)
        expect(yield* coordinator.active).toEqual(new Set())
      }),
    ),
  )

  it.effect("trampolines synchronous self-waking execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const limit = 20_000
        const completed = yield* Deferred.make<void>()
        let runs = 0
        let wake: (key: string) => Effect.Effect<void> = () => Effect.void
        const coordinator = yield* SessionRunCoordinator.make<string, never>({
          drain: (key) =>
            Effect.sync(() => ++runs).pipe(
              Effect.tap((run) => (run < limit ? wake(key) : Deferred.succeed(completed, undefined))),
              Effect.asVoid,
            ),
        })
        wake = coordinator.wake

        yield* coordinator.wake("session")
        yield* Deferred.await(completed)

        expect(runs).toBe(limit)
      }),
    ),
  )
})
