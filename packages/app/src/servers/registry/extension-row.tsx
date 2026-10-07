import { untrack } from "solid-js"
import type { ServerRow } from "@opencode/gui-extensions/sdk"
import { Contribution } from "@/runtime/extension/render"
import { useExtensionServers } from "@/runtime/extension/servers"
import type { ServerConnection } from "@/runtime/server/registry"
import type { ServerCollectionController } from "./controller"
import { ServerHealthIndicator } from "./row"
import { ServerRowItems } from "./row-items"

/** A contributed server's connection row; the extension renders it with the host's shared parts. */
export function ExtensionServerRow(props: { server: ServerConnection.Key; controller: ServerCollectionController }) {
  const servers = useExtensionServers()
  // The entry changes with every state update; its row follows the extension's state on its own.
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

  return <Contribution extension={source.extension}>{() => untrack(() => source.entry.row?.(row))}</Contribution>
}
