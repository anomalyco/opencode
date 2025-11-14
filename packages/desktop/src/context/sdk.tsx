import { createOpencodeClient, type Event } from "@opencode-ai/sdk/client"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string; directory?: string }) => {
    const abort = new AbortController()
    const sdk = createOpencodeClient(
      {
        baseUrl: props.url,
        signal: abort.signal,
      },
      { directory: props.directory },
    )

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

    return { url: props.url, directory: props.directory, client: sdk, event: emitter }
  },
})
