import { Global } from "@/global"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [kvStore, setKvStore] = createStore({
      openrouter_warning: false,
      theme: "opencode",
    })
    const file = Bun.file(path.join(Global.Path.state, "kv.json"))

    file
      .json()
      .then((x) => {
        setKvStore(x)
      })
      .catch(() => {})
      .finally(() => {
        setReady(true)
      })

    return {
      get data() {
        return kvStore
      },
      get ready() {
        return ready()
      },
      set(key: string, value: any) {
        setKvStore(key as any, value)
        Bun.write(
          file,
          JSON.stringify({
            [key]: value,
          }),
        )
      },
    }
  },
})
