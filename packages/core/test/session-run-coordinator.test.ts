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

  it.effect("does nothing when interrupted while idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.void })

        yield* coordinator.interrupt("session")
      }),
    ),
  )

  it.effect("suppresses stale wakes after an idle interrupt boundary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({ drain: () => Effect.sync(() => runs++) })

        yield* coordinator.interrupt("session", 2)
        yield* coordinator.wake("session", 1)
        yield* coordinator.awaitIdle("session")
        expect(runs).toBe(0)

        yield* coordinator.wake("session", 3)
        yield* coordinator.awaitIdle("session")
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("does not interrupt a wake newer than the interrupt boundary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
        })

        yield* coordinator.wake("session", 3)
        yield* Deferred.await(started)
        yield* coordinator.interrupt("session", 2)
        expect(yield* Deferred.isDone(interrupted)).toBeFalse()
        yield* Deferred.succeed(gate, undefined)
        yield* coordinator.awaitIdle("session")
      }),
    ),
  )

  it.effect("preserves a queued wake newer than the interrupt boundary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        yield* coordinator.wake("session", 1)
        yield* Deferred.await(firstStarted)
        yield* coordinator.wake("session", 3)
        yield* coordinator.interrupt("session", 2)
        yield* Deferred.await(secondStarted)
        yield* coordinator.awaitIdle("session").pipe(Effect.exit)

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("interrupts only the requested key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const secondInterrupted = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make({
          drain: (key: string) =>
            key === "first"
              ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never))
              : Deferred.succeed(secondStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(secondGate)),
                  Effect.onInterrupt(() => Deferred.succeed(secondInterrupted, undefined)),
                ),
        })

        yield* coordinator.wake("first")
        yield* coordinator.wake("second")
        yield* Effect.all([Deferred.await(firstStarted), Deferred.await(secondStarted)])

        yield* coordinator.interrupt("first")
        expect(yield* Deferred.isDone(secondInterrupted)).toBeFalse()
        yield* Deferred.succeed(secondGate, undefined)
        yield* coordinator.awaitIdle("second")
      }),
    ),
  )

  it.effect("interrupts the active drain and suppresses its queued wake", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                    )
                  : Effect.void,
              ),
            ),
        })

        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        yield* coordinator.wake("session")

        yield* coordinator.interrupt("session")
        yield* Deferred.await(interrupted)
        yield* coordinator.awaitIdle("session")
        const exit = yield* Fiber.await(run)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
        expect(runs).toBe(1)
        yield* coordinator.interrupt("session")
      }),
    ),
  )

  it.effect("suppresses a wake received during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const firstInterrupted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(firstInterrupted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                      ),
                    )
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session", 2).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* coordinator.wake("session", 1)
        yield* Deferred.await(firstInterrupted)
        expect(runs).toBe(1)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(interrupt)
        yield* coordinator.awaitIdle("session")

        expect(runs).toBe(1)
        yield* coordinator.wake("session", 3)
        yield* Deferred.await(secondStarted)
        yield* coordinator.awaitIdle("session")
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("remembers a wake received after the interrupt boundary during cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const firstInterrupted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(firstInterrupted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                      ),
                    )
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session", 2).pipe(Effect.forkChild)
        yield* Deferred.await(firstInterrupted)
        yield* coordinator.wake("session", 3)
        const staleInterrupt = yield* coordinator.interrupt("session", 1).pipe(Effect.forkChild)
        expect(runs).toBe(1)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(interrupt)
        yield* Fiber.join(staleInterrupt)
        yield* Deferred.await(secondStarted)
        yield* coordinator.awaitIdle("session")

        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("moves the stop barrier forward for repeated interrupts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const firstInterrupted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(firstInterrupted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
                      ),
                    )
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const firstInterrupt = yield* coordinator.interrupt("session", 2).pipe(Effect.forkChild)
        yield* Deferred.await(firstInterrupted)
        yield* coordinator.wake("session", 3)
        const secondInterrupt = yield* coordinator.interrupt("session", 4).pipe(Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(firstInterrupt)
        yield* Fiber.join(secondInterrupt)
        yield* coordinator.awaitIdle("session")
        expect(runs).toBe(1)

        yield* coordinator.wake("session", 5)
        yield* Deferred.await(secondStarted)
        yield* coordinator.awaitIdle("session")
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("interrupts an explicit run queued before the interruption request", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make({
          drain: () =>
            Effect.sync(() => ++runs).pipe(
              Effect.flatMap((run) =>
                run === 1 ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never)) : Effect.void,
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Effect.yieldNow

        yield* coordinator.interrupt("session")
        const exit = yield* Fiber.await(run)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
        expect(runs).toBe(1)
      }),
    ),
  )

  it.effect("settles a pre-interrupt explicit run only after active wake cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const runSettled = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        const run = yield* coordinator
          .run("session")
          .pipe(Effect.exit, Effect.ensuring(Deferred.succeed(runSettled, undefined)), Effect.forkChild)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)

        expect(yield* Deferred.isDone(runSettled)).toBeFalse()
        yield* Deferred.succeed(cleanupGate, undefined)
        const runExit = yield* Fiber.join(run)
        expect(Exit.isFailure(runExit) && Cause.hasInterruptsOnly(runExit.cause)).toBeTrue()
        yield* Fiber.join(interrupt)
      }),
    ),
  )

  it.effect("starts an explicit run arriving during interrupt cleanup after the stop barrier", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
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
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)
        yield* Fiber.join(interrupt)
        yield* Fiber.join(run)
        yield* Deferred.await(secondStarted)
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("interrupts pre-stop waiters and runs post-stop waiters after cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
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
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const before = yield* coordinator.run("session").pipe(Effect.exit, Effect.forkChild)
        const interrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        const after = yield* coordinator.run("session").pipe(Effect.exit, Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)

        const beforeExit = yield* Fiber.join(before)
        expect(Exit.isFailure(beforeExit) && Cause.hasInterruptsOnly(beforeExit.cause)).toBeTrue()
        yield* Fiber.join(interrupt)
        yield* Fiber.join(after)
        yield* Deferred.await(secondStarted)
        expect(runs).toBe(2)
      }),
    ),
  )

  it.effect("waits for interrupt cleanup before settling callers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const runSettled = yield* Deferred.make<void>()
        const idleSettled = yield* Deferred.make<void>()
        const interruptSettled = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
              ),
            ),
        })

        const run = yield* coordinator
          .run("session")
          .pipe(Effect.ensuring(Deferred.succeed(runSettled, undefined)), Effect.forkChild)
        yield* Deferred.await(started)
        const idle = yield* coordinator
          .awaitIdle("session")
          .pipe(Effect.exit, Effect.ensuring(Deferred.succeed(idleSettled, undefined)), Effect.forkChild)
        const interrupt = yield* coordinator
          .interrupt("session")
          .pipe(Effect.ensuring(Deferred.succeed(interruptSettled, undefined)), Effect.forkChild)
        yield* Deferred.await(cleanupStarted)

        expect(yield* Deferred.isDone(runSettled)).toBeFalse()
        expect(yield* Deferred.isDone(idleSettled)).toBeFalse()
        expect(yield* Deferred.isDone(interruptSettled)).toBeFalse()
        yield* Deferred.succeed(cleanupGate, undefined)
        const runExit = yield* Fiber.await(run)
        const idleExit = yield* Fiber.join(idle)
        expect(Exit.isFailure(runExit) && Cause.hasInterruptsOnly(runExit.cause)).toBeTrue()
        expect(Exit.isFailure(idleExit) && Cause.hasInterruptsOnly(idleExit.cause)).toBeTrue()
        yield* Fiber.join(interrupt)
      }),
    ),
  )

  it.effect("joins concurrent interruption requests for one active drain", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupGate))),
              ),
            ),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        const first = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        const second = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)

        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    ),
  )

  it.effect("does not discard a post-stop explicit run when interrupted again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const cleanupStarted = yield* Deferred.make<void>()
        const cleanupGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let runs = 0
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
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
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(firstStarted)
        const firstInterrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        const run = yield* coordinator.run("session").pipe(Effect.forkChild)
        const secondInterrupt = yield* coordinator.interrupt("session").pipe(Effect.forkChild)
        yield* Deferred.succeed(cleanupGate, undefined)

        yield* Effect.all([Fiber.join(firstInterrupt), Fiber.join(secondInterrupt), Fiber.join(run)])
        yield* Deferred.await(secondStarted)
        expect(runs).toBe(2)
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

  it.effect("reports an advisory drain failure exactly once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = new Error("wake failed")
        const reported: Cause.Cause<Error>[] = []
        const reportedOnce = yield* Deferred.make<void>()
        const coordinator = yield* SessionRunCoordinator.make<string, void, Error>({
          drain: () => Effect.fail(failure),
          onFailure: (_key, cause) =>
            Effect.sync(() => reported.push(cause)).pipe(Effect.andThen(Deferred.succeed(reportedOnce, undefined))),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(reportedOnce)
        yield* Effect.yieldNow

        expect(reported).toHaveLength(1)
        expect(Cause.squash(reported[0]!)).toBe(failure)
      }),
    ),
  )

  it.effect("contains defects thrown while constructing an advisory failure report", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* SessionRunCoordinator.make<string, void, Error>({
          drain: () => Effect.fail(new Error("wake failed")),
          onFailure: () => {
            throw new Error("report defect")
          },
        })

        yield* coordinator.wake("session")
        yield* coordinator.awaitIdle("session").pipe(Effect.exit)
        yield* coordinator.wake("session")
        yield* coordinator.awaitIdle("session").pipe(Effect.exit)
      }),
    ),
  )

  it.effect("reports an independently interrupted advisory drain", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reported = yield* Deferred.make<Cause.Cause<never>>()
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: () => Effect.interrupt,
          onFailure: (_key, cause) => Deferred.succeed(reported, cause).pipe(Effect.asVoid),
        })

        yield* coordinator.wake("session")

        expect(Cause.hasInterruptsOnly(yield* Deferred.await(reported))).toBeTrue()
      }),
    ),
  )

  it.effect("does not report deliberate interruption as an advisory failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const reported: Cause.Cause<never>[] = []
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          onFailure: (_key, cause) => Effect.sync(() => reported.push(cause)),
        })

        yield* coordinator.wake("session")
        yield* Deferred.await(started)
        yield* coordinator.interrupt("session")
        yield* Effect.yieldNow

        expect(reported).toEqual([])
      }),
    ),
  )

  it.effect("trampolines many synchronous self-waking drains", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const limit = 20_000
        let runs = 0
        let wake: (key: string) => Effect.Effect<void> = () => Effect.void
        const coordinator = yield* SessionRunCoordinator.make<string, void, never>({
          drain: (key) =>
            Effect.sync(() => ++runs).pipe(
              Effect.tap((run) => (run < limit ? wake(key) : Effect.void)),
              Effect.asVoid,
            ),
        })
        wake = coordinator.wake

        yield* coordinator.wake("session")
        yield* coordinator.awaitIdle("session")

        expect(runs).toBe(limit)
      }),
    ),
  )
})
