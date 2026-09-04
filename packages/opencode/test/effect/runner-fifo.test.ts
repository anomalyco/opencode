import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Latch, Ref, Scope } from "effect"
import { Runner } from "@/effect/runner"
import { makeGenerationLifecycle } from "@/session/run-state"
import { it } from "../lib/effect"

const open = (deferred: Deferred.Deferred<void>) => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid)

const published = <A, E>(value: Runner.Publication<A, E>) => {
  expect(value.type).toBe("published")
  if (value.type !== "published") throw new Error("expected a published Runner entry")
  return value
}

const trackedLifecycle = Effect.gen(function* () {
  const active = new Map<object, Effect.Effect<void>>()
  const disposer = yield* Deferred.make<Effect.Effect<void>>()
  const unregistered = yield* Deferred.make<void>()
  const unregisters = yield* Ref.make(0)
  const lifecycle: Runner.Lifecycle = {
    register: (token, dispose) =>
      Effect.sync(() => {
        active.set(token, dispose)
      }).pipe(Effect.andThen(Deferred.succeed(disposer, dispose)), Effect.asVoid),
    unregister: (token) =>
      Effect.sync(() => {
        active.delete(token)
      }).pipe(Effect.andThen(Ref.update(unregisters, (count) => count + 1)), Effect.andThen(open(unregistered))),
  }
  return { active, disposer, lifecycle, unregistered, unregisters }
})

