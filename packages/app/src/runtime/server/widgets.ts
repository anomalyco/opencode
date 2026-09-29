import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, onCleanup } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"

/**
 * Loads the widgets for a location and keeps them fresh when the widgets
 * directory changes on disk. The server watches that directory and publishes
 * `widget.updated`, so a widget dropped on disk appears without a restart.
 */
export function useWidgetsQuery(input: { directory?: string; key?: string } = {}) {
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const queryClient = useQueryClient()

  const directory = () => input.directory ?? location().directory
  const queryKey = () => [server.scope, input.key ?? "widgets", directory()]

  const query = useQuery(() => ({
    queryKey: queryKey(),
    enabled: server.connection.status() === "connected",
    queryFn: () => server.api.widget.list({ location: { directory: directory() } }),
  }))

  createEffect(() => {
    const dir = directory()
    onCleanup(server.event.location(dir).on("widget.updated", () => void queryClient.invalidateQueries({ queryKey: queryKey() })))
  })

  return query
}
