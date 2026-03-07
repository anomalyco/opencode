import { createStore } from "solid-js/store"
import { batch, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { useModels } from "@/context/models"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./model-variant"

export type ModelKey = { providerID: string; modelID: string }

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()
    const connected = createMemo(() => new Set(providers.connected().map((provider) => provider.id)))

    function isModelValid(model: ModelKey) {
      const provider = providers.all().find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID] && connected().has(model.providerID)
    }

    function getFirstValidModel(...modelFns: (() => ModelKey | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    let setModel: (model: ModelKey | undefined, options?: { recent?: boolean }) => void = () => undefined

    const agent = (() => {
      const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const models = useModels()

      const [store, setStore] = createStore<{
        current?: string
      }>({
        current: list()[0]?.name,
      })
      return {
        list,
        current() {
          const available = list()
          if (available.length === 0) return undefined
          return available.find((x) => x.name === store.current) ?? available[0]
        },
        set(name: string | undefined) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          const match = name ? available.find((x) => x.name === name) : undefined
          const value = match ?? available[0]
          if (!value) return
          setStore("current", value.name)
          if (!value.model) return
          setModel({
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          })
          if (value.variant)
            models.variant.set({ providerID: value.model.providerID, modelID: value.model.modelID }, value.variant)
        },
        move(direction: 1 | -1) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          let next = available.findIndex((x) => x.name === store.current) + direction
          if (next < 0) next = available.length - 1
          if (next >= available.length) next = 0
          const value = available[next]
          if (!value) return
          setStore("current", value.name)
          if (!value.model) return
          setModel({
            providerID: value.model.providerID,
            modelID: value.model.modelID,
          })
          if (value.variant)
            models.variant.set({ providerID: value.model.providerID, modelID: value.model.modelID }, value.variant)
        },
      }
    })()

    const model = (() => {
      const models = useModels()

      const [ephemeral, setEphemeral] = createStore<{
        model: Record<string, ModelKey | undefined>
      }>({
        model: {},
      })

      const resolveConfigured = () => {
        if (!sync.data.config.model) return
        const [providerID, modelID] = sync.data.config.model.split("/")
        const key = { providerID, modelID }
        if (isModelValid(key)) return key
      }

      const resolveRecent = () => {
        for (const item of models.recent.list()) {
          if (isModelValid(item)) return item
        }
      }

      const resolveDefault = () => {
        const defaults = providers.default()
        for (const provider of providers.connected()) {
          const configured = defaults[provider.id]
          if (configured) {
            const key = { providerID: provider.id, modelID: configured }
            if (isModelValid(key)) return key
          }

          const first = Object.values(provider.models)[0]
          if (!first) continue
          const key = { providerID: provider.id, modelID: first.id }
          if (isModelValid(key)) return key
        }
      }

      const fallbackModel = createMemo<ModelKey | undefined>(() => {
        return resolveConfigured() ?? resolveRecent() ?? resolveDefault()
      })

      const current = createMemo(() => {
        const a = agent.current()
        if (!a) return undefined
        const key = getFirstValidModel(
          () => ephemeral.model[a.name],
          () => a.model,
          fallbackModel,
        )
        if (!key) return undefined
        return models.find(key)
      })

      const favorite = createMemo(() =>
        models.favorite
          .list()
          .map(models.find)
          .filter((item): item is NonNullable<typeof item> => !!item),
      )

      const recent = createMemo(() =>
        models.recent
          .list()
          .map(models.find)
          .filter((item): item is NonNullable<typeof item> => !!item),
      )

      const quick = createMemo(() =>
        models.quick
          .list()
          .map(models.find)
          .filter((item): item is NonNullable<typeof item> => !!item)
          .filter((item) => models.visible({ providerID: item.provider.id, modelID: item.id })),
      )

      const cycle = (direction: 1 | -1) => {
        const recentList = recent()
        const currentModel = current()
        if (!currentModel) return

        const index = recentList.findIndex(
          (x) => x?.provider.id === currentModel.provider.id && x?.id === currentModel.id,
        )
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = recentList.length - 1
        if (next >= recentList.length) next = 0

        const val = recentList[next]
        if (!val) return

        model.set({
          providerID: val.provider.id,
          modelID: val.id,
        })
      }

      const set = (model: ModelKey | undefined, options?: { recent?: boolean }) => {
        batch(() => {
          const currentAgent = agent.current()
          const next = model ?? fallbackModel()
          if (currentAgent) setEphemeral("model", currentAgent.name, next)
          if (model) models.setVisibility(model, true)
          if (options?.recent && model) models.recent.push(model)
        })
      }

      setModel = set

      const cycleFavorite = (direction: 1 | -1) => {
        const list = favorite()
        if (list.length === 0) return
        const curr = current()
        let index = -1

        if (curr) {
          index = list.findIndex((item) => item.provider.id === curr.provider.id && item.id === curr.id)
        }

        if (index === -1) index = direction === 1 ? 0 : list.length - 1
        else index = (index + direction + list.length) % list.length

        const item = list[index]
        if (!item) return
        set(
          {
            providerID: item.provider.id,
            modelID: item.id,
          },
          { recent: true },
        )
      }

      const cycleQuick = (direction: 1 | -1) => {
        const list = quick()
        if (list.length < 2) return
        const curr = current()
        const index = curr ? list.findIndex((item) => item.provider.id === curr.provider.id && item.id === curr.id) : -1
        const next =
          index === -1 ? (direction === 1 ? 0 : list.length - 1) : (index + direction + list.length) % list.length
        const item = list[next]
        if (!item) return
        set(
          {
            providerID: item.provider.id,
            modelID: item.id,
          },
          { recent: true },
        )
      }

      return {
        ready: models.ready,
        current,
        favorite,
        recent,
        list: models.list,
        cycle,
        cycleFavorite,
        quick: {
          list: quick,
          get: models.quick.get,
          set: models.quick.set,
          cycle: cycleQuick,
        },
        set,
        isFavorite(model: ModelKey) {
          return models.favorite.has(model)
        },
        toggleFavorite(model: ModelKey) {
          models.favorite.toggle(model)
        },
        visible(model: ModelKey) {
          return models.visible(model)
        },
        setVisibility(model: ModelKey, visible: boolean) {
          models.setVisibility(model, visible)
        },
        variant: {
          configured() {
            const a = agent.current()
            const m = current()
            if (!a || !m) return undefined
            return getConfiguredAgentVariant({
              agent: { model: a.model, variant: a.variant },
              model: { providerID: m.provider.id, modelID: m.id, variants: m.variants },
            })
          },
          selected() {
            const m = current()
            if (!m) return undefined
            return models.variant.get({ providerID: m.provider.id, modelID: m.id })
          },
          current() {
            return resolveModelVariant({
              variants: this.list(),
              selected: this.selected(),
              configured: this.configured(),
            })
          },
          list() {
            const m = current()
            if (!m) return []
            if (!m.variants) return []
            return Object.keys(m.variants)
          },
          set(value: string | undefined) {
            const m = current()
            if (!m) return
            models.variant.set({ providerID: m.provider.id, modelID: m.id }, value)
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            this.set(
              cycleModelVariant({
                variants,
                selected: this.selected(),
                configured: this.configured(),
              }),
            )
          },
        },
      }
    })()

    const result = {
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
    }
    return result
  },
})
