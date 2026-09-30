import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, onCleanup } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { useOptionalWorkspaceLocation } from "@/workspaces/location"

/**
 * Loads the widgets for a location and keeps them fresh when the widgets
 * directory changes on disk. The server watches that directory and publishes
 * `widget.updated`, so a widget dropped on disk appears without a restart.
 *
 * The Location context is optional: the session panel and project settings run
 * under a LocationProvider, while server-level settings pass an explicit
 * directory (or none for the server-wide list).
 */
export function useWidgetsQuery(input: { directory?: string; key?: string } = {}) {
  const server = useServerSDK()
  const location = useOptionalWorkspaceLocation()
  const queryClient = useQueryClient()

  const directory = () => input.directory ?? location?.().directory
  const queryKey = () => [server.scope, input.key ?? "widgets", directory()]

  const query = useQuery(() => ({
    queryKey: queryKey(),
    enabled: server.connection.status() === "connected",
    queryFn: () => server.api.widget.list({ location: { directory: directory() } }),
  }))

  createEffect(() => {
    const dir = directory()
    const events = dir === undefined ? server.event : server.event.location(dir)
    onCleanup(events.on("widget.updated", () => void queryClient.invalidateQueries({ queryKey: queryKey() })))
  })

  return query
}
