import { createSimpleContext } from "@opencode-ai/ui/context"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, onCleanup } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import type { SshState } from "./types"

const key = ["platform", "sshServers"] as const
export const { use: useSshServers, provider: SshServersProvider } = createSimpleContext({
  name: "SshServers",
  init: () => {
    const platform = usePlatform()
    const client = useQueryClient()
    const query = useQuery(() =>
      queryOptions<SshState>({
        queryKey: key,
        queryFn: () => platform.sshServers?.getState() ?? Promise.resolve({ servers: [] }),
        staleTime: Infinity,
      }),
    )
    createEffect(() => {
      const off = platform.sshServers?.subscribe((state) => client.setQueryData(key, state))
      if (off) onCleanup(off)
    })
    return query
  },
})
