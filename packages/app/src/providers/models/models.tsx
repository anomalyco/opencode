import { type Accessor, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { useProviders } from "@/providers/catalog/providers"
import { useGlobal } from "@/runtime/server/runtime"

type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"

const RECENT_LIMIT = 5

// luxon's diffNow().as("months") used an average month; keep the same window.
const sixMonths = 6 * 30.436875 * 24 * 60 * 60 * 1000

function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

export const isFreeModel = (model: { provider: { id: string }; cost?: { input: number } }) =>
  model.provider.id === "opencode" && (!model.cost || model.cost.input === 0)

// The newest release of each family per provider. A free model shares its family and release date with its paid twin,
// so the two are grouped apart. A tie keeps the first model listed.
export function latestModels<T extends { id: string; provider: { id: string }; family?: string; release_date: string }>(
  models: T[],
) {
  return [...Map.groupBy(models, (x) => x.provider.id).values()].flatMap((provider) =>
    [...Map.groupBy(provider, (x) => `${x.family}:${isFreeModel(x)}`).values()].map((group) => {
      const first = group.reduce((best, x) => (x.release_date > best.release_date ? x : best))

      return { modelID: first.id, providerID: first.provider.id }
    }),
  )
}

export function uniqueModels(models: ModelKey[]) {
  const seen = new Set<string>()

  return models.filter((model) => {
    const key = modelKey(model)

    if (seen.has(key)) return false
    seen.add(key)

    return true
  })
}

const createModelsController = (directory: Accessor<string | undefined>) => {
  const providers = useProviders(() => directory())
  const models = useGlobal().models
  const store = models.store
  const setStore = models.set

  const available = createMemo(() =>
    providers.connected().flatMap((p) =>
      Object.values(p.models).map((m) => ({
        ...m,
        provider: p,
      })),
    ),
  )

  // Release dates as epoch ms; an unparseable date is NaN and never counts as recent.
  const release = createMemo(
    () =>
      new Map(
        available().map(
          (model) =>
            [modelKey({ providerID: model.provider.id, modelID: model.id }), Date.parse(model.release_date)] as const,
        ),
      ),
  )

  const latest = createMemo(() =>
    latestModels(
      available().filter((x) => {
        const released = release().get(modelKey({ providerID: x.provider.id, modelID: x.id })) ?? NaN

        return Math.abs(Date.now() - released) < sixMonths
      }),
    ),
  )

  const latestSet = createMemo(() => new Set(latest().map((x) => modelKey(x))))

  // OpenCode's free models (Big Pickle) stay on offer long after release, so they are listed regardless of age or a
  // newer free model in the same family.
  const freeSet = createMemo(
    () =>
      new Set(
        available()
          .filter(isFreeModel)
          .map((x) => modelKey({ providerID: x.provider.id, modelID: x.id })),
      ),
  )

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

  // A model that is another model served faster or slower ("gpt-5.5-fast") is offered as a speed of that model
  // instead of as an entry of its own. This is the model whose entry stands for it.
  const standard = (key: ModelKey): ModelKey => {
    const base = find(key)?.speed?.base
    const model = base ? { providerID: key.providerID, modelID: base } : undefined

    return model && find(model) ? model : { providerID: key.providerID, modelID: key.modelID }
  }

  const isSpeed = (key: ModelKey) => modelKey(standard(key)) !== modelKey(key)

  // The model's other speeds, slowest first.
  const speeds = (key: ModelKey) => {
    const base = standard(key)

    return list().filter((item) => item.provider.id === base.providerID && item.speed?.base === base.modelID)
  }

  const listed = createMemo(() => list().filter((item) => !isSpeed({ providerID: item.provider.id, modelID: item.id })))

  // Saved entries may name a model at any of its speeds; the lists show each model once.
  const recent = createMemo(() => uniqueModels(models.recent().map(standard)))
  const favorite = createMemo(() => uniqueModels(models.favorite().map(standard)))

  const speed = {
    /** The speed the model runs at; none is its standard speed. */
    of: (key: ModelKey) => (isSpeed(key) ? find(key)?.speed?.id : undefined),
    list: (key: ModelKey) =>
      speeds(key).flatMap((item) => (item.speed ? [{ id: item.speed.id, faster: item.speed.faster }] : [])),
    /** The model that is `key` at a speed; none is its standard speed. */
    model: (key: ModelKey, value: string | undefined): ModelKey | undefined => {
      if (value === undefined) return standard(key)
      const item = speeds(key).find((item) => item.speed?.id === value)

      return item && { providerID: item.provider.id, modelID: item.id }
    },
    /** The model to run when `key` is picked: itself, at the speed last used with it. */
    remembered: (key: ModelKey): ModelKey => {
      const value = store.speed?.[variantKey(key)]

      return (value && !isSpeed(key) && speed.model(key, value)) || key
    },
    remember: (key: ModelKey, value: string | undefined) => {
      const name = variantKey(standard(key))

      if (!store.speed) {
        setStore("speed", { [name]: value })

        return
      }

      setStore("speed", name, value)
    },
  }

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

    if (latestSet().has(key) || freeSet().has(key)) return true

    // Models without a parseable release date stay visible.
    return !Number.isFinite(release().get(key) ?? NaN)
  }

  const setVisibility = (model: ModelKey, state: boolean) => {
    update(model, state ? "show" : "hide")
  }

  const push = (model: ModelKey) => {
    const uniq = uniqueModels([model, ...store.recent])

    if (uniq.length > RECENT_LIMIT) uniq.pop()
    setStore("recent", uniq)
  }

  // Newest favorite first, as in the TUI.
  const toggleFavorite = (model: ModelKey) => {
    const key = modelKey(standard(model))
    // An entry saved for the model at another speed is the same favorite.
    const rest = store.favorite.filter((item) => modelKey(standard(item)) !== key)

    setStore(
      "favorite",
      rest.length === store.favorite.length
        ? [{ providerID: model.providerID, modelID: model.modelID }, ...rest]
        : rest,
    )
  }

  const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
  // A model's speeds share its variant. Preferences saved before then may name one of its speeds instead.
  const getVariant = (model: ModelKey) => {
    const base = standard(model)

    return [base, model, ...speeds(base).map((item) => ({ providerID: item.provider.id, modelID: item.id }))]
      .map((item) => store.variant?.[variantKey(item)])
      .find((value) => value !== undefined)
  }

  const setVariant = (model: ModelKey, value: string | undefined) => {
    const key = variantKey(standard(model))

    if (!store.variant) {
      setStore("variant", { [key]: value ?? "default" })

      return
    }

    setStore("variant", key, value ?? "default")
  }

  return {
    ready: models.ready,
    list,
    /** The models offered as entries: every model but the ones that are another model's speed. */
    listed,
    find,
    standard,
    speed,
    visible,
    setVisibility,
    recent: {
      list: recent,
      push,
    },
    favorite: {
      list: favorite,
      toggle: toggleFavorite,
    },
    variant: {
      get: getVariant,
      set: setVariant,
    },
  }
}

export const { use: useModels, provider: ModelsProvider } = createSimpleContext({
  name: "Models",
  gate: false,
  init: (props: { directory?: string } = {}) => {
    return createModelsController(() => props.directory)
  },
})
