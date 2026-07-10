import { useServerSync } from "@/context/server-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import type { Provider } from "@opencode-ai/sdk/v2"
import type { Accessor } from "solid-js"
import { selectProviderCatalog } from "./provider-catalog"

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

type ProviderEntry = [string, Provider]

type ProviderHelpers = {
  all: () => Map<string, Provider>
  default: () => Record<string, string>
  popular: () => Provider[]
  connected: () => Provider[]
  paid: () => ProviderEntry[]
}

export function useProviders(directory?: Accessor<string | undefined>): ProviderHelpers {
  const serverSync = useServerSync()
  const params = useParams()
  const dir = () => (directory ? directory() : decode64(params.dir))
  const providers = () => {
    const value = dir()
    const projectStore = value ? serverSync().child(value)[0] : undefined
    if (directory)
      return selectProviderCatalog({
        explicit: true,
        directory: value,
        catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      })
    return selectProviderCatalog({
      explicit: false,
      directory: value,
      catalog: projectStore && { ready: projectStore.provider_ready, providers: projectStore.provider },
      global: serverSync().data.provider,
    })
  }
  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () =>
      Array.from(providers().all.values()).filter((provider) => popularProviderSet.has(provider.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return Array.from(providers().all.values()).filter((provider) => connected.has(provider.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return Array.from(providers().all).filter(
        ([id]) =>
          connected.has(id) &&
          (id !== "opencode" || Object.values(providers().all.get(id)?.models ?? {}).some((model) => model.cost?.input)),
      )
    },
  }
}
