import { createMemo } from "solid-js"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useExtensionServers, type ExtensionServer } from "@/runtime/extension/servers"
import type { ServerHealth } from "@/runtime/server/health"

export type SettingsServer = {
  key: ServerConnection.Key
  name: string
  connection?: ServerConnection.Any
  /** The extension entry of a contributed server, e.g. SSH or WSL. */
  source?: ExtensionServer
}

export function settingsServers(
  connections: readonly ServerConnection.Any[],
  sources: readonly ExtensionServer[],
  label: (connection: ServerConnection.Any) => string,
) {
  const byKey = new Map(sources.map((item) => [item.key, item]))
  const connected = new Set<string>(connections.map(ServerConnection.key))

  return [
    ...connections.map((connection): SettingsServer => {
      const key = ServerConnection.key(connection)
      const source = byKey.get(key)

      return {
        key,
        name: source?.entry.name ?? (label(connection) || key),
        connection: source && source.entry.state !== "ready" ? undefined : connection,
        source,
      }
    }),
    ...sources
      .filter((item) => !connected.has(item.key))
      .map(
        (item): SettingsServer => ({
          key: ServerConnection.Key.make(item.key),
          name: item.entry.name,
          source: item,
        }),
      ),
  ]
}

// A restored settings route must not be redirected against a partial list: contributed servers load asynchronously.
export function useSettingsServersLoaded() {
  const servers = useServers()
  const extensions = useExtensionServers()

  return () => servers.hydrated() && extensions.ready()
}

export function useSettingsServers() {
  const servers = useServers()
  const extensions = useExtensionServers()

  return createMemo(() => settingsServers(servers.list, extensions.entries(), servers.label))
}

/** Whether a server's pages can load: it runs and its last health check did not fail. */
export function settingsServerReachable(server: SettingsServer, health: ServerHealth | undefined) {
  return !!server.connection && health?.healthy !== false
}
