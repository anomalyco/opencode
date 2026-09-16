import { createSimpleContext } from "@opencode-ai/ui/context"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, onCleanup } from "solid-js"
import type { SshServersState } from "./types"
import { usePlatform } from "../context/platform"

const sshServersQueryKey = ["platform", "sshServers"] as const

export const { use: useSshServers, provider: SshServersProvider } = createSimpleContext({
  name: "SshServers",
  init: () => {
    const platform = usePlatform()
    const queryClient = useQueryClient()
    const query = useQuery(() => {
      const api = platform.sshServers
      return queryOptions<SshServersState>({
        queryKey: sshServersQueryKey,
        queryFn: () => api!.getState(),
        enabled: !!api,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      })
    })

    createEffect(() => {
      const api = platform.sshServers
      if (!api) return
      const off = api.subscribe((event) => {
        queryClient.setQueryData(sshServersQueryKey, event.state)
      })
      onCleanup(off)
    })

    return query as typeof query & { readonly data: SshServersState | undefined }
  },
})
