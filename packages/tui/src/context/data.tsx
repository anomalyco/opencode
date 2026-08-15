import { createServerData } from "@opencode-ai/client/solid"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"

export { locationKey } from "@opencode-ai/client/solid"
export type { FormWithLocation } from "@opencode-ai/client/solid"

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: () => {
    const client = useClient()
    const data = createServerData({
      api: () => client.api,
      event: client.event,
      connection: client.connection,
      directory: process.cwd(),
    })
    data satisfies Plugin.Context["data"]
    return data
  },
})
