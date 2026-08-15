import { useServerSDK } from "@/context/server-sdk"
import { useData } from "@/context/server"
import { createEffect, type Accessor } from "solid-js"

export function useIntegrations(directory: Accessor<string | undefined>) {
  const serverSDK = useServerSDK()
  const data = useData()

  createEffect(() => {
    if (serverSDK.connection.status() !== "connected") return
    const value = directory()
    void data.location.integration.sync(value ? { directory: value } : undefined).catch(() => undefined)
  })

  return {
    list: () => data.location.integration.list(directory() ? { directory: directory()! } : undefined) ?? [],
  }
}
