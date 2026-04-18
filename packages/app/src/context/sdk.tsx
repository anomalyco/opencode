import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { domainFromDirectory } from "@/pages/layout/extra-agents"
import { useGlobalSDK } from "./global-sdk"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: string }) => {
    const globalSDK = useGlobalSDK()

    const directory = createMemo(props.directory)
    const domain = createMemo(() => domainFromDirectory(directory()))
    const client = createMemo(() =>
      globalSDK.forDomain(domain()).createClient({
        directory: directory(),
        throwOnError: true,
      }),
    )

    const emitter = createGlobalEmitter<SDKEventMap>()

    createEffect(() => {
      const dir = directory()
      const unsub = globalSDK.eventFor(domainFromDirectory(dir)).on(dir, (event) => {
        emitter.emit(event.type, event)
      })
      onCleanup(unsub)
    })

    return {
      get directory() {
        return directory()
      },
      get client() {
        return client()
      },
      event: emitter,
      get url() {
        return globalSDK.forDomain(domain()).url
      },
      createClient(opts: Parameters<typeof globalSDK.createClient>[0]) {
        return globalSDK.forDomain(domain()).createClient(opts)
      },
    }
  },
})
