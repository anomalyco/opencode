import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string; directory?: string }) => {
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: abort.signal,
      directory: props.directory,
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    onMount(async () => {
      while (true) {
        if (abort.signal.aborted) break
        const events = await sdk.event.subscribe(
          {},
          {
            signal: abort.signal,
          },
        )
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

        for await (const event of events.stream) {
          queue.push(event)
          const elapsed = Date.now() - last

          if (timer) continue
          // If we just flushed recently (within 16ms), batch this with future events
          // Otherwise, process immediately to avoid latency
          if (elapsed < 16) {
            timer = setTimeout(flush, 16)
            continue
          }
          flush()
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
    })

    return { client: sdk, event: emitter, url: props.url }
  },
})
