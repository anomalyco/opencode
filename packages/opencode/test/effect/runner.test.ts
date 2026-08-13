import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Latch, Ref, Scope } from "effect"
import { Runner } from "@/effect/runner"
import { it } from "../lib/effect"

const waitForState = <A, E>(runner: Runner.Runner<A, E>, tag: Runner.State<A, E>["_tag"]) =>
  Effect.gen(function* () {
    while (runner.state._tag !== tag) yield* Effect.yieldNow
  }).pipe(Effect.timeout("1 second"))

describe("Runner", () => {
  // --- ensureRunning semantics ---

  it.live(
    "ensureRunning starts work and returns result",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const result = yield* runner.ensureRunning(Effect.succeed("hello"))
      expect(result).toBe("hello")
      expect(runner.state._tag).toBe("Idle")
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "ensureRunning propagates work failures",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string, string>(s)
      const exit = yield* runner.ensureRunning(Effect.fail("boom")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(runner.state._tag).toBe("Idle")
    }),
  )

  it.live(
    "concurrent callers all receive same error",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string, string>(s)
      const work = Effect.gen(function* () {
        yield* Effect.sleep("10 millis")
        return yield* Effect.fail("boom")
      })

      const [a, b] = yield* Effect.all(
        [runner.ensureRunning(work).pipe(Effect.exit), runner.ensureRunning(work).pipe(Effect.exit)],
        { concurrency: "unbounded" },
      )

      expect(Exit.isFailure(a)).toBe(true)
      expect(Exit.isFailure(b)).toBe(true)
    }),
  )

  it.live(
    "ensureRunning can be called again after previous run completes",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      expect(yield* runner.ensureRunning(Effect.succeed("first"))).toBe("first")
      expect(yield* runner.ensureRunning(Effect.succeed("second"))).toBe("second")
    }),
  )

  it.live(
    "second ensureRunning interrupts the active run and replaces it",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const started = yield* Deferred.make<void>()
      const ran = yield* Ref.make<string[]>([])

      const first = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "first"])
        yield* Deferred.succeed(started, void 0)
        return yield* Effect.never.pipe(Effect.as("first-result"))
      })
      const second = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "second"])
        return "second-result"
      })

      const a = yield* runner.ensureRunning(first).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const b = yield* runner.ensureRunning(second).pipe(Effect.forkChild)

      // The first caller is interrupted; the second caller gets the new result.
      const exitA = yield* Fiber.await(a)
      const exitB = yield* Fiber.await(b)
      expect(Exit.isFailure(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitB)) expect(exitB.value).toBe("second-result")
      expect(yield* Ref.get(ran)).toEqual(["first", "second"])
    }),
  )

  it.live(
    "interrupted first caller resolves through onInterrupt",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("interrupted") })
      const started = yield* Deferred.make<void>()

      const first = Effect.gen(function* () {
        yield* Deferred.succeed(started, void 0)
        return yield* Effect.never.pipe(Effect.as("first-result"))
      })

      const a = yield* runner.ensureRunning(first).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const b = yield* runner.ensureRunning(Effect.succeed("second-result")).pipe(Effect.forkChild)

      const exitA = yield* Fiber.await(a)
      const exitB = yield* Fiber.await(b)
      expect(Exit.isSuccess(exitA)).toBe(true)
      if (Exit.isSuccess(exitA)) expect(exitA.value).toBe("interrupted")
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitB)) expect(exitB.value).toBe("second-result")
    }),
  )

  it.live(
    "interrupted caller waits for cleanup before resolving through onInterrupt",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const releaseCleanup = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("interrupted") })

      const first = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        return yield* Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(cleanupStarted, undefined)),
          Effect.ensuring(Deferred.await(releaseCleanup)),
          Effect.as("first-result"),
        )
      })

      const a = yield* runner.ensureRunning(first).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const observer = yield* Effect.gen(function* () {
        yield* Deferred.await(cleanupStarted)
        return {
          old: a.pollUnsafe(),
          replacementStarted: yield* Deferred.isDone(secondStarted),
        }
      }).pipe(
        Effect.ensuring(
          Effect.all([Deferred.succeed(releaseCleanup, undefined), Deferred.succeed(releaseSecond, undefined)], {
            discard: true,
          }),
        ),
        Effect.forkChild,
      )
      const b = yield* runner
        .ensureRunning(
          Deferred.succeed(secondStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSecond)),
            Effect.as("second-result"),
          ),
        )
        .pipe(Effect.forkChild)

      const early = yield* Fiber.join(observer).pipe(Effect.timeout("250 millis"))
      const exitA = yield* Fiber.await(a).pipe(Effect.timeout("250 millis"))
      const exitB = yield* Fiber.await(b).pipe(Effect.timeout("250 millis"))
      expect(Exit.isSuccess(exitA)).toBe(true)
      if (Exit.isSuccess(exitA)) expect(exitA.value).toBe("interrupted")
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitB)) expect(exitB.value).toBe("second-result")
      expect(early.old).toBeUndefined()
      expect(early.replacementStarted).toBe(false)
    }),
  )

  it.live(
    "replaced run does not publish idle while replacement is active",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const releaseCleanup = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const events = yield* Ref.make<string[]>([])
      const runner = Runner.make<string>(s, {
        onIdle: Ref.update(events, (items) => [...items, "idle"]),
      })

      const first = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        return yield* Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(cleanupStarted, undefined)),
          Effect.ensuring(Deferred.await(releaseCleanup)),
          Effect.as("first-result"),
        )
      })

      const a = yield* runner.ensureRunning(first).pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(started)
      const b = yield* runner
        .ensureRunning(Deferred.await(releaseSecond).pipe(Effect.as("second-result")))
        .pipe(Effect.forkChild)
      yield* Deferred.await(cleanupStarted)
      yield* Deferred.succeed(releaseCleanup, undefined)
      yield* Fiber.join(a)

      expect(runner.busy).toBe(true)
      expect(yield* Ref.get(events)).toEqual([])

      yield* Deferred.succeed(releaseSecond, undefined)
      expect(yield* Fiber.join(b)).toBe("second-result")
      expect(yield* Ref.get(events)).toEqual(["idle"])
    }),
  )

  it.live(
    "successive replacements wait for the original run cleanup",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const releaseCleanup = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const thirdStarted = yield* Deferred.make<void>()
      const releaseThird = yield* Deferred.make<void>()
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("interrupted") })

      const first = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        return yield* Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(cleanupStarted, undefined)),
          Effect.ensuring(Deferred.await(releaseCleanup)),
          Effect.as("first"),
        )
      })

      const a = yield* runner.ensureRunning(first).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const b = yield* runner
        .ensureRunning(Deferred.succeed(secondStarted, undefined).pipe(Effect.as("second")))
        .pipe(Effect.forkChild)
      yield* Deferred.await(cleanupStarted)
      const c = yield* runner
        .ensureRunning(
          Deferred.succeed(thirdStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseThird)),
            Effect.as("third"),
          ),
        )
        .pipe(Effect.forkChild)

      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(secondStarted)).toBe(false)
      expect(yield* Deferred.isDone(thirdStarted)).toBe(false)

      yield* Deferred.succeed(releaseCleanup, undefined)
      expect(yield* Fiber.join(a)).toBe("interrupted")
      expect(yield* Fiber.join(b)).toBe("interrupted")
      yield* Deferred.await(thirdStarted).pipe(Effect.timeout("250 millis"))
      yield* Deferred.succeed(releaseThird, undefined)
      expect(yield* Fiber.join(c)).toBe("third")
    }),
  )

  // --- cancel semantics ---

  it.live(
    "cancel interrupts running work",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const started = yield* Deferred.make<void>()
      const fiber = yield* runner
        .ensureRunning(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, void 0)
            return yield* Effect.never.pipe(Effect.as("never"))
          }),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      expect(runner.busy).toBe(true)
      expect(runner.state._tag).toBe("Running")

      yield* runner.cancel
      expect(runner.busy).toBe(false)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.live(
    "cancel on idle is a no-op",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      yield* runner.cancel
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "cancel with onInterrupt resolves callers gracefully",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("fallback") })
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("never"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Running")

      yield* runner.cancel

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toBe("fallback")
    }),
  )

  it.live(
    "cancel with queued callers resolves all",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("fallback") })

      const a = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Running")
      const b = yield* runner.ensureRunning(Effect.succeed("y")).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      yield* runner.cancel

      const exitA = yield* Fiber.await(a).pipe(Effect.timeout("250 millis"))
      const exitB = yield* Fiber.await(b).pipe(Effect.timeout("250 millis"))
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitA)) expect(exitA.value).toBe("fallback")
      if (Exit.isSuccess(exitB)) expect(exitB.value).toBe("fallback")
    }),
  )

  it.live(
    "work can be started after cancel",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Running")
      yield* runner.cancel
      yield* Fiber.await(fiber)

      const result = yield* runner.ensureRunning(Effect.succeed("after-cancel"))
      expect(result).toBe("after-cancel")
    }),
  )

  it.live(
    "cancel does not deadlock when replacement work starts before interrupted run exits",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const hit = yield* Deferred.make<void>()
      const hold = yield* Deferred.make<void>()
      const done = yield* Deferred.make<void>()

      yield* Effect.gen(function* () {
        const runner = Runner.make<string>(s)
        const first = Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(hit, undefined)),
          Effect.ensuring(Deferred.await(hold)),
          Effect.as("first"),
        )

        const a = yield* runner.ensureRunning(first).pipe(Effect.exit, Effect.forkChild)
        yield* waitForState(runner, "Running")

        const stop = yield* runner.cancel.pipe(Effect.forkChild)
        yield* Deferred.await(hit).pipe(Effect.timeout("250 millis"))

        const b = yield* runner.ensureRunning(Deferred.await(done).pipe(Effect.as("second"))).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(runner.busy).toBe(true)

        yield* Deferred.succeed(hold, undefined)
        const stopExit = yield* Fiber.await(stop).pipe(Effect.timeout("250 millis"))
        expect(Exit.isSuccess(stopExit)).toBe(true)

        expect(runner.busy).toBe(true)
        yield* Deferred.succeed(done, undefined)
        expect(yield* Fiber.join(b).pipe(Effect.timeout("250 millis"))).toBe("second")
        expect(runner.busy).toBe(false)

        const exit = yield* Fiber.join(a)
        expect(Exit.isFailure(exit)).toBe(true)
      }).pipe(
        Effect.ensuring(
          Effect.all([Deferred.succeed(hold, undefined), Deferred.succeed(done, undefined)], { discard: true }).pipe(
            Effect.ignore,
          ),
        ),
      )
    }),
  )

  // --- shell semantics ---

  it.live(
    "shell runs exclusively",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const result = yield* runner.startShell(Effect.succeed("shell-done"))
      expect(result).toBe("shell-done")
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "shell rejects when run is active",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const started = yield* Deferred.make<void>()
      const fiber = yield* runner
        .ensureRunning(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never.pipe(Effect.as("x"))
          }),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(started).pipe(Effect.timeout("250 millis"))
      yield* Effect.gen(function* () {
        while (runner.state._tag !== "Running") yield* Effect.yieldNow
      }).pipe(Effect.timeout("250 millis"))

      const exit = yield* runner.startShell(Effect.succeed("nope")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      yield* runner.cancel
      yield* Fiber.await(fiber).pipe(Effect.timeout("250 millis"))
    }),
  )

  it.live(
    "shell rejects when another shell is running",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("first"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Shell")

      const exit = yield* runner.startShell(Effect.succeed("second")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Runner.Busy)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(sh)
    }),
  )

  it.live(
    "cancel interrupts shell",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("ignored"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Shell")

      const stop = yield* runner.cancel.pipe(Effect.forkChild)
      const stopExit = yield* Fiber.await(stop).pipe(Effect.timeout("250 millis"))
      expect(Exit.isSuccess(stopExit)).toBe(true)
      expect(runner.busy).toBe(false)

      const shellExit = yield* Fiber.await(sh)
      expect(Exit.isFailure(shellExit)).toBe(true)

      yield* Deferred.succeed(gate, undefined).pipe(Effect.ignore)
    }),
  )

  it.live(
    "cancel does not mask shell defects",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("interrupted") })
      const ready = yield* Latch.make()

      const sh = yield* runner
        .startShell(
          Effect.gen(function* () {
            yield* ready.open
            return yield* Effect.never.pipe(Effect.as("ignored"))
          }).pipe(Effect.ensuring(Effect.die("boom"))),
          ready,
        )
        .pipe(Effect.forkChild)
      yield* ready.await.pipe(Effect.timeout("250 millis"))

      yield* runner.cancel
      expect(Exit.isFailure(yield* Fiber.await(sh))).toBe(true)
    }),
  )

  // --- shell→run handoff ---

  it.live(
    "ensureRunning queues behind shell then runs after",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("shell-result"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Shell")
      expect(runner.state._tag).toBe("Shell")

      const run = yield* runner.ensureRunning(Effect.succeed("run-result")).pipe(Effect.forkChild)
      yield* waitForState(runner, "ShellThenRun")
      expect(runner.state._tag).toBe("ShellThenRun")

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(sh)

      const exit = yield* Fiber.await(run)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toBe("run-result")
      expect(runner.state._tag).toBe("Idle")
    }),
  )

  it.live(
    "multiple ensureRunning callers share the queued run behind shell",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const calls = yield* Ref.make(0)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("shell"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Shell")

      const work = Effect.gen(function* () {
        yield* Ref.update(calls, (n) => n + 1)
        return "run"
      })
      const a = yield* runner.ensureRunning(work).pipe(Effect.forkChild)
      const b = yield* runner.ensureRunning(work).pipe(Effect.forkChild)
      yield* waitForState(runner, "ShellThenRun")

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(sh)

      const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.live(
    "cancel during shell_then_run cancels both",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)

      const sh = yield* runner.startShell(Effect.never.pipe(Effect.as("aborted"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Shell")

      const run = yield* runner.ensureRunning(Effect.succeed("y")).pipe(Effect.forkChild)
      yield* waitForState(runner, "ShellThenRun")
      expect(runner.state._tag).toBe("ShellThenRun")

      yield* runner.cancel
      expect(runner.busy).toBe(false)

      yield* Fiber.await(sh)
      const exit = yield* Fiber.await(run)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  // --- lifecycle callbacks ---

  it.live(
    "onIdle fires when returning to idle from running",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const count = yield* Ref.make(0)
      const runner = Runner.make<string>(s, {
        onIdle: Ref.update(count, (n) => n + 1),
      })
      yield* runner.ensureRunning(Effect.succeed("ok"))
      expect(yield* Ref.get(count)).toBe(1)
    }),
  )

  it.live(
    "onIdle fires on cancel",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const count = yield* Ref.make(0)
      const runner = Runner.make<string>(s, {
        onIdle: Ref.update(count, (n) => n + 1),
      })
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Running")
      yield* runner.cancel
      yield* Fiber.await(fiber)
      expect(yield* Ref.get(count)).toBeGreaterThanOrEqual(1)
    }),
  )

  it.live(
    "onBusy fires when shell starts",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const count = yield* Ref.make(0)
      const runner = Runner.make<string>(s, {
        onBusy: Ref.update(count, (n) => n + 1),
      })
      yield* runner.startShell(Effect.succeed("done"))
      expect(yield* Ref.get(count)).toBe(1)
    }),
  )

  // --- busy flag ---

  it.live(
    "busy is true during run",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const fiber = yield* runner.ensureRunning(Deferred.await(gate).pipe(Effect.as("ok"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Running")
      expect(runner.busy).toBe(true)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(fiber)
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "busy is true during shell",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const fiber = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("ok"))).pipe(Effect.forkChild)
      yield* waitForState(runner, "Shell")
      expect(runner.busy).toBe(true)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(fiber)
      expect(runner.busy).toBe(false)
    }),
  )
})
