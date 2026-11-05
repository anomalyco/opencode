import { Scope } from "@opencode/plugin/gui/host"
import type { Cleanup } from "@opencode/plugin/gui/main"
import { isQuitting, keptScope, type Handoff, type State } from "../lifecycle/machine"
import {
  createLifecycleState,
  selectHasPluginScope,
  selectPluginFailure,
  selectPluginIds,
  transitionLifecycle,
  type LifecycleCommand,
  type LifecycleEvent,
} from "./lifecycle-machine"

/** How long disposal waits for an instance's finalizers and a setup still running. */
const CLEANUP_TIMEOUT_MS = 3_000

/** A setup still running after this long is logged once. */
const SETUP_STALL_MS = 10_000

/** One running copy of a plugin's main code, from setup until it is stopped. */
export interface Instance {
  readonly id: string
  /** Closes when the instance goes away, right after the host withdrew what the instance contributed. */
  readonly scope: Scope
  /**
   * Records something the host registered for the instance. The host withdraws it synchronously the moment disposal
   * starts, before any finalizer runs, and at once when registered after that. The function returned withdraws it early.
   */
  contribute(withdraw: () => void): Cleanup
}

/** One loaded revision of a plugin's main code. Each call prepares a fresh instance of it. */
export type Revision = (instance: Instance) => {
  /** Settles before setup runs; setup never runs when the plugin stops first. A failure here does not stop setup. */
  readonly ready: Promise<unknown>
  readonly setup: () => void | Promise<void>
}

/** Writes a structured error log entry; the logger serializes each field of `data` as it is. */
export type ErrorLog = <Data extends Readonly<Record<string, unknown>>>(message: string, data: Data) => void

type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }

/** Where an instance's setup and disposal stand. */
type Progress = { setup: Promise<Outcome | undefined>; disposed?: Promise<void> }

type Running = {
  readonly instance: Instance
  readonly ready: Promise<unknown>
  /** Runs setup once. A finalizer it adds belongs to the instance, even when setup settles after disposal. */
  start(): Promise<Outcome>
  /**
   * Withdraws everything the instance contributed at once, then settles once its finalizers and a setup still
   * running have finished, or the deadline passed. Idempotent.
   */
  dispose(): Promise<void>
}

/**
 * The plugin lifecycle without Electron: one serialized queue of operations per plugin, the instances they
 * start and stop, and what the host withdraws when an instance goes away. `lifecycle-machine.ts` holds where each
 * plugin stands; this runs its commands.
 */
