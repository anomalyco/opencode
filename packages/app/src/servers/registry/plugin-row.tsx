import { untrack } from "solid-js"
import type { ServerRow } from "@opencode/plugin/gui"
import { Contribution } from "@/runtime/plugin/render"
import { usePluginServers } from "@/runtime/plugin/servers"
import type { ServerHealth } from "@/runtime/server/health-machine"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerCollectionController } from "./controller"
import { ServerHealthIndicator } from "./row"
import { ServerRowItems } from "./row-items"

type PluginHealth = ReturnType<ServerRow["health"]>

type PluginIndicator = Parameters<ServerRow["Indicator"]>[0]

/** A contributed server's connection row; the plugin renders it with the host's shared parts. */
export function PluginServerRow(props: { server: ServerConnection.Key; controller: ServerCollectionController }) {
  const servers = usePluginServers()
  // The entry changes with every state update; its row follows the plugin's state on its own.
  const source = untrack(() => servers.entry(props.server))

  const row: ServerRow = {
    key: props.server,
    health: () => toPluginHealth(props.controller.collection.health()[props.server]),
    Indicator: (indicator) => <ServerHealthIndicator health={fromPluginIndicator(indicator)} />,
    remove: () => props.controller.connection.remove(props.server),
    Items: () => <ServerRowItems server={props.server} />,
  }

  if (!source) return null

  return <Contribution plugin={source.plugin}>{() => untrack(() => source.entry.row?.(row))}</Contribution>
}

// The SDK's health has no stages: a server that is not ready, or not checked yet, reports none.
function toPluginHealth(health: ServerHealth | undefined): PluginHealth {
  if (health?.type === "healthy") return { healthy: true, version: health.version }

  if (health?.type === "checking") return health.managed ? { healthy: false, checking: true } : undefined

  if (health?.type === "unreachable" || health?.type === "unauthorized") return { healthy: false }

  if (health?.type === "incompatible") return { healthy: false, incompatible: true }

  return undefined
}

function fromPluginIndicator(indicator: PluginIndicator): ServerHealth | undefined {
  if (indicator.auth) return { type: "auth" }

  if (indicator.connecting || indicator.health?.checking) return { type: "starting" }

  if (indicator.health?.incompatible) return { type: "incompatible" }

  if (indicator.health === undefined) return undefined

  return indicator.health.healthy ? { type: "healthy", version: indicator.health.version } : { type: "unreachable" }
}
