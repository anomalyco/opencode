import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import { usePlatform } from "./platform"
import { useServer } from "./server"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const server = useServer()
    const abort = new AbortController()

    const eventSdk = createOpencodeClient({
      baseUrl: server.url,
      signal: abort.signal,
    })
    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    void (async () => {
      const events = await eventSdk.global.event()
      for await (const event of events.stream) {
        emitter.emit(event.directory ?? "global", event.payload)
      }
    })().catch(() => undefined)

    onCleanup(() => abort.abort())

    const platform = usePlatform()
    const sdk = createOpencodeClient({
      baseUrl: server.url,
      signal: AbortSignal.timeout(1000 * 60 * 10),
      fetch: platform.fetch,
      throwOnError: true,
    })

    return { url: server.url, client: sdk, event: emitter }
  },
})
