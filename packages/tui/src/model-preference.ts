import { readJson, writeJsonAtomic } from "./util/persistence"
import { isRecord } from "./util/record"
import { watch } from "node:fs"
import path from "node:path"

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

export function recentModels(model: ModelPreferenceModel, recent: ModelPreferenceModel[]) {
  const seen = new Set<string>()
  return [model, ...recent]
    .filter((item) => {
      const key = modelPreferenceKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

export function favoriteModels(model: ModelPreferenceModel, favorite: ModelPreferenceModel[], enabled: boolean) {
  const current = favorite.filter((item) => modelPreferenceKey(item) !== modelPreferenceKey(model))
  return enabled ? [model, ...current] : current
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
  let pending = Promise.resolve()
  let revision = 0
  let watcher: ReturnType<typeof watch> | undefined
  let reload: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<(value: ModelPreference) => void>()
  const read = () =>
    readJson<unknown>(filePath)
      .then(decodeModelPreference)
      .catch(() => decodeModelPreference(undefined))

  function update(change: (current: ModelPreference) => Partial<ModelPreference>) {
    const result = pending.then(async () => {
      const { Flock } = await import("@opencode-ai/util/flock")
      return Flock.withLock(
        filePath,
        async () => {
          const current = await read()
          const next = { ...current, ...patch(change(preference(current))) }
          await writeJsonAtomic(filePath, next)
        },
        { dir: path.join(path.dirname(filePath), "locks") },
      )
    })
    pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function load() {
    return pending.then(read).then(preference)
  }

  async function refresh() {
    const current = ++revision
    const value = await load()
    if (current !== revision) return
    listeners.forEach((listener) => listener(value))
  }

  return {
    load,
    addRecent(model: ModelPreferenceModel) {
      return update((current) => ({ recent: recentModels(model, current.recent) }))
    },
    setFavorite(model: ModelPreferenceModel, enabled: boolean) {
      return update((current) => ({ favorite: favoriteModels(model, current.favorite, enabled) }))
    },
    subscribe(listener: (value: ModelPreference) => void) {
      listeners.add(listener)
      void refresh()
      if (!watcher) {
        watcher = watch(path.dirname(filePath), (_event, filename) => {
          const changed = filename?.toString()
          const name = path.basename(filePath)
          if (changed !== undefined && changed !== name && !changed.startsWith(name + ".")) return
          clearTimeout(reload)
          reload = setTimeout(() => void refresh(), 50)
        })
        watcher.on("error", () => {
          watcher?.close()
          watcher = undefined
        })
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        clearTimeout(reload)
        watcher?.close()
        watcher = undefined
      }
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
