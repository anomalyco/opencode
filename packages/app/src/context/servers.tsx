import { createSimpleContext } from "@opencode-ai/ui/context"
import { useServer } from "./server"
import { useServerHealth } from "@/utils/server-health"

export const { use: useServers, provider: ServersProvider } = createSimpleContext({
  name: "Servers",
  init: () => {
    const server = useServer()

    const health = useServerHealth(
      () => server.list,
      () => true,
    )

    return {
      list: () => server.list,
      health,
    }
  },
})
