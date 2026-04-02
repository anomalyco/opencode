import { createSignal, createEffect, onCleanup, on } from "solid-js"
import { useSDK } from "./sdk"
import { useRoute } from "./route"
import { createSimpleContext } from "./helper"

export const { use: useStatusLine, provider: StatusLineProvider } = createSimpleContext({
  name: "StatusLine",
  init: () => {
    const sdk = useSDK()
    const route = useRoute()
    const [templates, setTemplates] = createSignal<Record<string, string>>({})
    const [frequency, setFrequency] = createSignal(10)

    let timer: Timer | undefined

    const poll = async () => {
      const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
      const result = await sdk.client.tui.statusline({ sessionID }).catch(() => undefined)
      if (!result?.data) return
      setTemplates(result.data.templates)
      setFrequency(result.data.interval)
    }

    const start = () => {
      if (timer) clearInterval(timer)
      poll()
      timer = setInterval(poll, frequency() * 1000)
    }

    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    }

    createEffect(
      on(
        () => route.data.type === "session" ? route.data.sessionID : undefined,
        () => {
          start()
        },
      ),
    )

    onCleanup(stop)

    return { templates, interval: frequency }
  },
})
