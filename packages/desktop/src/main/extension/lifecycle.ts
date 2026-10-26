import { Scope, type Cleanup } from "@opencode/gui-extensions/sdk/main"

/** How long disposal waits for an instance's finalizers and a setup still running. */
const CLEANUP_TIMEOUT_MS = 3_000

/** A setup still running after this long is logged once. */
const SETUP_STALL_MS = 10_000

/** One running copy of an extension's main code, from setup until it is stopped. */
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

/** One loaded revision of an extension's main code. Each call prepares a fresh instance of it. */
export type Revision = (instance: Instance) => {
  /** Settles before setup runs; setup never runs when the extension stops first. A failure here does not stop setup. */
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
  readonly revision: Revision
  readonly ready: Promise<unknown>
  /** Its setup succeeded while it was active. */
  good: boolean
  /** Runs setup once. A finalizer it adds belongs to the instance, even when setup settles after disposal. */
  start(): Promise<Outcome>
  /**
   * Withdraws everything the instance contributed at once, then settles once its finalizers and a setup still
   * running have finished, or the deadline passed. Idempotent.
   */
  dispose(): Promise<void>
}

/**
 * The extension lifecycle without Electron: one serialized queue of operations per extension, the instances they
 * start and stop, and what the host withdraws when an instance goes away.
 */
