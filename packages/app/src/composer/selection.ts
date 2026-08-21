import { batch, type Accessor, createMemo, startTransition } from "solid-js"
import type { ComposerControls } from "./adapter"
import { useLayout } from "@/shell/state/layout"
import { useLocal, type ModelKey, type ModelSelection } from "@/providers/models/selection"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useProviders } from "@/providers/catalog/providers"
import { useData } from "@/runtime/server/current"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { useModels } from "@/providers/models/models"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "@/providers/models/variant"
import { useComposerState } from "./persistence"

export function createComposerControls(input: { sessionKey: Accessor<string>; model?: ModelSelection }) {
  const layout = useLayout()
  const local = useLocal()
  const sdk = useWorkspaceLocation()
  const data = useData()
  const providers = useProviders(() => sdk().directory)
  const view = layout.view(input.sessionKey)

  return createMemo<ComposerControls>(() => {
    return {
      agents: {
        available: normalizeAgentList(data.location.agent.list({ directory: sdk().directory }) ?? []),
        options: local.agent.list().map((agent) => agent.name),
        current: local.agent.current()?.name ?? "",
        visible: local.agent.visible(),
        select: local.agent.set,
      },
      model: {
        selection: input.model ?? local.model,
        paid: providers.paid().length > 0,
        loading:
          (local.agent.visible() && data.location.agent.list({ directory: sdk().directory }) === undefined) ||
          !providers.ready(),
      },
      session: {
        tabs: layout.tabs(input.sessionKey),
        reviewPanel: view.reviewPanel,
      },
    }
  })
}

export function createComposerModelSelection(input: {
  agent: () => { model?: ModelKey; variant?: string } | undefined
}) {
  const sdk = useWorkspaceLocation()
  const models = useModels()
  const prompt = useComposerState()
  const providers = useProviders(() => sdk().directory)
  const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))

  const valid = (model: ModelKey) => {
    const provider = providers.all().get(model.providerID)
    return !!provider?.models[model.modelID] && connected().has(model.providerID)
  }
  const recent = () => models.recent.list().find(valid)
  const fallback = () =>
    providers.connected().flatMap((provider) => {
      const modelID = Object.values(provider.models)[0]?.id
      return modelID ? [{ providerID: provider.id, modelID }] : []
    })[0]
  const current = () => {
    const key = [prompt.model.current(), input.agent()?.model, recent(), fallback()].find(
      (item): item is ModelKey => !!item && valid(item),
    )
    return key ? models.find(key) : undefined
  }
  const recentModels = createMemo(() =>
    models.recent
      .list()
      .map(models.find)
      .filter((item): item is NonNullable<typeof item> => !!item),
  )
  const selection = {
    ready: models.ready,
    current,
    recent: recentModels,
    list: models.list,
    cycle(direction: 1 | -1) {
      const items = recentModels()
      const item = current()
      if (!item) return
      const index = items.findIndex((entry) => entry.provider.id === item.provider.id && entry.id === item.id)
      if (index === -1) return
      const next = items[(index + direction + items.length) % items.length]
      if (next) selection.set({ providerID: next.provider.id, modelID: next.id })
    },
    set(item: ModelKey | undefined, options?: { recent?: boolean }) {
      void startTransition(() =>
        batch(() => {
          prompt.model.set(item ? { ...item, variant: prompt.model.current()?.variant } : undefined)
          if (!item) return
          models.setVisibility(item, true)
          if (options?.recent) models.recent.push(item)
        }),
      )
    },
    visible: models.visible,
    setVisibility: models.setVisibility,
    variant: {
      configured() {
        const item = input.agent()
        const model = current()
        if (!item || !model) return
        return getConfiguredAgentVariant({
          agent: { model: item.model, variant: item.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        })
      },
      selected() {
        return prompt.model.current()?.variant
      },
      current() {
        const resolved = resolveModelVariant({
          variants: this.list(),
          selected: this.selected(),
          configured: this.configured(),
        })
        if (resolved) return resolved
        const model = current()
        if (!model) return
        const saved = models.variant.get({ providerID: model.provider.id, modelID: model.id })
        if (saved && this.list().includes(saved)) return saved
      },
      list() {
        return Object.keys(current()?.variants ?? {})
      },
      set(value: string | undefined) {
        void startTransition(() =>
          batch(() => {
            const model = current()
            if (!model) return
            prompt.model.set({ providerID: model.provider.id, modelID: model.id, variant: value ?? null })
            models.variant.set({ providerID: model.provider.id, modelID: model.id }, value)
          }),
        )
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
  } satisfies ModelSelection

  return selection
}
