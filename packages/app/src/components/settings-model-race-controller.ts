import { createMemo, createSignal } from "solid-js"
import { ConfigModelRace } from "@opencode-ai/core/config/model-race"
import { useModels } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"

export type ModelRaceDraft = ConfigModelRace.Normalized

export function toggleRaceModel(models: string[], id: string) {
  return models.includes(id) ? models.filter((model) => model !== id) : [...models, id]
}

export function useModelRaceSettings() {
  const serverSync = useServerSync()
  const models = useModels()
  const current = () => ConfigModelRace.normalize(serverSync().data.config.modelRace)
  const [draft, setDraft] = createSignal<ModelRaceDraft>(current())
  const [saving, setSaving] = createSignal(false)
  const errors = createMemo(() => ConfigModelRace.validate(draft()))
  const dirty = createMemo(() => JSON.stringify(draft()) !== JSON.stringify(current()))

  const options = createMemo(() => {
    const available = models.list().map((model) => ({
      id: `${model.provider.id}/${model.id}`,
      title: model.name,
      provider: model.provider.name,
    }))
    const known = new Set(available.map((model) => model.id))
    return [
      ...draft()
        .models.filter((model) => !known.has(model))
        .map((model) => ({ id: model, title: model, provider: "Configured" })),
      ...available,
    ]
  })

  const patch = (value: Partial<ModelRaceDraft>) => setDraft((current) => ({ ...current, ...value }))

  const persist = async (value: ModelRaceDraft) => {
    const issue = ConfigModelRace.validate(value)[0]
    if (issue) {
      showToast({ title: "Model racing", description: issue, variant: "error" })
      return false
    }
    setSaving(true)
    try {
      await serverSync().updateConfig({ modelRace: value })
      serverSync().set("config", "modelRace", value)
      showToast({ title: "Model racing", description: "Configuration saved", variant: "success" })
      return true
    } catch (error) {
      showToast({
        title: "Model racing",
        description: error instanceof Error ? error.message : "Failed to save configuration",
        variant: "error",
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  return {
    draft,
    saving,
    errors,
    dirty,
    options,
    patch,
    async setEnabled(value: boolean) {
      const previous = draft().enabled
      const next = { ...draft(), enabled: value }
      if (value && ConfigModelRace.validate(next).length > 0) {
        showToast({ title: "Model racing", description: ConfigModelRace.validate(next)[0], variant: "error" })
        return false
      }
      setDraft(next)
      try {
        await serverSync().updateConfig({ modelRace: { enabled: value } })
        serverSync().set("config", "modelRace", "enabled", value)
        return true
      } catch (error) {
        setDraft((current) => ({ ...current, enabled: previous }))
        showToast({
          title: "Model racing",
          description: error instanceof Error ? error.message : "Failed to update model racing",
          variant: "error",
        })
        return false
      }
    },
    setFirstToken(value: boolean) {
      setDraft((current) => ({ ...current, strategy: { ...current.strategy, firstToken: value } }))
    },
    setThroughput(value: boolean) {
      setDraft((current) => ({ ...current, strategy: { ...current.strategy, throughput: value } }))
    },
    setToolCall(value: boolean) {
      setDraft((current) => ({ ...current, strategy: { ...current.strategy, toolCall: value } }))
    },
    setSwitch(value: boolean) {
      setDraft((current) => ({ ...current, switch: { enabled: value } }))
    },
    setWarmupTokens(value: number) {
      setDraft((current) => ({ ...current, throughput: { ...current.throughput, warmupTokens: value } }))
    },
    setMeasurementWindow(value: number) {
      setDraft((current) => ({ ...current, throughput: { ...current.throughput, measurementWindowMs: value } }))
    },
    toggleModel(id: string) {
      setDraft((current) => ({ ...current, models: toggleRaceModel(current.models, id) }))
    },
    setModels(value: string[]) {
      setDraft((current) => ({ ...current, models: [...new Set(value)] }))
    },
    async saveModels(models: string[]) {
      const value = { ...draft(), models: [...new Set(models)] }
      setDraft(value)
      return persist(value)
    },
    reset() {
      setDraft(ConfigModelRace.normalize(ConfigModelRace.defaults))
    },
    async save() {
      return persist(draft())
    },
  }
}
