import { useGlobalSync } from "@/context/global-sync"
import { base64Decode } from "@opencode-ai/util/encode"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = ["opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]

export function useProviders() {
  const params = useParams()
  const globalSync = useGlobalSync()
  const currentDirectory = createMemo(() => base64Decode(params.dir ?? ""))
  const providers = createMemo(() => {
    if (currentDirectory()) {
      const [projectStore] = globalSync.child(currentDirectory())
      return projectStore.provider
    }
    return globalSync.data.provider
  })
  const connected = createMemo(() => providers().all.filter((p) => providers().connected.includes(p.id)))
  const paid = createMemo(() => connected().filter((p) => Object.values(p.models).find((m) => m.cost?.input)))
  const popular = createMemo(() => providers().all.filter((p) => popularProviders.includes(p.id)))
  return createMemo(() => ({
    all: providers().all,
    default: providers().default,
    popular,
    connected,
    paid,
  }))
}
