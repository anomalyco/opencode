import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
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
    const retryDelay = 1000
    const maxRetryDelay = 30000

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
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

    const parseSseStatus = (error: unknown): string | undefined => {
      if (error instanceof Error) {
        const match = /SSE failed:\s*(\d{3})/.exec(error.message)
        if (match?.[1]) return match[1]
      }
      if (typeof error === "object" && error !== null && "status" in error) {
        const status = (error as { status?: unknown }).status
        if (typeof status === "number") return String(status)
      }
      return undefined
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          let sseError: unknown
          let received = false
          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              sseMaxRetryAttempts: 0,
              onSseError: (error) => {
                sseError = error
              },
            })

            if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
              // Start syncing workspaces, it's important to do this after
              // we've started listening to events
              await sdk.sync.start().catch(() => {})
            }

            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              received = true
              handleEvent(event)
            }
          } catch (error) {
            // A rejection before `onSseError` fires must still reach the retry path
            // instead of escaping to the outer catch and deafening the TUI.
            sseError = error
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // A run that produced events resets the backoff; only consecutive failures
          // escalate it, so hours of health cannot pin the delay at the cap.
          attempt = received ? 1 : attempt + 1
          const status = parseSseStatus(sseError)
          if (status) console.error(`[tui] global event stream failed with HTTP ${status}; retrying`)

          // Retry every status (including auth) with backoff: a transient token refresh
          // must not permanently deafen the TUI, and a fixed credential recovers it.
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        // Register the cleanup before the awaiting subscribe so an unmount that
        // races the subscribe still tears the handler down.
        let unsubscribe: (() => void) | undefined
        let disposed = false
        onCleanup(() => {
          disposed = true
          unsubscribe?.()
        })
        const unsub = await props.events.subscribe(handleEvent)
        if (disposed) {
          unsub()
          return
        }
        unsubscribe = unsub

        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          await sdk.sync.start().catch(() => {})
        }
      } else {
        startSSE()
      }
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
