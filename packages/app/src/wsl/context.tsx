import { createSimpleContext } from "@opencode-ai/ui/context"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, onCleanup } from "solid-js"
import type { WslServersState } from "./types"
import { usePlatform } from "../context/platform"

const wslServersQueryKey = ["platform", "wslServers"] as const

export const { use: useWslServers, provider: WslServersProvider } = createSimpleContext({
  name: "WslServers",
  init: () => {
    const platform = usePlatform()
    const queryClient = useQueryClient()
    const query = useQuery(() => {
      const api = platform.wslServers
      return queryOptions<WslServersState>({
        queryKey: wslServersQueryKey,
        queryFn: () => api!.getState(),
        enabled: !!api,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      })
    })

    createEffect(() => {
      const api = platform.wslServers
      if (!api) return
      const off = api.subscribe((event) => {
        queryClient.setQueryData(wslServersQueryKey, event.state)
      })
      onCleanup(off)
    })

    return query as typeof query & { readonly data: WslServersState | undefined }
  },
})