export function createLifecycle(input: {
  /** Loads the plugin's current main code; undefined when it has none. */
  readonly loader: (id: string) => (() => Promise<Revision>) | undefined
  readonly enabled: (id: string) => boolean
  /** A failure was recorded. */
  readonly changed: () => void
  /** Where the app stands between running and exiting; plugins start only while it is not quitting. */
  readonly state: () => State
  /** Stops every plugin but the one whose scope is `keep`, then runs the handoff or relaunches. */
  readonly restart: (keep: Scope, handoff?: Handoff) => Promise<void>
  readonly log: ErrorLog
}) {
  const current = { state: createLifecycleState<Running, Revision>() }
  // Events a command raises wait until every command of the event before them ran.
  const queue: LifecycleEvent<Running, Revision>[] = []

  const canRun = (id: string) => input.enabled(id) && !isQuitting(input.state())

  const dispatch = (event: LifecycleEvent<Running, Revision>) => {
    queue.push(event)

    if (queue.length === 1) drain()
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    try {
      const next = transitionLifecycle(current.state, event)
      current.state = next.state
      // Each command runs on its own, so one that throws cannot keep the rest from running.
      next.commands.forEach((command) =>
        Promise.try(() => perform(command)).catch((error) =>
          input.log("plugin lifecycle command failed", { command: command.type, error }),
        ),
      )
    } finally {
      queue.shift()
    }

    drain()
  }

  const perform = (command: LifecycleCommand<Running, Revision>) => {
    if (command.type === "run-after") return command.callbacks.forEach((callback) => callback())

    if (command.type === "resolve") return command.replies.forEach((reply) => reply())

    if (command.type === "notify-changed") return input.changed()
    const id = command.id

    switch (command.type) {
      case "load": {
        const attempt = command.attempt
        const loader = canRun(id) ? input.loader(id) : undefined

        if (!loader) return dispatch({ type: "load.cancelled", id, attempt })
        dispatch({ type: "load.started", id, attempt })

        // Stopped, disabled, or quitting while the code loaded: drop it, it may belong to an older revision.
        return void Promise.try(loader).then(
          (revision) =>
            dispatch(
              canRun(id) ? { type: "load.succeeded", id, attempt, revision } : { type: "load.cancelled", id, attempt },
            ),
          (error) =>
            dispatch(
              canRun(id) ? { type: "load.failed", id, attempt, error } : { type: "load.cancelled", id, attempt },
            ),
        )
      }

      case "create":
        return dispatch({
          type: "instance.created",
          id,
          attempt: command.attempt,
          running: create(id, command.revision),
        })

      case "await-ready": {
        const attempt = command.attempt

        return void command.running.ready.then(() =>
          dispatch({ type: "instance.ready", id, attempt, canRun: canRun(id) }),
        )
      }

      case "run-setup": {
        const attempt = command.attempt

        return void command.running
          .start()
          .then((outcome) =>
            dispatch(
              outcome.ok
                ? { type: "setup.succeeded", id, attempt }
                : { type: "setup.failed", id, attempt, error: outcome.error },
            ),
          )
      }

      case "dispose": {
        const attempt = command.attempt
        const disposed = command.running.dispose()

        if (attempt === undefined) return
        const settled = () => dispatch({ type: "dispose.settled", id, attempt, canRun: canRun(id) })

        return void disposed.then(settled, settled)
      }

      case "log-failure":
        return input.log("plugin failed", { id, error: command.error })
    }
  }

  const create = (id: string, revision: Revision): Running => {
    const scope = Scope.make(id, { timeout: CLEANUP_TIMEOUT_MS, log: input.log })
    // The host's record of what the instance contributed; the host withdraws it the moment disposal starts.
    const contributions = new Set<() => void>()

    const withdraw = (fn: () => void) => {
      // Host bookkeeping does not throw by design; isolating it keeps one failure from leaving the rest behind.
      try {
        fn()
      } catch (error) {
        input.log("plugin withdrawal failed", { id, error })
      }
    }

    const instance: Instance = {
      id,
      scope,
      contribute(fn) {
        if (scope.signal.aborted) {
          withdraw(fn)

          return () => {}
        }

        const remove = () => {
          if (contributions.delete(remove)) fn()
        }

        contributions.add(remove)

        return remove
      },
    }

    // A revision that throws while preparing fails the instance's setup.
    const prepared = Promise.try(() => revision(instance))
    const progress: Progress = { setup: Promise.resolve(undefined) }

    return {
      instance,
      ready: prepared.then((value) => value.ready).catch(() => undefined),
      start() {
        const stall = setTimeout(() => input.log("plugin setup stalled", { id, ms: SETUP_STALL_MS }), SETUP_STALL_MS)

        // A finalizer a setup adds after disposal started runs at once, and disposal waits for it.
        const outcome = prepared
          .then((value) => value.setup())
          .then(
            (): Outcome => ({ ok: true }),
            (cause: unknown): Outcome => ({ ok: false, error: cause }),
          )
          .finally(() => clearTimeout(stall))

        progress.setup = outcome

        return outcome
      },
      dispose() {
        if (progress.disposed) return progress.disposed

        // Aborts the signal now; the finalizers start only after the withdrawal below.
        const closed = scope.close()

        // The host withdraws first and synchronously: a disposed instance is unreachable even if a finalizer hangs.
        ;[...contributions].reverse().forEach(withdraw)

        // A setup still running settles, and the finalizers it adds late run, before the next lifecycle step.
        const settled = within(
          progress.setup.then(() => scope.close()),
          () => input.log("plugin cleanup timed out", { id }),
        )

        progress.disposed = Promise.all([closed, settled]).then(() => undefined)

        return progress.disposed
      },
    }
  }

  const request = (event: (reply: () => void) => LifecycleEvent<Running, Revision>) =>
    new Promise<void>((resolve) => dispatch(event(resolve)))

  return {
    activate: (id: string) => request((reply) => ({ type: "activate.requested", id, reply })),
    /**
     * Stops the plugin at once and queues its teardown: activations queued before it go stale, the instance
     * withdraws everything it contributed now, and the queue moves on only after its disposal settled. `after`
     * runs inside the queue once the teardown finished.
     */
    deactivate: (id: string, after?: () => void) =>
      request((reply) => ({ type: "deactivate.requested", id, after, reply })),
    /**
     * Replaces the plugin with its current code. A good instance keeps running until that code loaded; a reload that
     * fails to load or set up leaves the last good revision running, with the failure recorded. A restart handoff's
     * kept instance stays as it is.
     */
    reload: (id: string) =>
      request((reply) => ({ type: "reload.requested", id, keep: keptScope(input.state()), reply })),
    failure: (id: string) => selectPluginFailure(current.state, id),
    forget: (id: string) => dispatch({ type: "forget.requested", id }),
    /**
     * Restarts the app keeping `keep`, an instance's scope: stopping skips that instance while the handoff runs, so a
     * failed handoff leaves it working. Rejects without running the handoff when no instance has that scope.
     */
    restart(keep: Scope, handoff?: Handoff) {
      if (!selectHasPluginScope(current.state, keep))
        return Promise.reject(new Error("Lifecycle.restart keeps only an active plugin's ctx.scope"))

      return input.restart(keep, handoff)
    },
    /** Stops every plugin but the one the app keeps; settles once each lifecycle has. */
    async stop() {
      const keep = keptScope(input.state())

      await Promise.all(
        selectPluginIds(current.state).map((id) => request((reply) => ({ type: "stop.requested", id, keep, reply }))),
      )
    },
  }
}

/** Waits for the promise until the cleanup deadline, then reports and stops waiting. */
function within(promise: Promise<void>, timedOut: () => void) {
  const deadline = Promise.withResolvers<void>()

  const timer = setTimeout(() => {
    timedOut()
    deadline.resolve()
  }, CLEANUP_TIMEOUT_MS)

  return Promise.race([promise, deadline.promise]).finally(() => clearTimeout(timer))
}
