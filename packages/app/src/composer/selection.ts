import { batch, createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"
import type { ComposerControls } from "./adapter"
import { useLocal, type ModelKey, type ModelSelection } from "@/providers/models/selection"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useProviders } from "@/providers/catalog/providers"
import { useData } from "@/runtime/server/current"
import { normalizeAgentList, normalizeProviderList } from "@/runtime/server/global-sync/utils"
import { useModels } from "@/providers/models/models"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "@/providers/models/variant"
import { useComposerState } from "./persistence"
import { useConfiguredModel } from "@/providers/models/configured"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { useGlobal } from "@/runtime/server/runtime"

export function createComposerControls(input: { model?: ModelSelection } = {}) {
  const local = useLocal()
  const sdk = useWorkspaceLocation()
  const data = useData()
  const providers = useProviders(() => sdk().directory)
  const models = useGlobal().models

  const providerName = (providerID: string, catalog = providers.all()) => composerProviderName(providerID, catalog)

  const loading = () => {
    const selection = input.model ?? local.model

    return (
      !selection.ready() || data.location.agent.list({ directory: sdk().directory }) === undefined || !providers.ready()
    )
  }

  // Until this Location's catalog loads, the default Location's or one visited earlier nearly always lists the same
  // model, so it names the chips; the loaded names then replace them in place.
  const preview = createMemo(() => {
    if (!loading()) return
    const expected = (input.model ?? local.model).preview?.()

    if (!expected) return

    const catalogs = providers.ready()
      ? [providers.all()]
      : [undefined, ...data.session.list().map((item) => item.location)].map((location) => {
          const provider = data.location.provider.list(location)
          const catalog = data.location.model.list(location)

          return provider && catalog ? normalizeProviderList(provider, catalog).all : undefined
        })

    const match = catalogs
      .map((all) => all && { all, model: all.get(expected.model.providerID)?.models[expected.model.modelID] })
      .find((item) => !!item?.model)

    if (!match?.model) return
    const variants = Object.keys(match.model.variants ?? {})

    return {
      provider: providerName(expected.model.providerID, match.all),
      model: match.model.name.replace("(latest)", "").trim(),
      variants,
      variant:
        resolveModelVariant({
          variants,
          selected: expected.selected,
          configured: undefined,
          preferred: models.store.variant?.[`${expected.model.providerID}/${expected.model.modelID}`],
        }) ?? "default",
    }
  })

  return createMemo<ComposerControls>(() => {
    const selection = input.model ?? local.model
    const key = selection.key()

    return {
      agents: {
        available: normalizeAgentList(data.location.agent.list({ directory: sdk().directory }) ?? []),
        options: local.agent.list().map((agent) => agent.name),
        current: local.agent.current()?.name ?? "",
        visible: local.agent.visible(),
        select: local.agent.set,
      },
      model: {
        selection,
        // A model the catalog no longer offers still names its provider.
        providerName: key && providerName(key.providerID),
        paid: providers.paid().length > 0,
        // The session's model applies only to its agent, so resolve agents before showing a model.
        loading: loading(),
        preview: preview(),
      },
    }
  })
}

// Like the model picker, a Console-managed provider drops its "Workspace / " prefix unless the
// same provider is also connected directly and the workspace is what tells them apart.
export function composerProviderName(providerID: string, catalog: ReturnType<typeof normalizeProviderList>["all"]) {
  const provider = catalog.get(providerID)

  if (!provider) return providerID
  const all = [...catalog.values()]
  const managed = consoleProviderGroup(all)

  if (!managed?.providers.includes(provider)) return provider.name
  const direct = all.some((item) => !managed.providers.includes(item) && canonical(item) === canonical(provider))

  return direct ? provider.name : consoleProviderName(managed, provider.name)
}

const canonical = (provider: { id: string; canonical?: string }) =>
  provider.canonical ?? provider.id.replace(/^console-/, "")

