import { readJson, writeJsonAtomic } from "./util/persistence"
import { isRecord } from "./util/record"

export type ModelPreferenceModel = {
  providerID: string
  modelID: string
}

export type ModelPreference = {
  recent: ModelPreferenceModel[]
  favorite: ModelPreferenceModel[]
  variant: Record<string, string | undefined>
}

export type ModelPreferenceDocument = Record<string, unknown> & ModelPreference

function models(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ModelPreferenceModel[] => {
    if (!isRecord(item)) return []
    if (typeof item.providerID !== "string" || item.providerID.length === 0) return []
    if (typeof item.modelID !== "string" || item.modelID.length === 0) return []
    return [{ providerID: item.providerID, modelID: item.modelID }]
  })
}

function variants(value: unknown) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (key.length === 0 || typeof item !== "string" || item.length === 0) return []
      const variant = normalizeModelVariant(item)
      return variant === undefined ? [] : ([[key, variant]] as const)
    }),
  )
}

export function normalizeModelVariant(value: string | undefined) {
  return value === "default" ? undefined : value
}

export function modelPreferenceKey(model: ModelPreferenceModel) {
  return `${model.providerID}/${model.modelID}`
}

export function cycleModelVariant(current: string | undefined, variants: string[]) {
  const named = variants.filter((variant) => variant !== "default")
  if (named.length === 0) return undefined
  const value = normalizeModelVariant(current)
  if (value === undefined) return named[0]
  const index = named.indexOf(value)
  if (index === -1 || index === named.length - 1) return undefined
  return named[index + 1]
}

export function decodeModelPreference(value: unknown): ModelPreferenceDocument {
  const root = isRecord(value) ? value : {}
  return {
    ...root,
    recent: models(root.recent),
    favorite: models(root.favorite),
    variant: variants(root.variant),
  }
}

function preference(value: ModelPreferenceDocument): ModelPreference {
  return {
    recent: value.recent,
    favorite: value.favorite,
    variant: value.variant,
  }
}

function patch(value: Partial<ModelPreference>) {
  return {
    ...(value.recent === undefined ? {} : { recent: models(value.recent) }),
    ...(value.favorite === undefined ? {} : { favorite: models(value.favorite) }),
    ...(value.variant === undefined ? {} : { variant: variants(value.variant) }),
  }
}

export function createModelPreferenceRepository(filePath: string) {
  const state = {
    pending: Promise.resolve(),
  }
  const read = () =>
    readJson<unknown>(filePath)
      .then(decodeModelPreference)
      .catch(() => decodeModelPreference(undefined))

  function update(change: (current: ModelPreference) => Partial<ModelPreference>) {
    const result = state.pending.then(async () => {
      const current = await read()
      const next = { ...current, ...patch(change(preference(current))) }
      await writeJsonAtomic(filePath, next)
    })
    state.pending = result.catch(() => undefined)
    return result
  }

  function load() {
    return state.pending.then(read).then(preference)
  }

  return {
    load,
    patch(value: Partial<ModelPreference>) {
      return update(() => value)
    },
    async resolveVariant(model: ModelPreferenceModel) {
      return (await load()).variant[modelPreferenceKey(model)]
    },
    saveVariant(model: ModelPreferenceModel, value: string | undefined) {
      const key = modelPreferenceKey(model)
      const next = normalizeModelVariant(value)
      return update((current) => {
        const variant = { ...current.variant }
        if (next === undefined) delete variant[key]
        if (next !== undefined) variant[key] = next
        return { variant }
      })
    },
  }
}
