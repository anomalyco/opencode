import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@/global"
import { iife } from "@/util/iife"
import { createSimpleContext } from "./helper"
import { useToast } from "../ui/toast"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: (props: { initialModel?: string; initialAgent?: string }) => {
    const sync = useSync()
    const toast = useToast()

    function isModelValid(model: { providerID: string; modelID: string }) {
      const provider = sync.data.provider.find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID]
    }

    function getFirstValidModel(
      ...modelFns: (() => { providerID: string; modelID: string } | undefined)[]
    ) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    // Set initial model if provided
    onMount(() => {
      batch(() => {
        if (props.initialAgent) {
          agent.set(props.initialAgent)
        }
        if (props.initialModel) {
          const [providerID, modelID] = props.initialModel.split("/")
          if (!providerID || !modelID)
            return toast.show({
              variant: "warning",
              message: `Invalid model format: ${props.initialModel}`,
              duration: 3000,
            })
          model.set({ providerID, modelID }, { recent: true })
        }
      })
    })

    // Automatically update model when agent changes
    createEffect(() => {
      const value = agent.current()
      if (value.model) {
        if (isModelValid(value.model))
          model.set({
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          })
        else
          toast.show({
            variant: "warning",
            message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
            duration: 3000,
          })
      }
    })

    const agent = iife(() => {
      const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent"))
      const [agentStore, setAgentStore] = createStore<{
        current: string
      }>({
        current: agents()[0].name,
      })
      const { theme } = useTheme()
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
      ])
      return {
        list() {
          return agents()
        },
        current() {
          return agents().find((x) => x.name === agentStore.current)!
        },
        set(name: string) {
          if (!agents().some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            let next = agents().findIndex((x) => x.name === agentStore.current) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const index = agents().findIndex((x) => x.name === name)
          return colors()[index % colors().length]
        },
      }
    })

    const model = iife(() => {
      const [modelStore, setModelStore] = createStore<{
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
          setModelStore("recent", x.recent)
        })
        .catch(() => {})
        .finally(() => {
          setModelStore("ready", true)
        })

      createEffect(() => {
        Bun.write(
          file,
          JSON.stringify({
            recent: modelStore.recent,
          }),
        )
      })

      const fallbackModel = createMemo(() => {
        if (sync.data.config.model) {
          const [providerID, modelID] = sync.data.config.model.split("/")
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of modelStore.recent) {
          if (isModelValid(item)) {
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

      const currentModel = createMemo(() => {
        const a = agent.current()
        return getFirstValidModel(
          () => modelStore.model[a.name],
          () => a.model,
          fallbackModel,
        )!
      })

      return {
        current: currentModel,
        get ready() {
          return modelStore.ready
        },
        recent() {
          return modelStore.recent
        },
        parsed: createMemo(() => {
          const value = currentModel()
          const provider = sync.data.provider.find((x) => x.id === value.providerID)!
          const model = provider.models[value.modelID]
          return {
            provider: provider.name ?? value.providerID,
            model: model.name ?? value.modelID,
          }
        }),
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }

            setModelStore("model", agent.current().name, model)
            if (options?.recent) {
              const uniq = uniqueBy([model, ...modelStore.recent], (x) => x.providerID + x.modelID)
              if (uniq.length > 5) uniq.pop()
              setModelStore("recent", uniq)
            }
          })
        },
      }
    })

    const result = {
      model,
      agent,
    }
    return result
  },
})
