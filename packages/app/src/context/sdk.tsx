import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createMemo, onCleanup } from "solid-js"
import { useGlobalSDK } from "./global-sdk"
import { usePlatform } from "./platform"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: string }) => {
    const platform = usePlatform()
    const globalSDK = useGlobalSDK()
    const sdk = createMemo(() => {
      const currentUrl = globalSDK.url
      console.log("[SDK] Creating SDK client for directory:", props.directory, "with URL:", currentUrl)
      return createOpencodeClient({
        baseUrl: currentUrl,
        fetch: platform.fetch,
        directory: props.directory,
        throwOnError: true,
      })
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    const unsub = globalSDK.event.on(props.directory, (event) => {
      emitter.emit(event.type, event)
    })
    onCleanup(unsub)

    return { 
      directory: props.directory, 
      get client() {
        return sdk()
      },
      event: emitter, 
      url: globalSDK.url 
    }
  },
})
