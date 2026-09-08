import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { createEffect, onCleanup } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { SessionModel } from "./model"

export function createSessionSummary(session: SessionModel) {
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({ open: false })
  const key = () => [server.scope, "session-details", session.workspace.directory()]
  const query = createQuery(() => ({
    queryKey: key(),
    enabled: state.open && server.connection.status() === "connected" && !!session.project()?.vcs,
    queryFn: () =>
      server.api.vcs
        .diff({ location: { directory: session.workspace.directory() }, mode: "working" })
        .then((result) => result.data),
  }))
  createEffect(() => {
    onCleanup(
      location().event.listen((event) => {
        if (event.type === "filesystem.changed") void queryClient.invalidateQueries({ queryKey: key() })
      }),
    )
  })
  return { diffs: () => query.data, setOpen: (value: boolean) => setState("open", value) }
}
