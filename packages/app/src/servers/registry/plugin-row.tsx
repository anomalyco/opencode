import { untrack } from "solid-js"
import type { ServerRow } from "@opencode/plugin/gui"
import { Contribution } from "@/runtime/plugin/render"
import { usePluginServers } from "@/runtime/plugin/servers"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerCollectionController } from "./controller"
import { ServerHealthIndicator } from "./row"
import { ServerRowItems } from "./row-items"

/** A contributed server's connection row; the plugin renders it with the host's shared parts. */
export function PluginServerRow(props: { server: ServerConnection.Key; controller: ServerCollectionController }) {
  const servers = usePluginServers()
  // The entry changes with every state update; its row follows the plugin's state on its own.
  const source = untrack(() => servers.entry(props.server))

  const row: ServerRow = {
    key: props.server,
    health: () => props.controller.collection.health()[props.server],
    Indicator: (indicator) => (
      <ServerHealthIndicator
        health={indicator.health}
        connecting={indicator.connecting}
        authenticationRequired={indicator.auth}
      />
    ),
    remove: () => props.controller.connection.remove(props.server),
    Items: () => <ServerRowItems server={props.server} />,
  }

  if (!source) return null

  return <Contribution plugin={source.plugin}>{() => untrack(() => source.entry.row?.(row))}</Contribution>
}
