import { createEffect, mapArray, onCleanup } from "solid-js"
import type { Data } from "@opencode-ai/client/solid"
import type { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"

// Every open tab keeps its workspace catalogs resident, so switching between open tabs never
// reloads them. Closing the last tab for a directory releases its catalogs unless a mounted
// consumer such as the current route still holds them.
export function createLocationResidency(input: {
  key: ServerConnection.Key
  tabs: () => readonly Tab[]
  data: Pick<Data, "location"> & { session: Pick<Data["session"], "get"> }
}) {
  createEffect(
    mapArray(
      () => input.tabs().filter((tab) => tab.server === input.key),
      (tab) => {
        createEffect(() => {
          const location =
            tab.type === "draft" ? { directory: tab.directory } : input.data.session.get(tab.sessionId)?.location
          if (!location) return
          onCleanup(input.data.location.retain(location))
        })
      },
    ),
  )
}
