import type { Cleanup } from "./core"

/**
 * A lifetime, named after Effect's `Scope` without its runtime. Closing it aborts `signal`, then runs its finalizers
 * in reverse order, each isolated from the others' failures, under a deadline. A main entry's `ctx.scope` closes when
 * the extension is disabled, reloaded, removed, or the app quits.
 *
 * @example
 * ```ts
 * const timer = setInterval(poll, 60_000)
 * ctx.scope.addFinalizer(() => clearInterval(timer))
 * const session = ctx.scope.fork("session")
 * ```
 */
export interface Scope {
  /** Aborts when the scope closes. Pass it to long work, and return after an `await` if it aborted. */
  readonly signal: AbortSignal
  /**
   * Runs `fn` when the scope closes, or at once when it already has. A throw or rejection is logged and the other
   * finalizers still run.
   *
   * @param fn - The teardown. A named function's name labels it in the timeout log.
   * @returns Runs `fn` early instead, and removes it from the scope.
   */
  addFinalizer(fn: Cleanup): Cleanup
  /**
   * A child scope. It closes with this one, in reverse order like a finalizer, or earlier on its own.
   *
   * @param name - Labels the child in logs, as `parent/name`.
   */
  fork(name: string): Scope
  /**
   * Aborts `signal` at once; the finalizers start once the calling code yields. Settles when they have, or at the
   * deadline: a finalizer still running then is logged and no longer waited for, and the rest start. Closing again
   * also waits for the finalizers added since.
   */
  close(): Promise<void>
}

/** Writes a structured log entry; the logger serializes each field of `data` as it is. */
type Log = <Data extends Readonly<Record<string, unknown>>>(message: string, data: Data) => void

type Options = {
  /** How long `close` waits for the finalizers, in milliseconds. */
  readonly timeout: number
  /** Reports finalizers that failed or timed out. */
  readonly log: Log
}

// A fork has no label: it logs its own finalizers.
type Finalizer = { readonly label?: string; readonly run: Cleanup }

/**
 * Creates scopes. The main host makes one per extension instance; an extension forks `ctx.scope` instead.
 *
 * @example
 * ```ts
 * const scope = Scope.make("example", { timeout: 3_000, log: (message, data) => console.error(message, data) })
 * ```
 */
export const Scope = {
  /**
   * Creates an open scope.
   *
   * @param name - Labels the scope in logs.
   * @param options - The deadline and the log.
   */
  make: (name: string, options: Options): Scope => create(name, options),
}

function create(name: string, options: Options, detach?: () => void): Scope {
  const controller = new AbortController()
  const finalizers = new Set<Finalizer>()
  // Finalizers that started and have not settled or been given up on.
  const running = new Map<Promise<void>, string | undefined>()
  // The finalizers registered before closing run on this chain, in reverse.
  const closing = { closed: false, chain: Promise.resolve() }

  const start = (finalizer: Finalizer) => {
    const run: Promise<void> = Promise.resolve()
      .then(finalizer.run)
      .then(
        () => undefined,
        (cause: unknown) => options.log("scope finalizer failed", { scope: name, error: cause }),
      )
      .finally(() => running.delete(run))

    running.set(run, finalizer.label)

    return run
  }

  const settle = (deadline: Deadline) =>
    Promise.race([Promise.all([closing.chain, ...running.keys()]), deadline.passed])
      .then(() => undefined)
      .finally(deadline.cancel)

  const deadline = (): Deadline => {
    const passed = Promise.withResolvers<void>()

    const timer = setTimeout(() => {
      running.forEach((label, run) => {
        running.delete(run)

        if (label !== undefined) options.log("scope finalizer timed out", { scope: name, finalizer: label })
      })
      passed.resolve()
    }, options.timeout)

    return { passed: passed.promise, cancel: () => clearTimeout(timer) }
  }

  const scope: Scope = {
    signal: controller.signal,
    addFinalizer(fn) {
      const finalizer = { label: fn.name || "anonymous", run: fn }

      if (closing.closed) {
        void start(finalizer)

        return () => {}
      }

      finalizers.add(finalizer)

      return () => {
        if (finalizers.delete(finalizer)) return fn()
      }
    },
    fork(child) {
      const finalizer: Finalizer = { run: () => forked.close() }
      const forked = create(`${name}/${child}`, options, () => finalizers.delete(finalizer))

      if (closing.closed) void forked.close()
      else finalizers.add(finalizer)

      return forked
    },
    close() {
      if (closing.closed) return settle(deadline())
      detach?.()
      controller.abort()
      const first = deadline()
      const ordered = [...finalizers].reverse()
      finalizers.clear()
      closing.closed = true
      closing.chain = ordered.reduce(
        (chain: Promise<void>, finalizer) =>
          chain.then(() => Promise.race([start(finalizer), first.passed]).then(() => undefined)),
        Promise.resolve(),
      )

      return settle(first)
    },
  }

  return scope
}

type Deadline = { readonly passed: Promise<void>; readonly cancel: () => void }
