import { createMemo } from "solid-js"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { usePluginServers, type PluginServer } from "@/runtime/plugin/servers"
import { useGlobal } from "@/runtime/server/runtime"
import { selectServerIndicator, type ServerHealth } from "@/runtime/server/health-machine"
import {
  resolveServerAvailability,
  selectSettingsServerHealth,
  serverPagesConnection,
  type SettingsServerAvailability,
} from "./machine"

export type SettingsServer = {
  key: ServerConnection.Key
  name: string
  /** The listed connection; a contributed server has it only while its plugin reports it ready. */
  connection?: ServerConnection.Any
  /** The plugin entry of a contributed server, e.g. SSH or WSL. */
  source?: PluginServer
  availability: SettingsServerAvailability
}

export function settingsServers(
  connections: readonly ServerConnection.Any[],
  sources: readonly PluginServer[],
  label: (connection: ServerConnection.Any) => string,
  status: (key: ServerConnection.Key) => { health?: ServerHealth; signedOut?: boolean },
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
        availability: resolveServerAvailability({ connection, source, ...status(key) }),
      }
    }),
    ...sources.flatMap((item): SettingsServer[] => {
      if (connected.has(item.key)) return []
      const key = ServerConnection.Key.make(item.key)

      return [
        {
          key,
          name: item.entry.name,
          source: item,
          availability: resolveServerAvailability({ source: item, ...status(key) }),
        },
      ]
    }),
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
  const global = useGlobal()

  // Health polls rebuild the list; unchanged servers keep their object so lists keyed by it do not remount rows.
  return createMemo<SettingsServer[]>((previous) =>
    settingsServers(servers.list, plugins.entries(), servers.label, (key) => ({
      health: global.servers.health[key],
      signedOut: global.serverSignedOut(key),
    })).map((server) => {
      const kept = previous?.find((item) => item.key === server.key)

      return kept && sameServer(kept, server) ? kept : server
    }),
  )
}

function sameServer(a: SettingsServer, b: SettingsServer) {
  return (
    a.name === b.name &&
    a.connection === b.connection &&
    a.source === b.source &&
    a.availability.status === b.availability.status &&
    serverPagesConnection(a.availability) === serverPagesConnection(b.availability) &&
    indicator(a.availability) === indicator(b.availability)
  )
}

function indicator(availability: SettingsServerAvailability) {
  return selectServerIndicator(selectSettingsServerHealth(availability))
}