describe("Runner reply-required FIFO (CP-033)", () => {
  it.live(
    "preserves legacy J while an F tail waits for its own release and barrier (T-01/T-04)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const runner = Runner.make<string>(scope)
      const firstStarted = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const fifoRelease = yield* Deferred.make<void>()
      const fifoStarted = yield* Deferred.make<void>()
      const ignored = yield* Ref.make(false)

      const first = yield* runner
        .ensureRunning(open(firstStarted).pipe(Effect.andThen(Deferred.await(firstRelease)), Effect.as("first")))
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)

      const fifo = published(yield* runner.publish(() => open(fifoStarted).pipe(Effect.as("fifo")), fifoRelease))
      const joined = yield* runner
        .ensureRunning(Ref.set(ignored, true).pipe(Effect.as("wrong")))
        .pipe(Effect.forkChild({ startImmediately: true }))

      expect(yield* Deferred.isDone(fifoStarted)).toBe(false)
      yield* open(firstRelease)
      expect(yield* Fiber.join(first)).toBe("first")
      expect(yield* Fiber.join(joined)).toBe("first")
      expect(yield* Ref.get(ignored)).toBe(false)
      expect(yield* Deferred.isDone(fifoStarted)).toBe(false)

      yield* open(fifoRelease)
      expect(yield* fifo.await).toBe("fifo")
      expect(yield* Deferred.isDone(fifoStarted)).toBe(true)
    }),
  )

  it.live(
    "promotes B/C/D in FIFO order after every non-cancel predecessor exit (T-08)",
    Effect.gen(function* () {
      const modes = ["success", "failure", "defect", "interrupt"] as const
      for (const mode of modes) {
        const scope = yield* Scope.Scope
        const runner = Runner.make<string, string>(scope, { onInterrupt: Effect.succeed("interrupted") })
        const predecessorStarted = yield* Deferred.make<void>()
        const predecessorRelease = yield* Deferred.make<void>()
        const order = yield* Ref.make<string[]>([])
        const names = ["B", "C", "D"] as const
        const bodyStarted = yield* Effect.forEach(names, () => Deferred.make<void>())
        const bodyRelease = yield* Effect.forEach(names, () => Deferred.make<void>())
        yield* Effect.addFinalizer(() => Effect.forEach(bodyRelease, open, { discard: true }).pipe(Effect.ignore))
        const work = open(predecessorStarted).pipe(
          Effect.andThen(Deferred.await(predecessorRelease)),
          Effect.andThen(
            mode === "success"
              ? Effect.succeed("A")
              : mode === "failure"
                ? Effect.fail("typed")
                : mode === "defect"
                  ? Effect.die("defect")
                  : Effect.interrupt,
          ),
        )
        const predecessor = yield* runner.ensureRunning(work).pipe(Effect.exit, Effect.forkChild)
        yield* Deferred.await(predecessorStarted)

        const values: Runner.Published<string, string>[] = []
        for (const index of [0, 1, 2]) {
          const name = names[index]!
          const release = yield* Deferred.make<void>()
          yield* open(release)
          const entry = published(
            yield* runner.publish(
              () =>
                Ref.update(order, (current) => [...current, name]).pipe(
                  Effect.andThen(open(bodyStarted[index]!)),
                  Effect.andThen(Deferred.await(bodyRelease[index]!)),
                  Effect.as(name),
                ),
              release,
            ),
          )
          values.push(entry)
        }
        expect(values[0]?.done).not.toBe(values[1]?.done)
        expect(values[1]?.done).not.toBe(values[2]?.done)

        yield* open(predecessorRelease)
        yield* Fiber.await(predecessor)
        yield* Deferred.await(bodyStarted[0]!)
        expect(yield* Deferred.isDone(bodyStarted[1]!)).toBe(false)
        expect(yield* Deferred.isDone(bodyStarted[2]!)).toBe(false)
        yield* open(bodyRelease[0]!)

        yield* Deferred.await(bodyStarted[1]!)
        expect(yield* Deferred.isDone(bodyStarted[2]!)).toBe(false)
        yield* open(bodyRelease[1]!)

        yield* Deferred.await(bodyStarted[2]!)
        yield* open(bodyRelease[2]!)
        expect(yield* Effect.all(values.map((entry) => entry.await))).toEqual(["B", "C", "D"])
        expect(yield* Ref.get(order)).toEqual(["B", "C", "D"])
      }
    }),
  )

  it.live(
    "orders closing-before-registration and reservation-before-closing exactly (T-07)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const closed = makeGenerationLifecycle()
      yield* closed.dispose
      const refusedRan = yield* Ref.make(false)
      const refusedRunner = Runner.make<string>(scope, {
        lifecycle: closed,
        onInterrupt: Effect.succeed("closed"),
      })
      const refusedRelease = yield* Deferred.make<void>()
      yield* open(refusedRelease)
      const refused = yield* refusedRunner.publish(
        () => Ref.set(refusedRan, true).pipe(Effect.as("wrong")),
        refusedRelease,
      )
      expect(refused).toEqual({ type: "completed", value: "closed" })
      expect(yield* Ref.get(refusedRan)).toBe(false)
      expect(yield* closed.inspect).toEqual({ closing: true, active: 0 })

      const registerEntered = yield* Deferred.make<void>()
      const registerRelease = yield* Deferred.make<void>()
      const publicationReturned = yield* Deferred.make<void>()
      const disposerStarted = yield* Deferred.make<void>()
      const registry = new Map<object, Effect.Effect<void>>()
      const closing = { value: false }
      const lifecycle: Runner.Lifecycle = {
        register: (token, dispose) =>
          Effect.gen(function* () {
            if (closing.value) return yield* Effect.fail(new Runner.Cancelled())
            registry.set(token, dispose)
            yield* open(registerEntered)
            yield* Deferred.await(registerRelease)
          }),
        unregister: (token) =>
          Effect.sync(() => {
            registry.delete(token)
          }),
      }
      const runner = Runner.make<string>(scope, { lifecycle, onInterrupt: Effect.succeed("disposed") })
      const release = yield* Deferred.make<void>()
      const queued = yield* runner
        .publish(() => Effect.succeed("wrong"), release)
        .pipe(
          Effect.tap(() => open(publicationReturned)),
          Effect.forkChild,
        )
      yield* Deferred.await(registerEntered)

      closing.value = true
      const disposers = Array.from(registry.values())
      expect(disposers).toHaveLength(1)
      const disposing = yield* open(disposerStarted).pipe(
        Effect.andThen(Effect.forEach(disposers, (dispose) => dispose, { discard: true })),
        Effect.forkChild,
      )
      yield* Deferred.await(disposerStarted)
      expect(yield* Deferred.isDone(publicationReturned)).toBe(false)

      yield* open(registerRelease)
      const accepted = published(yield* Fiber.join(queued))
      expect(yield* accepted.await).toBe("disposed")
      yield* Fiber.join(disposing)
      expect(registry.size).toBe(0)
    }),
  )

  it.live(
    "keeps closed and an exact disposer pending until unregister exits (T-10/T-11)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const disposerReady = yield* Deferred.make<Effect.Effect<void>>()
      const unregisterEntered = yield* Deferred.make<void>()
      const unregisterRelease = yield* Deferred.make<void>()
      const unregisterExited = yield* Deferred.make<void>()
      const drainFinished = yield* Deferred.make<void>()
      const active = new Map<object, Effect.Effect<void>>()
      yield* Effect.addFinalizer(() => open(unregisterRelease).pipe(Effect.ignore))
      const lifecycle: Runner.Lifecycle = {
        register: (token, dispose) =>
          Effect.sync(() => {
            active.set(token, dispose)
          }).pipe(Effect.andThen(Deferred.succeed(disposerReady, dispose)), Effect.asVoid),
        unregister: (token) =>
          open(unregisterEntered).pipe(
            Effect.andThen(Deferred.await(unregisterRelease)),
            Effect.andThen(
              Effect.sync(() => {
                active.delete(token)
              }),
            ),
            Effect.andThen(open(unregisterExited)),
          ),
      }
      const runner = Runner.make<string>(scope, { lifecycle })
      const release = yield* Deferred.make<void>()
      yield* open(release)
      const entry = published(yield* runner.publish(() => Effect.succeed("done"), release))

      // Logical completion may return before physical close, but the exact closed barrier still
      // includes the unregister attempt rather than merely its invocation.
      expect(yield* entry.await).toBe("done")
      yield* Deferred.await(unregisterEntered)
      const disposer = yield* Deferred.await(disposerReady)
      const draining = yield* disposer.pipe(
        Effect.tap(() => open(drainFinished)),
        Effect.forkChild({ startImmediately: true }),
      )
      expect(yield* Deferred.isDone(drainFinished)).toBe(false)
      expect(yield* Deferred.isDone(unregisterExited)).toBe(false)
      expect(active.size).toBe(1)

      yield* open(unregisterRelease)
      yield* Fiber.join(draining)
      expect(yield* Deferred.isDone(unregisterExited)).toBe(true)
      expect(yield* Deferred.isDone(drainFinished)).toBe(true)
      // This is normal unregister evidence from the custom lifecycle itself; no lifecycle.dispose
      // map clear can make the assertion pass.
      expect(active.size).toBe(0)
    }),
  )

  it.live(
    "settles closed and exact disposer waiters when unregister defects (T-10/T-12)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const disposerReady = yield* Deferred.make<Effect.Effect<void>>()
      const unregisterEntered = yield* Deferred.make<void>()
      const unregisterRelease = yield* Deferred.make<void>()
      const drainFinished = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => open(unregisterRelease).pipe(Effect.ignore))
      const lifecycle: Runner.Lifecycle = {
        register: (_token, dispose) => Deferred.succeed(disposerReady, dispose).pipe(Effect.asVoid),
        unregister: () =>
          open(unregisterEntered).pipe(
            Effect.andThen(Deferred.await(unregisterRelease)),
            Effect.andThen(Effect.die("unregister defect")),
          ),
      }
      const runner = Runner.make<string>(scope, { lifecycle })
      const shell = yield* runner.startShell(Effect.succeed("done")).pipe(Effect.exit, Effect.forkChild)

      yield* Deferred.await(unregisterEntered)
      const disposer = yield* Deferred.await(disposerReady)
      const draining = yield* disposer.pipe(
        Effect.tap(() => open(drainFinished)),
        Effect.forkChild({ startImmediately: true }),
      )
      expect(yield* Deferred.isDone(drainFinished)).toBe(false)

      yield* open(unregisterRelease)
      const shellExit = yield* Fiber.join(shell)
      expect(Exit.isFailure(shellExit)).toBe(true)
      if (Exit.isFailure(shellExit)) expect(Cause.hasDies(shellExit.cause)).toBe(true)
      yield* Fiber.join(draining)
      expect(yield* Deferred.isDone(drainFinished)).toBe(true)
    }),
  )

  it.live(
    "drains a map-orphan generation from the Instance lifecycle and refuses stale restart (T-10)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const lifecycle = makeGenerationLifecycle()
      const runner = Runner.make<string>(scope, { lifecycle, onInterrupt: Effect.succeed("disposed") })
      const lookup = new Map([["session", runner]])
      const release = yield* Deferred.make<void>()
      const entry = published(yield* runner.publish(() => Effect.succeed("wrong"), release))
      expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 1 })

      lookup.delete("session")
      expect(lookup.size).toBe(0)
      const disposing = yield* lifecycle.dispose.pipe(Effect.forkChild)
      expect(yield* entry.await).toBe("disposed")
      yield* Fiber.join(disposing)
      expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 0 })

      const restartRelease = yield* Deferred.make<void>()
      yield* open(restartRelease)
      expect(yield* runner.publish(() => Effect.succeed("wrong"), restartRelease)).toEqual({
        type: "completed",
        value: "disposed",
      })
    }),
  )

  it.live(
    "orders natural run idle before result while retaining registration through physical close (T-11)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const lifecycle = makeGenerationLifecycle()
      const closeEntered = yield* Deferred.make<void>()
      const closeRelease = yield* Deferred.make<void>()
      const idleEntered = yield* Deferred.make<void>()
      const idleRelease = yield* Deferred.make<void>()
      const disposeFinished = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => open(idleRelease).pipe(Effect.andThen(open(closeRelease)), Effect.ignore))
      const runner = Runner.make<string>(scope, {
        lifecycle,
        onIdle: open(idleEntered).pipe(Effect.andThen(Deferred.await(idleRelease))),
      })
      const release = yield* Deferred.make<void>()
      yield* open(release)
      const entry = published(
        yield* runner.publish(
          (generation) =>
            Effect.addFinalizer(() => open(closeEntered).pipe(Effect.andThen(Deferred.await(closeRelease)))).pipe(
              Effect.provideService(Scope.Scope, generation),
              Effect.as("done"),
            ),
          release,
        ),
      )

      const waiting = yield* entry.await.pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(idleEntered)
      expect(yield* Deferred.isDone(entry.done)).toBe(false)
      expect(yield* Deferred.isDone(closeEntered)).toBe(false)
      expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 1 })

      const disposing = yield* lifecycle.dispose.pipe(
        Effect.tap(() => open(disposeFinished)),
        Effect.forkChild({ startImmediately: true }),
      )
      expect(yield* Deferred.isDone(disposeFinished)).toBe(false)
      expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 1 })

      yield* open(idleRelease)
      yield* Deferred.await(closeEntered)
      expect(yield* Fiber.join(waiting)).toBe("done")
      expect(yield* Deferred.isDone(disposeFinished)).toBe(false)
      expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 1 })

      yield* open(closeRelease)
      yield* Fiber.join(disposing)
      expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 0 })
      expect(yield* Deferred.isDone(disposeFinished)).toBe(true)
    }),
  )

  it.live(
    "separates deterministic running finish-wins and cancel-wins outcomes (T-09)",
    Effect.gen(function* () {
      for (const mode of ["finish", "cancel"] as const) {
        const scope = yield* Scope.Scope
        const lifecycle = makeGenerationLifecycle()
        const aStarted = yield* Deferred.make<void>()
        const aRelease = yield* Deferred.make<void>()
        const bStarted = yield* Deferred.make<void>()
        const bRelease = yield* Deferred.make<void>()
        const idleCount = yield* Ref.make(0)
        const closeCount = yield* Ref.make(0)
        const bRuns = yield* Ref.make(0)
        yield* Effect.addFinalizer(() => open(aRelease).pipe(Effect.andThen(open(bRelease)), Effect.ignore))
        const runner = Runner.make<string>(scope, {
          lifecycle,
          onInterrupt: Effect.succeed("cancelled"),
          onIdle: Ref.update(idleCount, (count) => count + 1),
        })
        const aPublication = yield* Deferred.make<void>()
        const bPublication = yield* Deferred.make<void>()
        yield* open(aPublication)
        yield* open(bPublication)
        const a = published(
          yield* runner.publish(
            (generation) =>
              Effect.addFinalizer(() => Ref.update(closeCount, (count) => count + 1)).pipe(
                Effect.andThen(open(aStarted)),
                Effect.andThen(Deferred.await(aRelease)),
                Effect.as("A"),
                Effect.provideService(Scope.Scope, generation),
              ),
            aPublication,
          ),
        )
        yield* Deferred.await(aStarted)
        const b = published(
          yield* runner.publish(
            () =>
              Ref.update(bRuns, (count) => count + 1).pipe(
                Effect.andThen(open(bStarted)),
                Effect.andThen(Deferred.await(bRelease)),
                Effect.as("B"),
              ),
            bPublication,
          ),
        )

        if (mode === "finish") {
          yield* open(aRelease)
          yield* Deferred.await(bStarted)
          expect(yield* a.await).toBe("A")
          expect(yield* Ref.get(bRuns)).toBe(1)
          const cancelling = yield* runner.cancel.pipe(Effect.forkChild({ startImmediately: true }))
          expect(yield* b.await).toBe("cancelled")
          yield* Fiber.join(cancelling)
        }
        if (mode === "cancel") {
          const cancelling = yield* runner.cancel.pipe(Effect.forkChild({ startImmediately: true }))
          expect(yield* a.await).toBe("cancelled")
          expect(yield* b.await).toBe("cancelled")
          yield* Fiber.join(cancelling)
          expect(yield* Deferred.isDone(bStarted)).toBe(false)
          expect(yield* Ref.get(bRuns)).toBe(0)
          yield* open(aRelease)
          yield* open(bRelease)
        }

        expect(yield* Ref.get(idleCount)).toBe(1)
        expect(yield* Ref.get(closeCount)).toBe(1)
        expect(runner.state._tag).toBe("Idle")
        expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 0 })
      }
    }),
  )

  it.live(
    "detach owns a stale naturally returning run until logical idle settles (T-09/M-08)",
    Effect.gen(function* () {
      // M-08 transition-ownership anchor: restoring stale `finishRun` completion makes the exact
      // entry expose `natural` while the detach owner's logical idle is still blocked.
      for (const mode of ["cancel", "dispose"] as const) {
        const scope = yield* Scope.Scope
        const lifecycle = makeGenerationLifecycle()
        const workStarted = yield* Deferred.make<void>()
        const workRelease = yield* Deferred.make<void>()
        const idleEntered = yield* Deferred.make<void>()
        const idleRelease = yield* Deferred.make<void>()
        const closeEntered = yield* Deferred.make<void>()
        const closeRelease = yield* Deferred.make<void>()
        const cleanupFinished = yield* Deferred.make<void>()
        const replacementStarted = yield* Deferred.make<void>()
        const replacementRelease = yield* Deferred.make<void>()
        const idleCount = yield* Ref.make(0)
        const closeCount = yield* Ref.make(0)
        const replacementRan = yield* Ref.make(false)
        yield* Effect.addFinalizer(() =>
          open(workRelease).pipe(
            Effect.andThen(open(idleRelease)),
            Effect.andThen(open(closeRelease)),
            Effect.andThen(open(replacementRelease)),
            Effect.ignore,
          ),
        )
        const runner = Runner.make<string>(scope, {
          lifecycle,
          onInterrupt: Effect.succeed("cancelled"),
          onIdle: Ref.update(idleCount, (count) => count + 1).pipe(
            Effect.andThen(open(idleEntered)),
            Effect.andThen(Deferred.await(idleRelease)),
          ),
        })
        const release = yield* Deferred.make<void>()
        yield* open(release)
        const entry = published(
          yield* runner.publish(
            (generation) =>
              Effect.addFinalizer(() =>
                Ref.update(closeCount, (count) => count + 1).pipe(
                  Effect.andThen(open(closeEntered)),
                  Effect.andThen(Deferred.await(closeRelease)),
                ),
              ).pipe(
                Effect.provideService(Scope.Scope, generation),
                Effect.andThen(open(workStarted)),
                Effect.andThen(Deferred.await(workRelease)),
                Effect.as("natural"),
              ),
            release,
          ),
        )
        yield* Deferred.await(workStarted)
        const current = runner.state
        if (current._tag !== "Running") return yield* Effect.die("expected active run")
        const caller = yield* entry.await.pipe(Effect.forkChild({ startImmediately: true }))
        const cleanup = yield* (mode === "cancel" ? runner.cancel : runner.dispose).pipe(
          Effect.tap(() => open(cleanupFinished)),
          Effect.forkChild({ startImmediately: true }),
        )

        yield* Deferred.await(idleEntered)
        expect(yield* Ref.get(idleCount)).toBe(1)
        yield* open(workRelease)
        const natural = yield* Fiber.await(current.run.fiber)
        expect(Exit.isSuccess(natural) && natural.value).toBe("natural")
        expect(yield* Deferred.isDone(entry.done)).toBe(false)

        yield* open(idleRelease)
        expect(yield* Fiber.join(caller)).toBe("cancelled")
        yield* Deferred.await(closeEntered)
        expect(yield* Deferred.isDone(cleanupFinished)).toBe(false)

        const replacement = yield* runner
          .ensureRunning(
            Ref.set(replacementRan, true).pipe(
              Effect.andThen(open(replacementStarted)),
              Effect.andThen(Deferred.await(replacementRelease)),
              Effect.as("replacement"),
            ),
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        if (mode === "cancel") yield* Deferred.await(replacementStarted)
        if (mode === "dispose") {
          expect(yield* Fiber.join(replacement)).toBe("cancelled")
          expect(yield* Deferred.isDone(replacementStarted)).toBe(false)
        }

        yield* open(closeRelease)
        yield* Fiber.join(cleanup)
        expect(yield* Ref.get(closeCount)).toBe(1)
        expect(yield* Ref.get(idleCount)).toBe(1)

        if (mode === "cancel") {
          expect(runner.busy).toBe(true)
          expect(yield* Ref.get(replacementRan)).toBe(true)
          yield* open(replacementRelease)
          expect(yield* Fiber.join(replacement)).toBe("replacement")
          expect(yield* Ref.get(idleCount)).toBe(2)
          yield* lifecycle.dispose
          expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 0 })
        }
        if (mode === "dispose") {
          expect(runner.busy).toBe(false)
          expect(yield* Ref.get(replacementRan)).toBe(false)
          expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 0 })
        }
      }
    }),
  )

  it.live(
    "detach owns a stale naturally returning shell until logical idle settles (T-12/M-08)",
    Effect.gen(function* () {
      // M-08 transition-ownership anchor: restoring raw shell-fiber result exposure makes the
      // caller return `natural` before the detach owner settles the exact shell result barrier.
      for (const mode of ["cancel", "dispose"] as const) {
        const scope = yield* Scope.Scope
        const lifecycle = makeGenerationLifecycle()
        const shellStarted = yield* Deferred.make<void>()
        const shellRelease = yield* Deferred.make<void>()
        const idleEntered = yield* Deferred.make<void>()
        const idleRelease = yield* Deferred.make<void>()
        const closeEntered = yield* Deferred.make<void>()
        const closeRelease = yield* Deferred.make<void>()
        const cleanupFinished = yield* Deferred.make<void>()
        const replacementStarted = yield* Deferred.make<void>()
        const replacementRelease = yield* Deferred.make<void>()
        const idleCount = yield* Ref.make(0)
        const closeCount = yield* Ref.make(0)
        const replacementRan = yield* Ref.make(false)
        yield* Effect.addFinalizer(() =>
          open(shellRelease).pipe(
            Effect.andThen(open(idleRelease)),
            Effect.andThen(open(closeRelease)),
            Effect.andThen(open(replacementRelease)),
            Effect.ignore,
          ),
        )
        const runner = Runner.make<string>(scope, {
          lifecycle,
          onInterrupt: Effect.succeed("cancelled"),
          onIdle: Ref.update(idleCount, (count) => count + 1).pipe(
            Effect.andThen(open(idleEntered)),
            Effect.andThen(Deferred.await(idleRelease)),
          ),
        })
        const caller = yield* runner
          .startShell(
            Effect.addFinalizer(() =>
              Ref.update(closeCount, (count) => count + 1).pipe(
                Effect.andThen(open(closeEntered)),
                Effect.andThen(Deferred.await(closeRelease)),
              ),
            ).pipe(
              Effect.andThen(open(shellStarted)),
              Effect.andThen(Deferred.await(shellRelease)),
              Effect.as("natural"),
            ) as Effect.Effect<string>,
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(shellStarted)
        const current = runner.state
        if (current._tag !== "Shell") return yield* Effect.die("expected active shell")
        const cleanup = yield* (mode === "cancel" ? runner.cancel : runner.dispose).pipe(
          Effect.tap(() => open(cleanupFinished)),
          Effect.forkChild({ startImmediately: true }),
        )

        yield* Deferred.await(idleEntered)
        expect(yield* Ref.get(idleCount)).toBe(1)
        yield* open(shellRelease)
        const natural = yield* Fiber.await(current.shell.fiber)
        expect(Exit.isSuccess(natural) && natural.value).toBe("natural")
        expect(yield* Deferred.isDone(current.shell.done)).toBe(false)

        yield* open(idleRelease)
        expect(yield* Fiber.join(caller)).toBe("cancelled")
        yield* Deferred.await(closeEntered)
        expect(yield* Deferred.isDone(current.shell.cancelled)).toBe(true)
        expect(yield* Deferred.isDone(cleanupFinished)).toBe(false)

        const replacement = yield* runner
          .ensureRunning(
            Ref.set(replacementRan, true).pipe(
              Effect.andThen(open(replacementStarted)),
              Effect.andThen(Deferred.await(replacementRelease)),
              Effect.as("replacement"),
            ),
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        if (mode === "cancel") yield* Deferred.await(replacementStarted)
        if (mode === "dispose") {
          expect(yield* Fiber.join(replacement)).toBe("cancelled")
          expect(yield* Deferred.isDone(replacementStarted)).toBe(false)
        }

        yield* open(closeRelease)
        yield* Fiber.join(cleanup)
        expect(yield* Ref.get(closeCount)).toBe(1)
        expect(yield* Ref.get(idleCount)).toBe(1)

        if (mode === "cancel") {
          expect(runner.busy).toBe(true)
          expect(yield* Ref.get(replacementRan)).toBe(true)
          yield* open(replacementRelease)
          expect(yield* Fiber.join(replacement)).toBe("replacement")
          expect(yield* Ref.get(idleCount)).toBe(2)
          yield* lifecycle.dispose
          expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 0 })
        }
        if (mode === "dispose") {
          expect(runner.busy).toBe(false)
          expect(yield* Ref.get(replacementRan)).toBe(false)
          expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 0 })
        }
      }
    }),
  )

  it.live(
    "keeps cancel/dispose cleanup owned across caller interruption and marks before exact shell stop (T-09/T-12)",
    Effect.gen(function* () {
      for (const mode of ["cancel", "dispose"] as const) {
        const scope = yield* Scope.Scope
        const lifecycle = makeGenerationLifecycle()
        const setupEntered = yield* Deferred.make<void>()
        const setupRelease = yield* Deferred.make<void>()
        const ready = yield* Latch.make()
        const markerReady = yield* Deferred.make<Deferred.Deferred<void>>()
        const markerBeforeInterrupt = yield* Ref.make(false)
        const shellInterrupted = yield* Ref.make(false)
        const idleEntered = yield* Deferred.make<void>()
        const idleRelease = yield* Deferred.make<void>()
        const idleCount = yield* Ref.make(0)
        const replacementStarted = yield* Deferred.make<void>()
        const replacementRelease = yield* Deferred.make<void>()
        const replacementRan = yield* Ref.make(false)
        yield* Effect.addFinalizer(() =>
          open(setupRelease).pipe(
            Effect.andThen(open(idleRelease)),
            Effect.andThen(open(replacementRelease)),
            Effect.ignore,
          ),
        )
        const runner = Runner.make<string, string>(scope, {
          lifecycle,
          onInterrupt: Effect.succeed("cancelled"),
          onIdle: Ref.update(idleCount, (count) => count + 1).pipe(
            Effect.andThen(open(idleEntered)),
            Effect.andThen(Deferred.await(idleRelease)),
          ),
        })
        const shell = yield* runner
          .startShell(
            open(setupEntered).pipe(
              Effect.andThen(Deferred.await(setupRelease)),
              Effect.andThen(ready.open),
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Effect.gen(function* () {
                  const marker = yield* Deferred.await(markerReady)
                  yield* Deferred.isDone(marker).pipe(Effect.flatMap((done) => Ref.set(markerBeforeInterrupt, done)))
                  yield* Ref.set(shellInterrupted, true)
                }),
              ),
            ),
            ready,
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(setupEntered)
        const release = yield* Deferred.make<void>()
        yield* open(release)
        const queued = published(yield* runner.publish(() => Effect.succeed("wrong"), release))
        const current = runner.state
        if (current._tag !== "ShellThenRun") throw new Error("expected queued shell generation")
        yield* Deferred.succeed(markerReady, current.shell.cancelled)

        const cleanup = yield* (mode === "cancel" ? runner.cancel : runner.dispose).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        // Logical map/status retirement precedes the queued barrier, and both precede the
        // still-closed shell-ready gate.
        yield* Deferred.await(idleEntered)
        expect(yield* Ref.get(idleCount)).toBe(1)
        expect(yield* Deferred.isDone(queued.done)).toBe(false)
        expect(yield* Ref.get(shellInterrupted)).toBe(false)
        yield* open(idleRelease)
        expect(yield* queued.await).toBe("cancelled")
        const interrupting = yield* Fiber.interrupt(cleanup).pipe(Effect.forkChild({ startImmediately: true }))
        expect(yield* Ref.get(shellInterrupted)).toBe(false)

        const replacement = yield* runner
          .ensureRunning(
            Ref.set(replacementRan, true).pipe(
              Effect.andThen(open(replacementStarted)),
              Effect.andThen(Deferred.await(replacementRelease)),
              Effect.as("replacement"),
            ),
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        if (mode === "cancel") yield* Deferred.await(replacementStarted)
        if (mode === "dispose") {
          expect(yield* Fiber.join(replacement)).toBe("cancelled")
          expect(yield* Deferred.isDone(replacementStarted)).toBe(false)
        }

        yield* open(setupRelease)
        yield* Fiber.join(interrupting)
        expect(yield* Fiber.join(shell)).toBe("cancelled")
        expect(yield* Ref.get(markerBeforeInterrupt)).toBe(true)
        expect(yield* Ref.get(shellInterrupted)).toBe(true)
        expect(yield* Ref.get(idleCount)).toBe(1)

        if (mode === "cancel") {
          expect(runner.busy).toBe(true)
          expect(yield* Ref.get(replacementRan)).toBe(true)
          expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 1 })
          yield* open(replacementRelease)
          expect(yield* Fiber.join(replacement)).toBe("replacement")
          expect(yield* Ref.get(idleCount)).toBe(2)
          yield* lifecycle.dispose
          expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 0 })
        }
        if (mode === "dispose") {
          expect(runner.busy).toBe(false)
          expect(yield* Ref.get(replacementRan)).toBe(false)
          expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 0 })
        }
      }
    }),
  )

  it.live(
    "does not let an onIdle defect strand cancellation barriers or physical close (T-09)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const lifecycle = makeGenerationLifecycle()
      const started = yield* Deferred.make<void>()
      const scopeClosed = yield* Deferred.make<void>()
      const runner = Runner.make<string>(scope, {
        lifecycle,
        onInterrupt: Effect.succeed("cancelled"),
        onIdle: Effect.die("idle defect"),
      })
      const release = yield* Deferred.make<void>()
      yield* open(release)
      const entry = published(
        yield* runner.publish(
          (generation) =>
            Effect.addFinalizer(() => open(scopeClosed)).pipe(
              Effect.andThen(open(started)),
              Effect.andThen(Effect.never),
              Effect.provideService(Scope.Scope, generation),
            ),
          release,
        ),
      )
      yield* Deferred.await(started)

      const cancelled = yield* runner.cancel.pipe(Effect.exit)
      expect(Exit.isFailure(cancelled)).toBe(true)
      if (Exit.isFailure(cancelled)) expect(Cause.hasDies(cancelled.cause)).toBe(true)
      expect(yield* entry.await).toBe("cancelled")
      expect(yield* Deferred.isDone(scopeClosed)).toBe(true)
      expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 0 })
    }),
  )

  it.live(
    "settles a natural run idle defect before exact physical close and unregisters (T-11)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const tracked = yield* trackedLifecycle
      const idleCount = yield* Ref.make(0)
      const closeCount = yield* Ref.make(0)
      const closeEntered = yield* Deferred.make<void>()
      const closeRelease = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => open(closeRelease).pipe(Effect.ignore))
      const runner = Runner.make<string>(scope, {
        lifecycle: tracked.lifecycle,
        onIdle: Ref.update(idleCount, (count) => count + 1).pipe(Effect.andThen(Effect.die("run idle defect"))),
      })
      const release = yield* Deferred.make<void>()
      yield* open(release)
      const entry = published(
        yield* runner.publish(
          (generation) =>
            Effect.addFinalizer(() =>
              Ref.update(closeCount, (count) => count + 1).pipe(
                Effect.andThen(open(closeEntered)),
                Effect.andThen(Deferred.await(closeRelease)),
              ),
            ).pipe(Effect.provideService(Scope.Scope, generation), Effect.as("natural")),
          release,
        ),
      )
      const caller = yield* entry.await.pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))

      // The idle defect owns the result, and that result settles before the independently ensured
      // physical close. Holding the exact Scope finalizer therefore cannot strand the caller.
      yield* Deferred.await(closeEntered)
      expect(yield* Deferred.isDone(entry.done)).toBe(true)
      const result = yield* Fiber.join(caller)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.hasDies(result.cause)).toBe(true)
      expect(yield* Deferred.isDone(tracked.unregistered)).toBe(false)
      expect(tracked.active.size).toBe(1)

      yield* open(closeRelease)
      yield* Deferred.await(tracked.unregistered)
      const exactDisposer = yield* Deferred.await(tracked.disposer)
      yield* exactDisposer
      expect(runner.state._tag).toBe("Idle")
      expect(yield* Ref.get(idleCount)).toBe(1)
      expect(yield* Ref.get(closeCount)).toBe(1)
      expect(yield* Ref.get(tracked.unregisters)).toBe(1)
      expect(tracked.active.size).toBe(0)
    }),
  )

  it.live(
    "settles a natural shell idle defect and still closes and unregisters exactly once (T-12)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const tracked = yield* trackedLifecycle
      const shellStarted = yield* Deferred.make<void>()
      const shellRelease = yield* Deferred.make<void>()
      const closeEntered = yield* Deferred.make<void>()
      const closeRelease = yield* Deferred.make<void>()
      const idleCount = yield* Ref.make(0)
      const closeCount = yield* Ref.make(0)
      yield* Effect.addFinalizer(() => open(shellRelease).pipe(Effect.andThen(open(closeRelease)), Effect.ignore))
      const runner = Runner.make<string>(scope, {
        lifecycle: tracked.lifecycle,
        onIdle: Ref.update(idleCount, (count) => count + 1).pipe(Effect.andThen(Effect.die("shell idle defect"))),
      })
      const caller = yield* runner
        .startShell(
          Effect.addFinalizer(() =>
            Ref.update(closeCount, (count) => count + 1).pipe(
              Effect.andThen(open(closeEntered)),
              Effect.andThen(Deferred.await(closeRelease)),
            ),
          ).pipe(
            Effect.andThen(open(shellStarted)),
            Effect.andThen(Deferred.await(shellRelease)),
            Effect.as("natural"),
          ) as Effect.Effect<string>,
        )
        .pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(shellStarted)
      const current = runner.state
      if (current._tag !== "Shell") return yield* Effect.die("expected active shell")

      yield* open(shellRelease)
      yield* Deferred.await(closeEntered)
      // Natural Q-empty shell semantics retain the exact physical-close wait, but idle failure can
      // no longer skip that close or leave the transition-owned shell barrier pending afterward.
      expect(yield* Deferred.isDone(current.shell.done)).toBe(false)
      expect(yield* Deferred.isDone(tracked.unregistered)).toBe(false)
      expect(tracked.active.size).toBe(1)

      yield* open(closeRelease)
      const result = yield* Fiber.join(caller)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.hasDies(result.cause)).toBe(true)
      yield* Deferred.await(tracked.unregistered)
      const exactDisposer = yield* Deferred.await(tracked.disposer)
      yield* exactDisposer
      expect(yield* Deferred.isDone(current.shell.done)).toBe(true)
      expect(runner.state._tag).toBe("Idle")
      expect(yield* Ref.get(idleCount)).toBe(1)
      expect(yield* Ref.get(closeCount)).toBe(1)
      expect(yield* Ref.get(tracked.unregisters)).toBe(1)
      expect(tracked.active.size).toBe(0)
    }),
  )

  it.live(
    "orders natural shell idle before physical close while retaining registration (T-12)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const lifecycle = makeGenerationLifecycle()
      const scopeClosed = yield* Deferred.make<void>()
      const idleEntered = yield* Deferred.make<void>()
      const idleRelease = yield* Deferred.make<void>()
      const disposeFinished = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => open(idleRelease).pipe(Effect.ignore))
      const runner = Runner.make<string>(scope, {
        lifecycle,
        onIdle: open(idleEntered).pipe(Effect.andThen(Deferred.await(idleRelease))),
      })
      const shell = yield* runner
        .startShell(Effect.addFinalizer(() => open(scopeClosed)).pipe(Effect.as("shell")) as Effect.Effect<string>)
        .pipe(Effect.forkChild({ startImmediately: true }))

      yield* Deferred.await(idleEntered)
      expect(yield* Deferred.isDone(scopeClosed)).toBe(false)
      expect(yield* lifecycle.inspect).toEqual({ closing: false, active: 1 })
      const disposing = yield* lifecycle.dispose.pipe(
        Effect.tap(() => open(disposeFinished)),
        Effect.forkChild({ startImmediately: true }),
      )
      expect(yield* Deferred.isDone(disposeFinished)).toBe(false)
      expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 1 })

      yield* open(idleRelease)
      yield* Deferred.await(scopeClosed)
      expect(yield* Fiber.join(shell)).toBe("shell")
      yield* Fiber.join(disposing)
      expect(yield* lifecycle.inspect).toEqual({ closing: true, active: 0 })
      expect(yield* Deferred.isDone(disposeFinished)).toBe(true)
    }),
  )

  it.live(
    "shell caller interruption uses exact stop and promotes the FIFO head (T-12)",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const ready = yield* Latch.make()
      const shellInterrupted = yield* Ref.make(false)
      const runner = Runner.make<string, string>(scope, { onInterrupt: Effect.succeed("cancelled") })
      const shell = yield* runner
        .startShell(
          ready.open.pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Ref.set(shellInterrupted, true)),
          ),
          ready,
        )
        .pipe(Effect.forkChild)
      yield* ready.await

      const release = yield* Deferred.make<void>()
      yield* open(release)
      const queued = published(yield* runner.publish(() => Effect.succeed("fifo"), release))
      yield* Fiber.interrupt(shell)

      expect(yield* queued.await).toBe("fifo")
      expect(yield* Ref.get(shellInterrupted)).toBe(true)

      const failure = yield* runner.startShell(Effect.fail("typed")).pipe(Effect.exit)
      expect(Exit.isFailure(failure)).toBe(true)
      if (Exit.isFailure(failure)) expect(Cause.squash(failure.cause)).toBe("typed")
    }),
  )
})
