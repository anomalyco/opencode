import { useQueryOptions } from "@/context/server-sync"
import { Iterable, pipe } from "effect"
import { type Accessor } from "solid-js"
import { emptyProviderCatalog } from "./provider-catalog"
import { useQuery } from "@tanstack/solid-query"
import { pathKey } from "@/utils/path-key"

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
  const providersQuery = useQuery(() => {
    const queryOpts = useQueryOptions()
    const dir = directory()
    return queryOpts.providers(dir ? pathKey(dir) : null)
  })

  const providers = () => (!providersQuery.isSuccess ? emptyProviderCatalog : providersQuery.data)

  return {
    ready: () => providersQuery.isSuccess,
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
