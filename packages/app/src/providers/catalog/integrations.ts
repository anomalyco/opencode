import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { createEffect, type Accessor } from "solid-js"

export function useIntegrations(directory: Accessor<string | undefined>) {
  const serverSDK = useServerSDK()
  const data = useData()

  createEffect(() => {
    if (serverSDK.connection.status() !== "connected") return
    const value = directory()
    void (async () => {
      const ref = value ? { directory: value } : undefined
      if (!ref) await data.location.syncInfo()
      await data.location.integration.sync(ref ?? data.location.default())
    })().catch(() => undefined)
  })

  return {
    list: () => data.location.integration.list(directory() ? { directory: directory()! } : undefined) ?? [],
  }
}
