import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { usePlatform } from "./platform"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: (props: { url: string }) => {
    const platform = usePlatform()

    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: AbortSignal.timeout(1000 * 60 * 10),
      fetch: platform.fetch,
      throwOnError: true,
    })

    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    sdk.global.event().then(async (events) => {
      for await (const event of events.stream) {
        // console.log("event", event)
        emitter.emit(event.directory ?? "global", event.payload)
      }
    })

    return { url: props.url, client: sdk, event: emitter }
  },
})
