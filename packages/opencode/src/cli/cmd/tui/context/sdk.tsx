import { createOpencodeClient, type Event } from "@opencode-ai/sdk"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string }) => {
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: abort.signal,
      fetch: (req) => {
        // @ts-ignore
        req.timeout = false
        return fetch(req)
      },
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    sdk.event.subscribe().then(async (events) => {
      for await (const event of events.stream) {
        console.log("event", event.type)
        emitter.emit(event.type, event)
      }
    })

    onCleanup(() => {
      abort.abort()
    })

    return { client: sdk, event: emitter }
  },
})
