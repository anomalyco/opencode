import { useGlobalSync } from "@/context/global-sync"
import { base64Decode } from "@opencode-ai/util/encode"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = ["opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const currentDirectory = createMemo(() => base64Decode(params.dir ?? ""))
  const providers = createMemo(() => {
    if (currentDirectory()) {
      const [projectStore] = globalSync.child(currentDirectory())
      return projectStore.provider
    }
    return globalSync.data.provider
  })
  const connected = createMemo(() => {
    const p = providers()
    if (!p?.all || !p?.connected) return []
    return p.all.filter((provider) => p.connected.includes(provider.id))
  })
  const paid = createMemo(() =>
    connected().filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input)),
  )
  const popular = createMemo(() => {
    const p = providers()
    if (!p?.all) return []
    return p.all.filter((provider) => popularProviders.includes(provider.id))
  })
  return {
    all: createMemo(() => providers()?.all ?? []),
    default: createMemo(() => providers()?.default ?? {}),
    popular,
    connected,
    paid,
  }
}
