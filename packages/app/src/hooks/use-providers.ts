import { useGlobalSync } from "@/context/global-sync"
import { mainDomain } from "@/pages/layout/extra-agents"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

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

function providerAccessors(providers: () => ReturnType<typeof useGlobalSync>["data"]["provider"]) {
  return {
    data: providers,
    all: () => providers().all,
    default: () => providers().default,
    popular: () => providers().all.filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter(
        (p) => connected.has(p.id) && (p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input)),
      )
    },
  }
}

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const providers = () => {
    if (dir()) {
      const [projectStore] = globalSync.child(dir())
      if (projectStore.provider.all.length > 0) return projectStore.provider
    }
    return globalSync.data.provider
  }
  return providerAccessors(providers)
}

export function useMainProviders() {
  const globalSync = useGlobalSync()
  const providers = () => globalSync.data.rootByDomain[mainDomain]?.provider ?? globalSync.data.provider
  return providerAccessors(providers)
}
