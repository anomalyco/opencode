import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { pathKey } from "@/utils/path-key"
import { createQuery } from "@tanstack/solid-query"
import type { Accessor } from "solid-js"

export function useIntegrations(directory: Accessor<string | undefined>) {
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const query = createQuery(() => {
    const value = directory()
    return {
      ...serverSync.queryOptions.integrations(value ? pathKey(value) : null),
      enabled: serverSDK.connection.status() === "connected",
    }
  })

  return {
    list: () => (query.isSuccess || query.isRefetchError ? query.data : []),
  }
}