export function createLifecycle(input: {
  /** Loads the extension's current main code; undefined when it has none. */
  readonly loader: (id: string) => (() => Promise<Revision>) | undefined
  readonly enabled: (id: string) => boolean
  /** A failure was recorded. */
  readonly changed: () => void
  readonly log: ErrorLog
}) {
  const active = new Map<string, Running>()
  // One serialized lifecycle per extension: each operation starts after the previous one fully settled.
  const queues = new Map<string, Promise<void>>()
  // Each extension's current generation. Stopping aborts it, so the activations queued or running under it
  // wind down at once; operations queued afterwards run under a fresh generation.
  const generations = new Map<string, AbortController>()
  // The revision whose setup last succeeded since the extension was last stopped; a failed reload returns to it.
  const last = new Map<string, Revision>()
  const errors = new Map<string, string>()
  // Scopes a restart handoff keeps. Quitting skips their instances, so a failed handoff leaves them working and a
  // successful one keeps their state and contributions until the app has quit.
  const kept = new Set<Scope>()
  const status = { quitting: false }

  const current = (id: string, signal: AbortSignal) => !signal.aborted && input.enabled(id) && !status.quitting

  const fail = (id: string, cause: unknown) => {
    errors.set(id, cause instanceof Error ? cause.message : String(cause))
    input.log("extension failed", { id, error: cause })
    input.changed()
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
        input.log("extension withdrawal failed", { id, error })
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

    const prepared = revision(instance)
    const progress: Progress = { setup: Promise.resolve(undefined) }

    return {
      instance,
      revision,
      ready: prepared.ready.catch(() => undefined),
      good: false,
      start() {
        const stall = setTimeout(() => input.log("extension setup stalled", { id, ms: SETUP_STALL_MS }), SETUP_STALL_MS)

        // A finalizer a setup adds after disposal started runs at once, and disposal waits for it.
        const outcome = Promise.resolve()
          .then(prepared.setup)
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
          () => input.log("extension cleanup timed out", { id }),
        )

        progress.disposed = Promise.all([closed, settled]).then(() => undefined)

        return progress.disposed
      },
    }
  }

  // The caller sees the step's own outcome; the queue only waits for it to settle, so a failed step never
  // stalls the steps behind it.
  const enqueue = (id: string, task: () => Promise<void>) => {
    const step = (queues.get(id) ?? Promise.resolve()).then(task).then(() => undefined)

    const tail: Promise<void> = step
      .catch(() => undefined)
      .finally(() => {
        if (queues.get(id) === tail) queues.delete(id)
      })

    queues.set(id, tail)

    return step
  }

  const generation = (id: string) => {
    const existing = generations.get(id)

    if (existing) return existing.signal
    const created = new AbortController()
    generations.set(id, created)

    return created.signal
  }

  const stop = (id: string) => {
    generations.get(id)?.abort()
    generations.delete(id)
  }

  /** The loaded revision, or undefined when loading failed (recorded) or the extension stopped meanwhile. */
  const load = (id: string, signal: AbortSignal, loader: () => Promise<Revision>) =>
    until(
      signal,
      loader().catch((cause: unknown) => {
        if (current(id, signal)) fail(id, cause)

        return undefined
      }),
    )

  /** Starts an instance of the revision. Resolves with its setup's outcome, or undefined when it stopped first. */
  const run = async (id: string, signal: AbortSignal, revision: Revision) => {
    const running = create(id, revision)
    active.set(id, running)
    await until(signal, running.ready)

    // Stopping removed the instance and began disposing it; its setup never runs.
    if (!current(id, signal)) {
      if (active.get(id) === running) active.delete(id)
      await running.dispose()

      return undefined
    }

    const outcome = await until(signal, running.start())

    // A stop during setup settles this step once the disposal has, however long setup takes.
    if (!outcome) {
      await running.dispose()

      return undefined
    }

    if (active.get(id) !== running) return undefined

    if (outcome.ok) {
      running.good = true
      last.set(id, revision)

      return outcome
    }

    fail(id, outcome.error)
    active.delete(id)
    await running.dispose()

    return outcome
  }

  const activate = (id: string) => {
    const signal = generation(id)

    return enqueue(id, async () => {
      const loader = input.loader(id)

      if (!loader || active.has(id) || !current(id, signal)) return
      errors.delete(id)
      const revision = await load(id, signal, loader)

      // Stopped, disabled, or quitting while the code loaded: drop it, it may belong to an older revision.
      if (!revision || active.has(id) || !current(id, signal)) return
      await run(id, signal, revision)
    })
  }

  /**
   * Stops the extension at once and queues its teardown: activations queued before it go stale, the instance
   * withdraws everything it contributed now, and the queue moves on only after its disposal settled. `after`
   * runs inside the queue once the teardown finished.
   */
  const deactivate = (id: string, after?: () => void) => {
    stop(id)
    last.delete(id)
    const running = active.get(id)
    active.delete(id)
    void running?.dispose()

    return enqueue(id, async () => {
      await running?.dispose()
      after?.()
    })
  }

  /**
   * Replaces the extension with its current code. A good instance keeps running until that code loaded; a reload that
   * fails to load or set up leaves the last good revision running, with the failure recorded.
   */
  const reload = (id: string) => {
    errors.delete(id)
    stop(id)
    const previous = active.get(id)
    // An instance still starting is no revision to keep: it stops at once, as on disable.
    const stopped = previous && !previous.good ? previous : undefined

    if (stopped) {
      active.delete(id)
      void stopped.dispose()
    }

    const signal = generation(id)

    return enqueue(id, async () => {
      await stopped?.dispose()
      const loader = input.loader(id)

      if (!loader || !current(id, signal)) return
      const fallback = last.get(id)
      const revision = await load(id, signal, loader)

      if (!current(id, signal)) return
      const running = active.get(id)

      if (!revision) {
        if (!running && fallback) await run(id, signal, fallback)

        return
      }

      if (running) {
        active.delete(id)
        await running.dispose()

        if (!current(id, signal)) return
      }

      const outcome = await run(id, signal, revision)

      if (outcome?.ok === false && fallback) await run(id, signal, fallback)
    })
  }

  return {
    activate,
    deactivate,
    reload,
    failure: (id: string) => errors.get(id),
    forget(id: string) {
      errors.delete(id)
    },
    /**
     * Runs a restart handoff that keeps `keep`, an instance's scope: quitting skips that instance until the handoff
     * settles. Rejects without running the handoff when no instance has that scope.
     */
    restart(keep: Scope, handoff: () => Promise<void>) {
      if (![...active.values()].some((running) => running.instance.scope === keep))
        return Promise.reject(new Error("Lifecycle.restart keeps only an active extension's ctx.scope"))
      kept.add(keep)

      return Promise.resolve()
        .then(handoff)
        .finally(() => kept.delete(keep))
    },
    /** Stops every extension but a kept one; settles once each lifecycle has. */
    async dispose() {
      status.quitting = true
      // Every other extension with an instance or a queued step stops; quitting waits for each lifecycle to settle.
      await Promise.all(
        [...new Set([...active.keys(), ...queues.keys()])].flatMap((id) => {
          const running = active.get(id)

          return running && kept.has(running.instance.scope) ? [] : [deactivate(id)]
        }),
      )
    },
  }
}

/**
 * The promise's value, or undefined as soon as the signal aborts; the promise itself keeps running. Once the promise
 * settled, a later abort changes nothing: a reload aborts the generation of an instance it keeps.
 */
function until<T>(signal: AbortSignal, promise: Promise<T>) {
  if (signal.aborted) return Promise.resolve(undefined)

  return new Promise<T | undefined>((resolve, reject) => {
    const abort = () => resolve(undefined)
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
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
