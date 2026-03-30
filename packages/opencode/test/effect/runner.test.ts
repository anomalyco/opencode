import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Ref, Scope } from "effect"
import { Cancelled, make as makeRunner } from "../../src/effect/runner"

describe("Runner", () => {
  // --- ensureRunning semantics ---

  test("ensureRunning starts work and returns result", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const result = yield* runner.ensureRunning(Effect.succeed("hello"))
          expect(result).toBe("hello")
          expect(runner.state.type).toBe("idle")
          expect(runner.busy).toBe(false)
        }),
      ),
    )
  })

  test("ensureRunning propagates work failures", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const exit = yield* runner.ensureRunning(Effect.fail("boom")).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(runner.state.type).toBe("idle")
        }),
      ),
    )
  })

  test("concurrent callers share the same run", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const calls = yield* Ref.make(0)
          const work = Effect.gen(function* () {
            yield* Ref.update(calls, (n) => n + 1)
            yield* Effect.sleep("10 millis")
            return "shared"
          })

          const [a, b] = yield* Effect.all(
            [runner.ensureRunning(work), runner.ensureRunning(work)],
            { concurrency: "unbounded" },
          )

          expect(a).toBe("shared")
          expect(b).toBe("shared")
          expect(yield* Ref.get(calls)).toBe(1)
        }),
      ),
    )
  })

  test("concurrent callers all receive same error", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
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
      ),
    )
  })

  test("ensureRunning can be called again after previous run completes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const a = yield* runner.ensureRunning(Effect.succeed("first"))
          expect(a).toBe("first")

          const b = yield* runner.ensureRunning(Effect.succeed("second"))
          expect(b).toBe("second")
        }),
      ),
    )
  })

  test("second ensureRunning ignores new work if already running", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const ran = yield* Ref.make<string[]>([])

          const first = Effect.gen(function* () {
            yield* Ref.update(ran, (a) => [...a, "first"])
            yield* Effect.sleep("50 millis")
            return "first-result"
          })
          const second = Effect.gen(function* () {
            yield* Ref.update(ran, (a) => [...a, "second"])
            return "second-result"
          })

          const [a, b] = yield* Effect.all(
            [runner.ensureRunning(first), runner.ensureRunning(second)],
            { concurrency: "unbounded" },
          )

          // Both get the first run's result — second work is never started
          expect(a).toBe("first-result")
          expect(b).toBe("first-result")
          expect(yield* Ref.get(ran)).toEqual(["first"])
        }),
      ),
    )
  })

  // --- cancel semantics ---

  test("cancel interrupts running work", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("never"))).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(runner.busy).toBe(true)
          expect(runner.state.type).toBe("running")

          yield* runner.cancel
          expect(runner.busy).toBe(false)

          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      ),
    )
  })

  test("cancel on idle is a no-op", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          yield* runner.cancel
          expect(runner.busy).toBe(false)
        }),
      ),
    )
  })

  test("cancel with onInterrupt resolves callers gracefully", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s, { onInterrupt: Effect.succeed("fallback") })
          const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("never"))).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          yield* runner.cancel

          const exit = yield* Fiber.await(fiber)
          expect(Exit.isSuccess(exit)).toBe(true)
          if (Exit.isSuccess(exit)) expect(exit.value).toBe("fallback")
        }),
      ),
    )
  })

  test("cancel with queued callers resolves all", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s, { onInterrupt: Effect.succeed("fallback") })

          const a = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          const b = yield* runner.ensureRunning(Effect.succeed("y")).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          yield* runner.cancel

          const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
          expect(Exit.isSuccess(exitA)).toBe(true)
          expect(Exit.isSuccess(exitB)).toBe(true)
          if (Exit.isSuccess(exitA)) expect(exitA.value).toBe("fallback")
          if (Exit.isSuccess(exitB)) expect(exitB.value).toBe("fallback")
        }),
      ),
    )
  })

  test("work can be started after cancel", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          yield* runner.cancel
          yield* Fiber.await(fiber)

          // Should be able to start fresh
          const result = yield* runner.ensureRunning(Effect.succeed("after-cancel"))
          expect(result).toBe("after-cancel")
        }),
      ),
    )
  })

  // --- shell semantics ---

  test("shell runs exclusively", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const result = yield* runner.startShell((_signal) => Effect.succeed("shell-done"))
          expect(result).toBe("shell-done")
          expect(runner.busy).toBe(false)
        }),
      ),
    )
  })

  test("shell rejects when run is active", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          const exit = yield* runner.startShell((_s) => Effect.succeed("nope")).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)

          yield* runner.cancel
          yield* Fiber.await(fiber)
        }),
      ),
    )
  })

  test("shell rejects when another shell is running", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const gate = yield* Deferred.make<void>()

          const sh = yield* runner
            .startShell((_signal) => Deferred.await(gate).pipe(Effect.as("first")))
            .pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          const exit = yield* runner.startShell((_s) => Effect.succeed("second")).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)

          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.await(sh)
        }),
      ),
    )
  })

  // --- shell→run handoff ---

  test("ensureRunning queues behind shell then runs after", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const gate = yield* Deferred.make<void>()

          const sh = yield* runner
            .startShell((_signal) => Deferred.await(gate).pipe(Effect.as("shell-result")))
            .pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(runner.state.type).toBe("shell")

          const run = yield* runner.ensureRunning(Effect.succeed("run-result")).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(runner.state.type).toBe("shell_then_run")

          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.await(sh)

          const exit = yield* Fiber.await(run)
          expect(Exit.isSuccess(exit)).toBe(true)
          if (Exit.isSuccess(exit)) expect(exit.value).toBe("run-result")
          expect(runner.state.type).toBe("idle")
        }),
      ),
    )
  })

  test("multiple ensureRunning callers share the queued run behind shell", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const calls = yield* Ref.make(0)
          const gate = yield* Deferred.make<void>()

          const sh = yield* runner
            .startShell((_signal) => Deferred.await(gate).pipe(Effect.as("shell")))
            .pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          const work = Effect.gen(function* () {
            yield* Ref.update(calls, (n) => n + 1)
            return "run"
          })
          const a = yield* runner.ensureRunning(work).pipe(Effect.forkChild)
          const b = yield* runner.ensureRunning(work).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.await(sh)

          const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
          expect(Exit.isSuccess(exitA)).toBe(true)
          expect(Exit.isSuccess(exitB)).toBe(true)
          // Only one execution
          expect(yield* Ref.get(calls)).toBe(1)
        }),
      ),
    )
  })

  test("cancel during shell_then_run cancels both", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)

          const sh = yield* runner
            .startShell((_signal) => Effect.never.pipe(Effect.as("x")))
            .pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")

          const run = yield* runner.ensureRunning(Effect.succeed("y")).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(runner.state.type).toBe("shell_then_run")

          yield* runner.cancel
          expect(runner.busy).toBe(false)

          yield* Fiber.await(sh)
          const exit = yield* Fiber.await(run)
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      ),
    )
  })

  // --- lifecycle callbacks ---

  test("onIdle fires when returning to idle from running", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const count = yield* Ref.make(0)
          const runner = makeRunner<string>(s, {
            onIdle: Ref.update(count, (n) => n + 1),
          })
          yield* runner.ensureRunning(Effect.succeed("ok"))
          expect(yield* Ref.get(count)).toBe(1)
        }),
      ),
    )
  })

  test("onIdle fires when cancel returns to idle", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const count = yield* Ref.make(0)
          const runner = makeRunner<string>(s, {
            onIdle: Ref.update(count, (n) => n + 1),
          })
          const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          yield* runner.cancel
          yield* Fiber.await(fiber)
          // onIdle fires from both the fiber onExit and cancel — at least once
          expect(yield* Ref.get(count)).toBeGreaterThanOrEqual(1)
        }),
      ),
    )
  })

  test("onBusy fires when shell starts", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const count = yield* Ref.make(0)
          const runner = makeRunner<string>(s, {
            onBusy: Ref.update(count, (n) => n + 1),
          })
          yield* runner.startShell((_signal) => Effect.succeed("done"))
          expect(yield* Ref.get(count)).toBe(1)
        }),
      ),
    )
  })

  // --- busy flag ---

  test("busy is true during run", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const gate = yield* Deferred.make<void>()

          const fiber = yield* runner
            .ensureRunning(Deferred.await(gate).pipe(Effect.as("ok")))
            .pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(runner.busy).toBe(true)

          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.await(fiber)
          expect(runner.busy).toBe(false)
        }),
      ),
    )
  })

  test("busy is true during shell", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Scope.Scope
          const runner = makeRunner<string>(s)
          const gate = yield* Deferred.make<void>()

          const fiber = yield* runner
            .startShell((_signal) => Deferred.await(gate).pipe(Effect.as("ok")))
            .pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          expect(runner.busy).toBe(true)

          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.await(fiber)
          expect(runner.busy).toBe(false)
        }),
      ),
    )
  })
})
