import { createData } from "@opencode-ai/client/solid"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useLog } from "./log"

export { locationKey } from "@opencode-ai/client/solid"
export type { FormWithLocation } from "@opencode-ai/client/solid"

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: { directory: string }) => {
    const client = useClient()
    const log = useLog({ component: "prompt" })
    const data = createData({
      api: () => client.api,
      event: client.event,
      connection: client.connection,
      directory: props.directory,
      log,
    })
    data satisfies Plugin.Context["data"]
    const [generatingTitles, setGeneratingTitles] = createStore<Record<string, boolean | undefined>>({})
    return {
      ...data,
      session: {
        ...data.session,
        title: {
          pending: (sessionID: string) => generatingTitles[sessionID] === true,
          async generate(sessionID: string) {
            if (generatingTitles[sessionID]) return
            setGeneratingTitles(sessionID, true)
            await client.api.session
              .rename({ sessionID, title: "" })
              .then(() => {
                // The HTTP response can beat the renamed event. Keep pending until the new title is projected locally.
                data.session.invalidate(sessionID)
                return data.session.sync(sessionID)
              })
              .finally(() => setGeneratingTitles(sessionID, undefined))
          },
        },
      },
    }
  },
})
