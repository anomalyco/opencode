import { useData } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { normalizeProviderList } from "@/context/global-sync/utils"
import { Iterable, pipe } from "effect"
import { createEffect, createMemo, type Accessor } from "solid-js"
import { emptyProviderCatalog } from "./provider-catalog"
import { useIntegrations } from "./use-integrations"

export const popularProviders = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders(directory: Accessor<string | undefined>) {
  const data = useData()
  const sdk = useServerSDK()
  const location = () => {
    const dir = directory()
    return dir ? { directory: dir } : undefined
  }

  createEffect(() => {
    if (sdk.connection.status() !== "connected") return
    const ref = location()
    void (async () => {
      if (!ref) await data.location.syncInfo()
      const resolved = ref ?? data.location.default()
      await Promise.all([data.location.provider.sync(resolved), data.location.model.sync(resolved)])
    })().catch(() => undefined)
  })
  const integrations = useIntegrations(directory)

  const providers = createMemo(() => {
    const ref = location()
    const provider = data.location.provider.list(ref)
    const model = data.location.model.list(ref)
    if (!provider || !model) return emptyProviderCatalog
    return normalizeProviderList(provider, model)
  })

  return {
    ready: () => {
      const ref = location()
      return data.location.provider.list(ref) !== undefined && data.location.model.list(ref) !== undefined
    },
    all: () => providers().all,
    default: () => providers().default,
    // V2 servers list only available providers, so the connectable catalog
    // comes from the integration list, with the provider catalog as fallback.
    popular: () => {
      const catalog = integrations
        .list()
        .filter((integration) => popularProviderSet.has(integration.id))
        .map((integration) => ({ id: integration.id, name: integration.name }))
      const seen = new Set(catalog.map((integration) => integration.id))
      return pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => popularProviderSet.has(p.id) && !seen.has(p.id)),
        Iterable.map((p) => ({ id: p.id, name: p.name })),
        (v) => [...catalog, ...v],
      )
    },
    connected: () => {
      const connected = new Set(providers().connected)
      return pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => connected.has(p.id)),
        (v) => Array.from(v),
      )
    },
    paid: () => {
      const connected = new Set(providers().connected)
      const paid = [
        ...Iterable.filter(
          providers().all,
          ([id]) =>
            connected.has(id) &&
            (id !== "opencode" || Object.values(providers().all.get(id)?.models ?? {}).some((m) => m.cost?.input)),
        ),
      ]
      return paid
    },
  }
}
