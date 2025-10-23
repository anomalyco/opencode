import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { Theme } from "@tui/context/theme"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@/global"
import { iife } from "@/util/iife"
import { createSimpleContext } from "./helper"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()

    const agent = iife(() => {
      const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent"))
      const [store, setStore] = createStore<{
        current: string
      }>({
        current: agents()[0].name,
      })
      return {
        list() {
          return agents()
        },
        current() {
          return agents().find((x) => x.name === store.current)!
        },
        set(name: string) {
          setStore("current", name)
        },
        move(direction: 1 | -1) {
          let next = agents().findIndex((x) => x.name === store.current) + direction
          if (next < 0) next = agents().length - 1
          if (next >= agents().length) next = 0
          const value = agents()[next]
          setStore("current", value.name)
          if (value.model)
            model.set({
              providerID: value.model.providerID,
              modelID: value.model.modelID,
            })
        },
        color(name: string) {
          const index = agents().findIndex((x) => x.name === name)
          const colors = [Theme.secondary, Theme.accent, Theme.success, Theme.warning, Theme.primary, Theme.error]
          return colors[index % colors.length]
        },
      }
    })

    const model = iife(() => {
      const [store, setStore] = createStore<{
        ready: boolean
        model: Record<
          string,
          {
            providerID: string
            modelID: string
          }
        >
        recent: {
          providerID: string
          modelID: string
        }[]
      }>({
        ready: false,
        model: {},
        recent: [],
      })

      const file = Bun.file(path.join(Global.Path.state, "model.json"))

      file
        .json()
        .then((x) => {
          setStore("recent", x.recent)
        })
        .catch(() => {})
        .finally(() => {
          setStore("ready", true)
        })

      createEffect(() => {
        Bun.write(
          file,
          JSON.stringify({
            recent: store.recent,
          }),
        )
      })

      const fallback = createMemo(() => {
        function isValid(providerID: string, modelID: string) {
          const provider = sync.data.provider.find((x) => x.id === providerID)
          if (!provider) return false
          const model = provider.models[modelID]
          if (!model) return false
          return true
        }

        if (sync.data.config.model) {
          const [providerID, modelID] = sync.data.config.model.split("/")
          if (isValid(providerID, modelID)) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of store.recent) {
          if (isValid(item.providerID, item.modelID)) {
            return item
          }
        }
        const provider = sync.data.provider[0]
        const model = Object.values(provider.models)[0]
        return {
          providerID: provider.id,
          modelID: model.id,
        }
      })

      const current = createMemo(() => {
        const a = agent.current()
        return store.model[agent.current().name] ?? (a.model ? a.model : fallback())
      })

      return {
        current,
        get ready() {
          return store.ready
        },
        recent() {
          return store.recent
        },
        parsed: createMemo(() => {
          const value = current()
          const provider = sync.data.provider.find((x) => x.id === value.providerID)!
          const model = provider.models[value.modelID]
          return {
            provider: provider.name ?? value.providerID,
            model: model.name ?? value.modelID,
          }
        }),
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            setStore("model", agent.current().name, model)
            if (options?.recent) {
              const uniq = uniqueBy([model, ...store.recent], (x) => x.providerID + x.modelID)
              if (uniq.length > 5) uniq.pop()
              setStore("recent", uniq)
            }
          })
        },
      }
    })

    const kv = iife(() => {
      const [ready, setReady] = createSignal(false)
      const [store, setStore] = createStore({
        openrouter_warning: false,
      })
      const file = Bun.file(path.join(Global.Path.state, "kv.json"))

      file
        .json()
        .then((x) => {
          setStore(x)
        })
        .catch(() => {})
        .finally(() => {
          setReady(true)
        })

      return {
        get data() {
          return store
        },
        get ready() {
          return ready()
        },
        set(key: string, value: any) {
          setStore(key as any, value)
          Bun.write(
            file,
            JSON.stringify({
              [key]: value,
            }),
          )
        },
      }
    })

    const result = {
      model,
      agent,
      kv,
      get ready() {
        return kv.ready && model.ready
      },
    }
    return result
  },
})
