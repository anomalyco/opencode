import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { useGlobalSDK } from "./global-sdk"
import { usePlatform } from "./platform"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: string }) => {
    const platform = usePlatform()
    const globalSDK = useGlobalSDK()
    const sdk = createOpencodeClient({
      baseUrl: globalSDK.url,
      signal: AbortSignal.timeout(1000 * 60 * 10),
      fetch: platform.fetch,
      directory: props.directory,
      throwOnError: true,
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    globalSDK.event.on(props.directory, async (event) => {
      emitter.emit(event.type, event)
    })

    return { directory: props.directory, client: sdk, event: emitter, url: globalSDK.url }
  },
})
