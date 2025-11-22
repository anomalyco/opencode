import { createOpencodeClient, type Event } from "@opencode-ai/sdk/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import { useGlobalSDK } from "./global-sdk"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: string }) => {
    const globalSDK = useGlobalSDK()
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: globalSDK.url,
      signal: abort.signal,
      directory: props.directory,
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    globalSDK.event.on(props.directory, async (event) => {
      emitter.emit(event.type, event)
    })

    onCleanup(() => {
      abort.abort()
    })

    return { directory: props.directory, client: sdk, event: emitter }
  },
})
