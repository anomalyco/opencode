import { Global } from "@/global"
import { createSignal, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [kvStore, setKvStore] = createStore<Record<string, any>>()
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

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return kvStore
      },
      signal<T>(name: string, defaultValue: T) {
        if (kvStore[name] === undefined) setKvStore(name, defaultValue)
        return [
          function () {
            return result.get(name)
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: any) {
        return kvStore[key] ?? defaultValue
      },
      set(key: string, value: any) {
        setKvStore(key, value)
        Bun.write(file, JSON.stringify(kvStore, null, 2))
      },
    }
    return result
  },
})
