import { isVisionCapable, type ModelShape } from "../util/model"
import { modelKey, type ModelRef } from "../util/attachment-fallback"

export type VisionModelListItem = {
  providerID: string
  modelID: string
  title: string
  category: string
}

export type FallbackPickerRow = {
  value: string
  title: string
  category?: string
  model?: ModelRef
}

type ProviderLike = {
  id: string
  name: string
  models: Record<string, ModelShape>
}

/** Vision-capable, non-deprecated models for DialogFallback. */
export function listVisionCapableModels(providers: readonly ProviderLike[]): VisionModelListItem[] {
  const out: VisionModelListItem[] = []
  for (const provider of providers) {
    for (const [modelID, info] of Object.entries(provider.models)) {
      if (info.status === "deprecated") continue
      if (!isVisionCapable(info)) continue
      out.push({
        providerID: provider.id,
        modelID,
        title: info.name ?? modelID,
        category: provider.name,
      })
    }
  }
  return out
}

/** Option rows for DialogFallback: optional Currently / Clear, then vision models. */
export function fallbackPickerRows(input: {
  current?: ModelRef | null
  clearLabel?: string
  models: readonly VisionModelListItem[]
}): FallbackPickerRow[] {
  const list: FallbackPickerRow[] = []
  if (input.current) {
    list.push({
      value: "__current__",
      title: `Currently: ${modelKey(input.current)}`,
    })
  }
  if (input.clearLabel) {
    list.push({
      value: "__clear__",
      title: input.clearLabel,
    })
  }
  for (const m of input.models) {
    list.push({
      value: modelKey(m),
      title: m.title,
      category: m.category,
      model: { providerID: m.providerID, modelID: m.modelID },
    })
  }
  return list
}
