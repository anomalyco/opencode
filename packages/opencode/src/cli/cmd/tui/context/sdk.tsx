import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
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
    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: abort.signal,
      directory: props.directory,
      fetch: props.fetch,
      headers: props.headers,
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    let queue: Event[] = []
    let timer: Timer | undefined

    const STREAM_BATCH_MS = 32
    const EVENT_BATCH_MS = 12
    const MAX_QUEUE_BEFORE_FLUSH = 100

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: Event) => {
      queue.push(event)

      if (queue.length >= MAX_QUEUE_BEFORE_FLUSH) {
        if (timer) clearTimeout(timer)
        flush()
        return
      }

      if (timer) return
      const wait = event.type === "message.part.updated" ? STREAM_BATCH_MS : EVENT_BATCH_MS
      timer = setTimeout(flush, wait)
    }

    onMount(async () => {
      // If an event source is provided, use it instead of SSE
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
        return
      }

      // Fall back to SSE
      let retry = 250
      while (true) {
        if (abort.signal.aborted) break
        try {
          const events = await sdk.event.subscribe(
            {},
            {
              signal: abort.signal,
            },
          )

          retry = 250
          for await (const event of events.stream) {
            handleEvent(event)
          }

          if (!abort.signal.aborted) {
            await Bun.sleep(100)
          }
        } catch {
          if (abort.signal.aborted) break
          await Bun.sleep(retry)
          retry = Math.min(retry * 2, 2_000)
        }

        // Flush any remaining events
        if (timer) clearTimeout(timer)
        if (queue.length > 0) {
          flush()
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
