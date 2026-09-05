import { createData, type CreateDataInput, type Data } from "@opencode-ai/client/solid"
import type { LocationRef, OpenCodeEvent } from "@opencode-ai/client/promise"
import { onCleanup } from "solid-js"
import { pathKey } from "@/workspaces/path-key"

type DataEvent = { name: OpenCodeEvent["type"]; details: OpenCodeEvent }

const key = (location: LocationRef) => JSON.stringify([pathKey(location.directory), location.workspaceID])

export function createAppData(input: CreateDataInput) {
  const owners = new Map<string, number>()
  const pending = new Map<string, DataEvent>()
  const data: Data = createData({
    ...input,
    event: {
      ...input.event,
      listen: (handler) =>
        input.event.listen((event) => {
          const info = event.details
          if (!info.location || (info.type !== "mcp.status.changed" && info.type !== "mcp.resources.changed")) {
            handler(event)
            return
          }

          const resource = info.type === "mcp.status.changed" ? data.location.mcp.server : data.location.mcp.resource
          // Keep unopened catalogs stale without booting their Location just to refresh the UI.
          resource.invalidate(info.location)
          if (!owners.has(key(info.location))) return

          if (pending.size === 0) {
            queueMicrotask(() => {
              const events = [...pending.values()]
              pending.clear()
              for (const event of events) {
                const location = event.details.location
                if (location && owners.has(key(location))) handler(event)
              }
            })
          }
          // A server may publish several MCP changes in one event-stream batch; one catalog read suffices.
          pending.set(`${key(info.location)}:${info.type}`, event)
        }),
    },
  })
  onCleanup(() => {
    pending.clear()
    owners.clear()
  })

  return {
    ...data,
    location: {
      ...data.location,
      retain(location: LocationRef) {
        const id = key(location)
        if (!owners.has(id)) {
          // Reopening a view also refreshes requested-path aliases of the server's event Location.
          data.location.mcp.server.invalidate(location)
          data.location.mcp.resource.invalidate(location)
        }
        owners.set(id, (owners.get(id) ?? 0) + 1)
        return () => {
          const count = owners.get(id) ?? 0
          if (count > 1) {
            owners.set(id, count - 1)
            return
          }
          owners.delete(id)
        }
      },
    },
  }
}