export function createComposerModelSelection(input: {
  agent: () => { name: string; model?: ModelKey; variant?: string } | undefined
}) {
  const sdk = useWorkspaceLocation()
  const models = useModels()
  const local = useLocal()
  const prompt = useComposerState()
  const configuredModel = useConfiguredModel()
  const [remembered, setRemembered] = createStore<Record<string, ModelKey | undefined>>({})
  createEffect(
    on(
      () => input.agent()?.name,
      (name, previous) => {
        if (!name || !previous || name === previous) return
        batch(() => {
          const model = prompt.model.current()
          setRemembered(previous, model ? { providerID: model.providerID, modelID: model.modelID } : undefined)
          prompt.model.set(remembered[name] ? { ...remembered[name] } : undefined)
        })
      },
    ),
  )
  const providers = useProviders(() => sdk().directory)
  const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))

  const valid = (model: Pick<ModelKey, "providerID" | "modelID">) => {
    const provider = providers.all().get(model.providerID)

    return !!provider?.models[model.modelID] && connected().has(model.providerID)
  }

  const recent = () => models.recent.list().find(valid)

  const fallback = () =>
    providers.connected().flatMap((provider) => {
      const modelID = Object.values(provider.models)[0]?.id

      return modelID ? [{ providerID: provider.id, modelID }] : []
    })[0]

  const key = () => {
    if (!configuredModel.ready()) return

    return [prompt.model.current(), input.agent()?.model, configuredModel(), recent(), fallback()].find(
      (item): item is ModelKey => !!item && valid(item),
    )
  }

  const current = () => {
    const item = key()

    return item ? models.find(item) : undefined
  }

  const recentModels = createMemo(() =>
    models.recent
      .list()
      .map(models.find)
      .filter((item): item is NonNullable<typeof item> => !!item),
  )

  const favoriteModels = createMemo(() =>
    models.favorite
      .list()
      .map(models.find)
      .filter((item): item is NonNullable<typeof item> => !!item),
  )

  const selection = {
    trackSessionCommit: local.model.trackSessionCommit,
    remembered: () => Object.fromEntries(Object.entries(remembered).map(([name, model]) => [name, { model }])),
    ready: Object.assign(() => models.ready() && configuredModel.ready(), { promise: models.ready.promise }),
    key,
    current,
    recent: recentModels,
    favorite: { list: favoriteModels, toggle: models.favorite.toggle },
    list: models.list,
    cycle(direction: 1 | -1) {
      const items = recentModels()
      const item = current()

      if (!item) return
      const index = items.findIndex((entry) => entry.provider.id === item.provider.id && entry.id === item.id)

      const next =
        items[
          index === -1 ? (direction === 1 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
        ]

      if (next) selection.set({ providerID: next.provider.id, modelID: next.id })
    },
    set(item: ModelKey | undefined, options?: { recent?: boolean }) {
      batch(() => {
        if (item && !valid(item)) return
        const previous = current()
        const same = item && previous?.provider.id === item.providerID && previous.id === item.modelID
        prompt.model.set(
          item ? { ...item, variant: same ? (selection.variant.current() ?? null) : undefined } : undefined,
        )

        if (!item) return
        models.setVisibility(item, true)

        if (options?.recent) models.recent.push(item)
      })
    },
    visible: models.visible,
    setVisibility: models.setVisibility,
    variant: {
      configured(model = current()) {
        const item = input.agent()

        if (!item || !model) return
        const global = configuredModel()

        return (
          getConfiguredAgentVariant({
            agent: { model: item.model, variant: item.variant },
            model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
          }) ??
          getConfiguredAgentVariant({
            agent: { model: global, variant: global?.variant },
            model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
          })
        )
      },
      selected() {
        const model = prompt.model.current()

        return model && valid(model) ? model.variant : undefined
      },
      current(item?: ModelKey) {
        const model = item ? models.find(item) : current()
        const same = !item || (current()?.provider.id === item.providerID && current()?.id === item.modelID)

        return resolveModelVariant({
          variants: Object.keys(model?.variants ?? {}),
          selected: same ? this.selected() : undefined,
          configured: this.configured(model),
          preferred: model ? models.variant.get({ providerID: model.provider.id, modelID: model.id }) : undefined,
        })
      },
      list() {
        return Object.keys(current()?.variants ?? {})
      },
      set(value: string | undefined) {
        batch(() => {
          const model = current()

          if (!model) return
          prompt.model.set({ providerID: model.provider.id, modelID: model.id, variant: value ?? null })
          models.variant.set({ providerID: model.provider.id, modelID: model.id }, value)
        })
      },
      cycle() {
        const variants = this.list()

        if (variants.length === 0) return
        this.set(
          cycleModelVariant({
            variants,
            selected: this.current() ?? null,
            configured: undefined,
          }),
        )
      },
    },
  }

  return selection satisfies ModelSelection
}
