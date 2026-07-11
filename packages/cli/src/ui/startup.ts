import { Cause, Effect, Exit, Option } from "effect"
import type { TimelineHost } from "./timeline"

type StartupProgressHost = Pick<TimelineHost, "signal" | "pending" | "close">

type StartupProgress = {
  readonly releaseTerminal: () => Promise<void>
  readonly onServerStart: (reason: "missing" | "version-mismatch") => void
}

type StartupProgressOptions = {
  readonly enabled?: boolean
  readonly terminal?: { readonly stdin: boolean | undefined; readonly stdout: boolean | undefined }
  readonly create?: (signal: AbortSignal) => Promise<StartupProgressHost>
  readonly handoffTimeout?: number
  readonly schedule?: (callback: () => void, delay: number) => () => void
  readonly write?: (text: string) => void
}

const DELAY = 500
const HANDOFF_TIMEOUT = 5_000
const MESSAGE = "Starting OpenCode..."

export function withStartupProgress<A, E, R>(
  use: (progress: StartupProgress) => Effect.Effect<A, E, R>,
  options: StartupProgressOptions = {},
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => createProgress(options)),
    (progress) => use(progress).pipe(Effect.raceFirst(interruptOnAbort(progress.signal))),
    (progress, exit) =>
      Effect.tryPromise({
        try: progress.releaseTerminal,
        catch: toError,
      }).pipe(
        Effect.catchCause((cause) =>
          Exit.isFailure(exit)
            ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) ===
              Option.getOrUndefined(Cause.findErrorOption(cause))
              ? Effect.void
              : Effect.failCause(Cause.combine(exit.cause, cause))
            : Effect.failCause(cause),
        ),
      ),
  )
}

function createProgress(options: StartupProgressOptions) {
  const terminal = options.terminal ?? { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }
  const interactive = options.enabled !== false && terminal.stdin === true && terminal.stdout === true
  const controller = new AbortController()
  const creation = new AbortController()
  const stopReason = new Error("Startup progress stopped")
  stopReason.name = "AbortError"
  let closed = false
  let host: StartupProgressHost | undefined
  let task: Promise<void> | undefined
  let closeTask: Promise<void> | undefined
  let detach: (() => void) | undefined

  const open = () => {
    if (closed || task) return
    task = (async () => {
      const next = await (options.create ?? createTimeline)(creation.signal)
      host = next
      if (closed) {
        await next.close()
        return
      }

      const abort = () => controller.abort(next.signal.reason)
      if (next.signal.aborted) abort()
      else {
        next.signal.addEventListener("abort", abort, { once: true })
        detach = () => next.signal.removeEventListener("abort", abort)
      }
      await next.pending(MESSAGE)
    })().catch((cause) => {
      if (closed && cause === stopReason) return
      throw cause
    })
    void task.catch(() => {})
  }

  const cancel = interactive ? (options.schedule ?? schedule)(open, DELAY) : undefined
  const releaseTerminal = () => {
    if (closeTask) return closeTask
    closed = true
    cancel?.()
    creation.abort(stopReason)
    closeTask = (async () => {
      const active = host
      if (!active) {
        if (task) await withTimeout(task, options.handoffTimeout ?? HANDOFF_TIMEOUT)
        return
      }

      detach?.()
      detach = undefined
      const [opened, stopped] = await withTimeout(
        Promise.allSettled([task ?? Promise.resolve(), Promise.resolve().then(() => active.close())]),
        options.handoffTimeout ?? HANDOFF_TIMEOUT,
      )
      if (opened.status === "rejected" && stopped.status === "rejected")
        throw new AggregateError([opened.reason, stopped.reason], "Failed to stop startup progress")
      if (stopped.status === "rejected") throw stopped.reason
      if (opened.status === "rejected") throw opened.reason
    })()
    return closeTask
  }

  const write = options.write ?? ((text: string) => void process.stderr.write(text))
  return {
    signal: controller.signal,
    releaseTerminal,
    onServerStart(reason: "missing" | "version-mismatch") {
      if (interactive) return
      write(
        reason === "version-mismatch"
          ? "Restarting background server (version mismatch)...\n"
          : "Starting background server...\n",
      )
    },
  }
}

function interruptOnAbort(signal: AbortSignal) {
  return Effect.callback<never>((resume) => {
    const abort = () => resume(Effect.interrupt)
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })
}

async function createTimeline(signal: AbortSignal) {
  const { createTimelineHost } = await import("./timeline")
  return createTimelineHost({ signal })
}

function schedule(callback: () => void, delay: number) {
  const timer = setTimeout(callback, delay)
  timer.unref()
  return () => clearTimeout(timer)
}

function withTimeout<A>(task: Promise<A>, timeout: number) {
  return new Promise<A>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out stopping startup progress")), timeout)
    timer.unref()
    const done = (callback: () => void) => {
      clearTimeout(timer)
      callback()
    }
    void task.then(
      (value) => done(() => resolve(value)),
      (error) => done(() => reject(error)),
    )
  })
}

function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}
