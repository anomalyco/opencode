import { useData } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { normalizeProviderList } from "@/context/global-sync/utils"
import { Iterable, pipe } from "effect"
import { createEffect, createMemo, type Accessor } from "solid-js"
import { emptyProviderCatalog } from "./provider-catalog"

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
    void Promise.all([
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
      data.location.model.syncDefault(ref),
    ]).catch(() => undefined)
  })

  const providers = createMemo(() => {
    const ref = location()
    const provider = data.location.provider.list(ref)
    const model = data.location.model.list(ref)
    const defaultModel = data.location.model.default(ref)
    if (!provider || !model || defaultModel === undefined) return emptyProviderCatalog
    return normalizeProviderList(provider, model, defaultModel)
  })

  return {
    ready: () => {
      const ref = location()
      return (
        data.location.provider.list(ref) !== undefined &&
        data.location.model.list(ref) !== undefined &&
        data.location.model.default(ref) !== undefined
      )
    },
    all: () => providers().all,
    default: () => providers().default,
    popular: () =>
      pipe(
        providers().all,
        Iterable.map(([, p]) => p),
        Iterable.filter((p) => popularProviderSet.has(p.id)),
        (v) => Array.from(v),
      ),
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
