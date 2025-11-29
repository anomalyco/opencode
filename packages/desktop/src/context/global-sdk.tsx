import { createOpencodeClient, type Event } from "@opencode-ai/sdk/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: (props: { url: string }) => {
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: abort.signal,
    })

    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    sdk.global.event().then(async (events) => {
      for await (const event of events.stream) {
        // console.log("event", event)
        emitter.emit(event.directory, event.payload)
      }
    })

    onCleanup(() => {
      abort.abort()
    })

    return { url: props.url, client: sdk, event: emitter }
  },
})
