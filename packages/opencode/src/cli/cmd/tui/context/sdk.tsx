import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string; directory?: string; fetch?: typeof fetch; events?: EventSource }) => {
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: abort.signal,
      directory: props.directory,
      fetch: props.fetch,
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    let queue: Event[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: Event) => {
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

    onMount(async () => {
      // If an event source is provided, use it instead of SSE
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
        return
      }

      // Fall back to SSE with retry backoff
      let retryDelay = 1000 // Start with 1 second
      const maxRetryDelay = 30000 // Max 30 seconds
      let consecutiveFailures = 0
      const maxConsecutiveFailures = 10 // Give up after 10 consecutive failures

      while (true) {
        if (abort.signal.aborted) break

        try {
          const events = await sdk.event.subscribe(
            {},
            {
              signal: abort.signal,
            },
          )

          // Reset retry state on successful connection
          retryDelay = 1000
          consecutiveFailures = 0

          for await (const event of events.stream) {
            handleEvent(event)
          }
        } catch (e) {
          if (abort.signal.aborted) break

          consecutiveFailures++
          if (consecutiveFailures >= maxConsecutiveFailures) {
            // Server seems permanently gone, exit the loop
            console.error(
              `[sdk] Failed to connect after ${maxConsecutiveFailures} attempts, giving up. Server may have shut down.`,
            )
            break
          }

          // Exponential backoff with jitter
          const jitter = Math.random() * 500
          await new Promise((resolve) => setTimeout(resolve, retryDelay + jitter))
          retryDelay = Math.min(retryDelay * 2, maxRetryDelay)
        }
      }
    })

    onCleanup(() => {
      abort.abort()
      if (timer) clearTimeout(timer)
    })

    return { client: sdk, event: emitter, url: props.url }
  },
})
