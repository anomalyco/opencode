import { fetchKiloModels } from "./api/models.js"

type AuthGetter = () => Promise<{
  kilocodeToken?: string
  kilocodeOrganizationId?: string
}>

const cache = new Map<string, { models: Record<string, any>; timestamp: number }>()
const TTL = 5 * 60 * 1000
const inFlight = new Map<string, Promise<Record<string, any>>>()

let authGetter: AuthGetter = async () => ({})

export function setKiloAuthGetter(getter: AuthGetter) {
  authGetter = getter
}

export async function fetchKiloModelsCached(options?: {
  kilocodeToken?: string
  kilocodeOrganizationId?: string
  baseURL?: string
}): Promise<Record<string, any>> {
  const auth = await authGetter()
  const merged = { ...auth, ...options }
  const key = JSON.stringify(merged)

  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < TTL) {
    return cached.models
  }

  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const models = await fetchKiloModels(merged)
    cache.set(key, { models, timestamp: Date.now() })
    return models
  })()

  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}

export function clearKiloModelsCache() {
  cache.clear()
}
