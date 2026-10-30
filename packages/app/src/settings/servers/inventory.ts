import { createMemo } from "solid-js"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { usePluginServers, type PluginServer } from "@/runtime/plugin/servers"
import type { ServerHealth } from "@/runtime/server/health"

export type SettingsServer = {
  key: ServerConnection.Key
  name: string
  connection?: ServerConnection.Any
  /** The plugin entry of a contributed server, e.g. SSH or WSL. */
  source?: PluginServer
}

export function settingsServers(
  connections: readonly ServerConnection.Any[],
  sources: readonly PluginServer[],
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
    ...sources.flatMap((item): SettingsServer[] =>
      connected.has(item.key)
        ? []
        : [{ key: ServerConnection.Key.make(item.key), name: item.entry.name, source: item }],
    ),
  ]
}

// A restored settings route must not be redirected against a partial list: contributed servers load asynchronously.
export function useSettingsServersLoaded() {
  const servers = useServers()
  const plugins = usePluginServers()

  return () => servers.hydrated() && plugins.ready()
}

export function useSettingsServers() {
  const servers = useServers()
  const plugins = usePluginServers()

  return createMemo(() => settingsServers(servers.list, plugins.entries(), servers.label))
}

/** Whether a server's pages can load: it runs and its last health check did not fail. */
export function settingsServerReachable(server: SettingsServer, health: ServerHealth | undefined) {
  return !!server.connection && health?.healthy !== false
}
