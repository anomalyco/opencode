import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export type EventStreamLoop = {
  readonly signals: readonly [AbortSignal, AbortSignal]
  readonly connect: (signal: AbortSignal) => Promise<AsyncIterable<GlobalEvent>>
  readonly event: (event: GlobalEvent) => void
  readonly flush: () => void
  readonly wait: (delay: number, signal: AbortSignal) => Promise<void>
  readonly retry: (entry: { readonly attempt: number; readonly error: unknown }) => void
}

const retryDelay = 1000
const maxRetryDelay = 30000

export async function runEventStream(input: EventStreamLoop) {
  const signal = AbortSignal.any([...input.signals])
  let attempt = 0
  while (!signal.aborted) {
    let error: unknown = new Error("event stream completed")
    try {
      const stream = await input.connect(signal)
      for await (const event of stream) {
        if (signal.aborted) return
        input.event(event)
        if (event.payload.type === "server.connected") attempt = 0
      }
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error("event stream failed", { cause })
    }
    try {
      input.flush()
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error("event stream flush failed", { cause })
    }
    if (signal.aborted) return

    attempt++
    try {
      await input.wait(Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay), signal)
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error("event stream retry wait failed", { cause })
    }
    if (signal.aborted) return
    try {
      input.retry({ attempt, error })
    } catch {
      continue
    }
  }
}

function waitForRetry(delay: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const abort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, delay)
    signal.addEventListener("abort", abort, { once: true })
  })
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (queue.length === 0) return
      const events = queue
      queue = []
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      const task = runEventStream({
        signals: [abort.signal, ctrl.signal],
        connect: async (signal) => {
          const events = await sdk.global.event({
            signal,
            sseMaxRetryAttempts: 0,
          })

          if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
            // Start syncing workspaces, it's important to do this after
            // we've started listening to events
            await sdk.sync.start().catch(() => {})
          }
          return events.stream
        },
        event: handleEvent,
        flush,
        wait: waitForRetry,
        retry: ({ attempt, error }) =>
          console.warn("[tui.sdk] event stream disconnected, retrying", { attempt, error }),
      })
      void task.catch((error) => {
        if (abort.signal.aborted || ctrl.signal.aborted) return
        console.error("[tui.sdk] event stream stopped unexpectedly", { error })
        startSSE()
      })
    }

    onMount(() => {
      if (props.events) {
        let disposed = false
        let unsubscribe: (() => void) | undefined
        onCleanup(() => {
          disposed = true
          unsubscribe?.()
        })
        void props.events
          .subscribe(handleEvent)
          .then((cleanup) => {
            if (disposed) return cleanup()
            unsubscribe = cleanup
            if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
              void sdk.sync.start().catch((error) => {
                if (!disposed) console.error("[tui.sdk] workspace sync failed", { error })
              })
            }
          })
          .catch((error) => {
            if (!disposed) console.error("[tui.sdk] injected event source failed", { error })
          })
        return
      }
      startSSE()
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
