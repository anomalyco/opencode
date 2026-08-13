import { useServerSync } from "@/context/server-sync"
import { Iterable, pipe } from "effect"
import { createEffect, createMemo, type Accessor } from "solid-js"
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

export function useProviders(directory: Accessor<string | undefined>) {
  const serverSync = useServerSync()
  const dir = directory
  const providers = () => {
    const value = dir()
    const projectStore = value ? serverSync().child(value)[0] : undefined
    if (value)
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
    ready: () => {
      const value = dir()
      if (!value) return false
      return serverSync().child(value)[0].provider_ready
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
