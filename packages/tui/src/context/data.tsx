import { createData } from "@opencode/client/solid"
import type { LocationRef } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useRoute } from "./route"

export { locationKey } from "@opencode/client/solid"
export type { FormWithLocation } from "@opencode/client/solid"

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: { directory: string }) => {
    const client = useClient()
    let route: ReturnType<typeof useRoute> | undefined
    try {
      route = useRoute()
    } catch {
      // Allow mounting DataProvider outside RouteProvider in isolated unit tests
    }
    const data = createData({
      api: () => client.api,
      event: client.event,
      connection: client.connection,
      directory: props.directory,
      isFollowed: (sessionID) => (route ? route.data.type === "session" && route.data.sessionID === sessionID : true),
    })
    data satisfies Plugin.Context["data"]
    const [generatingTitles, setGeneratingTitles] = createStore<Record<string, boolean | undefined>>({})
    return {
      ...data,
      location: {
        ...data.location,
        async sync(ref?: LocationRef) {
          await data.location.syncInfo(ref)
          await Promise.all([data.location.sync(ref), data.location.config.sync(ref)])
        },
      },
      session: {
        ...data.session,
        title: {
          pending: (sessionID: string) => generatingTitles[sessionID] === true,
          async generate(sessionID: string) {
            if (generatingTitles[sessionID]) return
            setGeneratingTitles(sessionID, true)
            await client.api.session
              .update({ sessionID, title: "" })
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
