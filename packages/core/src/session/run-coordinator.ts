export * as SessionRunCoordinator from "./run-coordinator"

import { Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E, Reason = never> {
  /** Snapshots keys with an execution owned by this coordinator. */
  readonly active: Effect.Effect<ReadonlySet<Key>>
  /** Starts an execution while idle, or joins the active execution and returns its exit. */
  readonly run: (key: Key) => Effect.Effect<void, E>
  /** Rings the doorbell: an idle key starts an execution; an active one drains again before settling. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Stops the active execution, clears its doorbell, and waits for cleanup. No-op when idle. */
  readonly interrupt: (key: Key, reason?: Reason) => Effect.Effect<void>
  /** Resolves once no execution is active for the key. Returns immediately when already idle and never starts work. */
  readonly awaitIdle: (key: Key) => Effect.Effect<void>
}

/**
 * One execution is a busy period for one key: one fiber that drains from the first wake
 * until the key would stay idle. `pendingWake` is the doorbell: work recorded during the
 * execution rings it, and the execution loop drains again instead of ending. The doorbell
 * closes the gap between a drain's last eligibility check and the idle transition, since
 * those cannot be one atomic step. `done` resolves joiners with this execution's exit.
 */
type Execution<E, Reason> = {
  readonly done: Deferred.Deferred<void, E>
  owner?: Fiber.Fiber<void>
  pendingWake: boolean
  stopping: boolean
  interruptionReason?: Reason
}

/**
 * ```text
 *              wake | run
 *      idle ──────────────▶ execution (one fiber)
 *                             drain ⟲ doorbell rung mid-drain
 *                             │ exit (settled hook runs)
 *      doorbell quiet ◀───────┴───────▶ doorbell rung
 *      idle, waiters get exit          successor execution,
 *                                      waiters get this exit
 * ```
 */
export const make = <Key, E, Reason = never>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
  /** Runs once when a process-local busy period begins, before its first drain. */
  readonly started?: (key: Key) => Effect.Effect<void>
  /**
   * Runs in the execution fiber for every exit, including interruption, after the final
   * drain and before the execution settles (waiters resolve after it completes).
   */
  readonly settled?: (key: Key, exit: Exit.Exit<void, E>, reason?: Reason) => Effect.Effect<void>
}): Effect.Effect<Coordinator<Key, E, Reason>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const executions = new Map<Key, Execution<E, Reason>>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()

    const loop = (key: Key, execution: Execution<E, Reason>, force: boolean): Effect.Effect<void, E> =>
      Effect.suspend(() => options.drain(key, force)).pipe(
        Effect.flatMap(() =>
          Effect.suspend(() => {
            if (execution.stopping || !execution.pendingWake) return Effect.void
            execution.pendingWake = false
            // Trampoline so drains that complete synchronously cannot grow the stack.
            return Effect.yieldNow.pipe(Effect.andThen(loop(key, execution, false)))
          }),
        ),
      )

    const start = (key: Key, force: boolean) => {
      const execution: Execution<E, Reason> = {
        done: Deferred.makeUnsafe<void, E>(),
        pendingWake: false,
        stopping: false,
      }
      executions.set(key, execution)
      // The leading yield lets `owner` be assigned before the drain can settle, and keeps
      // failing self-waking executions from growing the stack across successor starts.
      // Drains start one tick after wake; callers observe progress through events or run.
      execution.owner = fork(
        Effect.yieldNow.pipe(
          Effect.andThen(Effect.uninterruptible(options.started?.(key) ?? Effect.void)),
          Effect.andThen(loop(key, execution, force)),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              execution.owner = undefined
            }).pipe(Effect.andThen(options.settled?.(key, exit, execution.interruptionReason) ?? Effect.void)),
          ),
          Effect.onExit((exit) => Effect.sync(() => settle(key, execution, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      return execution
    }

    // A doorbell that survives the execution loop (rung after the loop decided to end, or
    // during failure or interruption cleanup) starts a fresh execution for the remaining work.
    const settle = (key: Key, execution: Execution<E, Reason>, exit: Exit.Exit<void, E>) => {
      if (execution.pendingWake) start(key, false)
      else executions.delete(key)
      Deferred.doneUnsafe(execution.done, exit)
    }

    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.suspend(() => {
        const execution = executions.get(key)
        if (execution !== undefined) {
          // A stopping execution refuses joiners: wait out its cleanup, then run fresh.
          if (execution.stopping) return Deferred.await(execution.done).pipe(Effect.andThen(run(key)))
          return Deferred.await(execution.done)
        }
        return Deferred.await(start(key, true).done)
      })

    const wake = (key: Key) =>
      Effect.sync(() => {
        const execution = executions.get(key)
        if (execution !== undefined) {
          execution.pendingWake = true
          return
        }
        start(key, false)
      })

    const interrupt = (key: Key, reason?: Reason): Effect.Effect<void> =>
      Effect.suspend(() => {
        const execution = executions.get(key)
        if (execution?.owner === undefined || execution.stopping) return Effect.void
        execution.stopping = true
        execution.pendingWake = false
        execution.interruptionReason = reason
        return Fiber.interrupt(execution.owner)
      })

    // One execution's `done` already spans coalesced continuations; re-check after it
    // settles to cover a successor execution started by a late doorbell.
    const awaitIdle = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const execution = executions.get(key)
        if (execution === undefined) return Effect.void
        return Deferred.await(execution.done).pipe(Effect.exit, Effect.andThen(awaitIdle(key)))
      })

    return { active: Effect.sync(() => new Set(executions.keys())), run, wake, interrupt, awaitIdle }
  })
