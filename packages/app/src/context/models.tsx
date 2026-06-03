import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { DateTime } from "luxon"
import { filter, firstBy, flat, groupBy, mapValues, pipe, uniqueBy, values } from "remeda"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { useProviders } from "@/hooks/use-providers"
import { Persist, removePersisted } from "@/utils/persist"
import { usePlatform } from "./platform"
import { useServerSDK } from "./server-sdk"

export type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"
type User = ModelKey & { visibility: Visibility; favorite?: boolean }
type Store = {
  user: User[]
  recent: ModelKey[]
  variant?: Record<string, string | undefined>
}

const RECENT_LIMIT = 5

function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

export const { use: useModels, provider: ModelsProvider } = createSimpleContext({
  name: "Models",
  init: () => {
    const providers = useProviders()
    const serverSDK = useServerSDK()
    const platform = usePlatform()
    const queryClient = useQueryClient()

    const [store, setStore] = createStore<Store>({
      user: [],
      recent: [],
      variant: {},
    })
    const queryKey = () => ["ui", "settings", "models", serverSDK.url] as const

    const query = useQuery(() => ({
      queryKey: queryKey(),
      queryFn: () => serverSDK.client.ui.settings.get().then((x) => x.data?.model ?? { user: [], recent: [], variant: {} }),
    }))

    const applyServerModel = (model: Store | undefined) => {
      if (!model) return
      queryClient.setQueryData<Store>(queryKey(), model)
      setStore(reconcile(model))
    }

    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: queryKey() })
    }

    const visibilityMutation = useMutation(() => ({
      mutationFn: (input: { model: ModelKey; visibility: Visibility }) =>
        serverSDK.client.ui.settings.models.update({
          providerID: input.model.providerID,
          modelID: input.model.modelID,
          uiSettingsModelPreferenceInput: { visibility: input.visibility },
        }),
      onSuccess: (result) => applyServerModel(result.data?.model),
      onError: refetch,
    }))

    const recentMutation = useMutation(() => ({
      mutationFn: () => serverSDK.client.ui.settings.models.recent.replace({ uiSettingsRecentModelsInput: { models: store.recent } }),
      onSuccess: (result) => applyServerModel(result.data?.model),
      onError: refetch,
    }))

    const variantMutation = useMutation(() => ({
      mutationFn: (input: { model: ModelKey; variant: string | undefined }) =>
        serverSDK.client.ui.settings.models.variant.update({
          providerID: input.model.providerID,
          modelID: input.model.modelID,
          uiSettingsModelVariantInput: { variant: input.variant },
        }),
      onSuccess: (result) => applyServerModel(result.data?.model),
      onError: refetch,
    }))

    let cleanedLegacy = false
    createEffect(() => {
      applyServerModel(query.data)
      if (!query.data || cleanedLegacy) return
      cleanedLegacy = true
      removePersisted(Persist.global("model", ["model.v1"]), platform)
    })

    const unsub = serverSDK.event.on("global", (event) => {
      if (event.type !== "ui.settings.updated") return
      if (event.properties.profileID !== "default") return
      refetch()
    })
    onCleanup(unsub)

    const available = createMemo(() =>
      providers.connected().flatMap((p) =>
        Object.values(p.models).map((m) => ({
          ...m,
          provider: p,
        })),
      ),
    )

    const release = createMemo(
      () =>
        new Map(
          available().map((model) => {
            const parsed = DateTime.fromISO(model.release_date)
            return [modelKey({ providerID: model.provider.id, modelID: model.id }), parsed] as const
          }),
        ),
    )

    const latest = createMemo(() =>
      pipe(
        available(),
        filter(
          (x) =>
            Math.abs(
              (release().get(modelKey({ providerID: x.provider.id, modelID: x.id })) ?? DateTime.invalid("invalid"))
                .diffNow()
                .as("months"),
            ) < 6,
        ),
        groupBy((x) => x.provider.id),
        mapValues((models) =>
          pipe(
            models,
            groupBy((x) => x.family),
            values(),
            (groups) =>
              groups.flatMap((g) => {
                const first = firstBy(g, [(x) => x.release_date, "desc"])
                return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
              }),
          ),
        ),
        values(),
        flat(),
      ),
    )

    const latestSet = createMemo(() => new Set(latest().map((x) => modelKey(x))))

    const visibility = createMemo(() => {
      const map = new Map<string, Visibility>()
      for (const item of store.user) map.set(`${item.providerID}:${item.modelID}`, item.visibility)
      return map
    })

    const list = createMemo(() =>
      available().map((m) => ({
        ...m,
        name: m.name.replace("(latest)", "").trim(),
        latest: m.name.includes("(latest)"),
      })),
    )

    const find = (key: ModelKey) => list().find((m) => m.id === key.modelID && m.provider.id === key.providerID)

    function update(model: ModelKey, state: Visibility) {
      const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
      if (index >= 0) {
        setStore("user", index, (current) => ({ ...current, visibility: state }))
        return
      }
      setStore("user", store.user.length, { ...model, visibility: state })
    }

    const visible = (model: ModelKey) => {
      const key = modelKey(model)
      const state = visibility().get(key)
      if (state === "hide") return false
      if (state === "show") return true
      if (latestSet().has(key)) return true
      const date = release().get(key)
      if (!date?.isValid) return true
      return false
    }

    const setVisibility = (model: ModelKey, state: boolean) => {
      const visibility = state ? "show" : "hide"
      update(model, visibility)
      visibilityMutation.mutate({ model, visibility })
    }

    const push = (model: ModelKey) => {
      const uniq = uniqueBy([model, ...store.recent], (x) => `${x.providerID}:${x.modelID}`)
      if (uniq.length > RECENT_LIMIT) uniq.pop()
      setStore("recent", uniq)
      recentMutation.mutate()
    }

    const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
    const getVariant = (model: ModelKey) => store.variant?.[variantKey(model)]

    const setVariant = (model: ModelKey, value: string | undefined) => {
      const key = variantKey(model)
      if (!store.variant) {
        setStore("variant", { [key]: value })
        variantMutation.mutate({ model, variant: value })
        return
      }
      setStore("variant", key, value)
      variantMutation.mutate({ model, variant: value })
    }

    return {
      ready: createMemo(() => !query.isLoading),
      list,
      find,
      visible,
      setVisibility,
      recent: {
        list: createMemo(() => store.recent),
        push,
      },
      variant: {
        get: getVariant,
        set: setVariant,
      },
    }
  },
})
