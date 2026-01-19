import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js"
import { useGlobalSDK } from "./global-sdk"
import { usePlatform } from "./platform"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: Accessor<string> }) => {
    const platform = usePlatform()
    const globalSDK = useGlobalSDK()

    const client = createMemo(() =>
      createOpencodeClient({
        baseUrl: globalSDK.url,
        fetch: platform.fetch,
        directory: props.directory(),
        throwOnError: true,
      }),
    )

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    let unsub: VoidFunction | undefined
    createEffect(
      on(props.directory, (directory) => {
        unsub?.()
        unsub = globalSDK.event.on(directory, (event) => {
          emitter.emit(event.type, event)
        })
      }),
    )
    onCleanup(() => unsub?.())

    return {
      get directory() {
        return props.directory()
      },
      get client() {
        return client()
      },
      event: emitter,
      url: globalSDK.url,
    }
  },
})
