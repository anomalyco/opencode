import type { Projection } from "./markdown-stream"
import {
  INITIAL_MARKDOWN_WORKER_STATE,
  transitionMarkdownWorker,
  type MarkdownWorkerEffect,
  type MarkdownWorkerEvent,
  type WorkerRejectReason,
} from "./markdown-worker-machine"
import type { MarkdownWorkerRequest, MarkdownWorkerResponse, MarkdownWorkerState } from "./markdown-worker-protocol"

export class MarkdownWorkerDisposedError extends Error {}

// Made once: disposal rejects from inside a Solid cleanup, and a new error there would record that stack and keep the
// whole disposing batch alive for as long as the rejected promise is reachable.
export const markdownWorkerDisposed = new MarkdownWorkerDisposedError()

export class MarkdownWorkerSupersededError extends Error {}

// Made once: streaming supersedes a queued snapshot on almost every delta, and each new error would capture a stack.
export const markdownWorkerSuperseded = new MarkdownWorkerSupersededError()

export class MarkdownWorkerUnavailableError extends Error {}

type Settle<T> = { readonly resolve: (value: T) => void; readonly reject: (error: Error) => void }

type Resolver =
  | (Settle<string> & { readonly kind: "parse" })
  | (Settle<Projection> & { readonly kind: "project" })
  | (Settle<MarkdownWorkerState> & { readonly kind: "highlight" })

/** The part of a `Worker` the client uses. */
export type MarkdownWorkerPort = {
  onmessage: ((event: MessageEvent<MarkdownWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: MarkdownWorkerRequest): void
  terminate(): void
}

type Run = { readonly worker: MarkdownWorkerPort; watchdog: ReturnType<typeof setTimeout> | undefined }

/** Runs the markdown worker machine: spawns workers, posts requests and settles each caller's promise. */
export function createMarkdownWorkerClient(spawn: () => MarkdownWorkerPort) {
  let state = INITIAL_MARKDOWN_WORKER_STATE
  const queue: MarkdownWorkerEvent[] = []
  const resolvers = new Map<number, Resolver>()
  const runs = new Map<number, Run>()

  const dispatch = (event: MarkdownWorkerEvent) => {
    queue.push(event)

    // An effect can dispatch while effects run (a worker that fails to construct); the outer loop drains it next.
    if (queue.length > 1) return

    while (queue.length > 0) {
      try {
        const next = transitionMarkdownWorker(state, queue[0]!)
        state = next.state
        next.effects.forEach(run)
      } catch (error) {
        console.error("Markdown worker transition failed", error)
      } finally {
        queue.shift()
      }
    }
  }

  // Every request takes the next id in every state, so its resolver is in place before any effect can settle it.
  const request = (event: MarkdownWorkerEvent, resolver: Resolver) => {
    resolvers.set(state.issued + 1, resolver)
    dispatch(event)
  }

  const run = (effect: MarkdownWorkerEffect) => {
    try {
      perform(effect)
    } catch (error) {
      console.error("Markdown worker effect failed", error)
    }
  }

  const perform = (effect: MarkdownWorkerEffect) => {
    if (effect.type === "spawn-worker") return start(effect.attempt)

    if (effect.type === "close-worker") {
      const current = runs.get(effect.attempt)

      if (!current) return
      runs.delete(effect.attempt)
      clearTimeout(current.watchdog)
      current.worker.onmessage = null
      current.worker.onerror = null
      current.worker.onmessageerror = null
      current.worker.terminate()

      return
    }

    if (effect.type === "post") return runs.get(effect.attempt)?.worker.postMessage(effect.message)

    if (effect.type === "arm-watchdog") {
      const current = runs.get(effect.attempt)

      if (!current) return
      clearTimeout(current.watchdog)
      current.watchdog = setTimeout(() => dispatch({ type: "watchdog.fired", attempt: effect.attempt }), effect.delay)

      return
    }

    if (effect.type === "schedule-retry") {
      setTimeout(() => dispatch({ type: "retry.ready", attempt: effect.attempt }), effect.delay)

      return
    }

    if (effect.type === "reject") {
      const error = rejection(effect.reason)

      return effect.ids.forEach((id) => {
        const resolver = resolvers.get(id)
        resolvers.delete(id)
        resolver?.reject(error)
      })
    }

    const resolver = resolvers.get(effect.id)
    resolvers.delete(effect.id)

    if (effect.type === "resolve-parse" && resolver?.kind === "parse") return resolver.resolve(effect.html)

    if (effect.type === "resolve-project" && resolver?.kind === "project") return resolver.resolve(effect.projection)

    if (effect.type === "resolve-highlight" && resolver?.kind === "highlight") return resolver.resolve(effect.value)
  }

  const start = (attempt: number) => {
    let worker: MarkdownWorkerPort

    try {
      worker = spawn()
    } catch (error) {
      dispatch({
        type: "worker.spawn-failed",
        attempt,
        message: error instanceof Error ? error.message : String(error),
      })

      return
    }

    runs.set(attempt, { worker, watchdog: undefined })
    worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) =>
      dispatch({ type: "worker.message", attempt, response: event.data })
    worker.onerror = (event) =>
      dispatch({ type: "worker.crashed", attempt, message: event.message || "Markdown highlighting worker failed" })
    worker.onmessageerror = () =>
      dispatch({ type: "worker.crashed", attempt, message: "Markdown worker response failed" })
  }

  return {
    parseMarkdown(text: string, signal: AbortSignal) {
      if (signal.aborted) return Promise.reject(markdownWorkerDisposed)
      const id = state.issued + 1
      const abort = () => dispatch({ type: "parse.aborted", id })

      return new Promise<string>((resolve, reject) => {
        signal.addEventListener("abort", abort, { once: true })
        request(
          { type: "parse.requested", text },
          {
            kind: "parse",
            resolve: (html) => {
              signal.removeEventListener("abort", abort)
              resolve(html)
            },
            reject: (error) => {
              signal.removeEventListener("abort", abort)
              reject(error)
            },
          },
        )
      })
    },

    projectMarkdown(key: string, text: string, live: boolean) {
      return new Promise<Projection>((resolve, reject) =>
        request({ type: "project.requested", key, text, live }, { kind: "project", resolve, reject }),
      )
    },

    disposeMarkdownProjection(key: string) {
      dispatch({ type: "project.disposed", key })
    },

    highlightStreamingCode(key: string, text: string, language: string, complete = false) {
      return new Promise<MarkdownWorkerState>((resolve, reject) =>
        request({ type: "highlight.requested", key, text, language, complete }, { kind: "highlight", resolve, reject }),
      )
    },

    disposeStreamingCode(key: string) {
      dispatch({ type: "highlight.disposed", key })
    },
  }
}

function rejection(reason: WorkerRejectReason) {
  if (reason.kind === "disposed") return markdownWorkerDisposed

  if (reason.kind === "superseded") return markdownWorkerSuperseded

  if (reason.kind === "unavailable") return new MarkdownWorkerUnavailableError(reason.message)

  return new Error(reason.message)
}

const client = createMarkdownWorkerClient(
  () => new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" }),
)

export const parseMarkdown = client.parseMarkdown

export const projectMarkdown = client.projectMarkdown

export const disposeMarkdownProjection = client.disposeMarkdownProjection

export const highlightStreamingCode = client.highlightStreamingCode

export const disposeStreamingCode = client.disposeStreamingCode
