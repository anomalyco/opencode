import { useMutation } from "@tanstack/solid-query"
import type { Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { useData } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"

export function useMcpToggle(directory?: Accessor<string | undefined>, onSuccess?: () => unknown) {
  const data = useData()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const location = () => {
    const value = directory ? directory() : data.location.default().directory
    return value ? { directory: value } : undefined
  }

  return useMutation(() => ({
    mutationFn: async (name: string) => {
      const ref = location()
      const server = (await serverSDK.api.mcp.list({ location: ref })).data.find((item) => item.name === name)
      if (!server || server.status.status === "pending") return
      if (server.status.status === "connected") {
        await serverSDK.api.mcp.disconnect({ server: name, location: ref })
      } else if (server.status.status === "needs_auth" && server.integrationID) {
        const integration = await serverSDK.api.integration.get({ integrationID: server.integrationID, location: ref })
        const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)
        if (!method || method.type !== "oauth")
          throw new Error(`MCP server ${name} requires an interactive authentication form`)
        const attempt = await serverSDK.api.integration.oauth.connect({
          integrationID: server.integrationID,
          methodID: method.id,
          location: ref,
        })
        platform.openExternal(attempt.data.url)
      } else {
        await serverSDK.api.mcp.connect({ server: name, location: ref })
      }
      data.location.mcp.server.invalidate(ref)
      data.location.mcp.resource.invalidate(ref)
      await Promise.all([data.location.mcp.server.sync(ref), data.location.mcp.resource.sync(ref), onSuccess?.()])
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))
}
