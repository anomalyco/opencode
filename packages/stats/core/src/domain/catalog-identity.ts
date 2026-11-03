import { statModel } from "./model-normalization"

const CATALOG_URL = "https://models.opencode.ai/catalog.json"
const STATS_PROVIDERS = ["opencode", "opencode-go"] as const
const cache: { value?: CatalogIdentity; expiresAt?: number } = {}

export type CatalogIdentity = {
  offerings: ReadonlyMap<string, string>
  models: ReadonlyMap<string, string>
}

export async function loadCatalogIdentity() {
  if (cache.value && (cache.expiresAt ?? 0) > Date.now()) return { catalog: cache.value, stale: false }
  return fetch(CATALOG_URL, { signal: AbortSignal.timeout(10_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Model catalog returned ${response.status}`)
      return catalogIdentity(await response.json())
    })
    .then((value) => {
      cache.value = value
      cache.expiresAt = Date.now() + 5 * 60_000
      return { catalog: value, stale: false }
    })
    .catch(() => ({ catalog: cache.value, stale: true }))
}

export function catalogIdentity(value: unknown): CatalogIdentity {
  if (!record(value) || !record(value.models) || !record(value.providers)) throw new Error("Invalid model catalog")
  const models = value.models
  const providers = value.providers

  const offerings = new Map<string, string>()
  const candidates = new Map<string, Set<string>>()
  STATS_PROVIDERS.forEach((providerID) => {
    const provider = providers[providerID]
    if (!record(provider) || !record(provider.models)) return
    Object.entries(provider.models).forEach(([modelID, model]) => {
      if (!record(model)) return
      const canonicalID =
        typeof model.canonical_model_id === "string"
          ? model.canonical_model_id
          : modelID in models
            ? modelID
            : `${providerID}/${modelID}` in models
              ? `${providerID}/${modelID}`
              : undefined
      if (!canonicalID || !(canonicalID in models)) return
      const [lab, ...parts] = canonicalID.split("/")
      if (!lab || parts.length === 0) return
      const canonicalModel = parts.join("/")
      offerings.set(`${providerID}/${modelID.toLowerCase()}`, lab)
      ;[modelID, canonicalModel].forEach((name) => {
        const normalized = statModel(name, undefined)
        candidates.set(normalized, (candidates.get(normalized) ?? new Set()).add(lab))
      })
    })
  })
  if (offerings.size === 0) throw new Error("Model catalog has no canonical OpenCode offerings")

  return {
    offerings,
    models: new Map(
      [...candidates.entries()].flatMap(([model, labs]) => (labs.size === 1 ? [[model, [...labs][0]!]] : [])),
    ),
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
