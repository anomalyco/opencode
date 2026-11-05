import type { ServerConnection } from "@/runtime/server/registry"

export function replaceServerConnection(
  originalKey: ServerConnection.Key,
  next: ServerConnection.Http,
  operations: {
    removeTabs: (key: ServerConnection.Key) => void
    add: (server: ServerConnection.Http) => ServerConnection.Any | undefined
    remove: (key: ServerConnection.Key) => void
  },
) {
  operations.removeTabs(originalKey)
  const added = operations.add(next)

  if (!added) return
  operations.remove(originalKey)
}
