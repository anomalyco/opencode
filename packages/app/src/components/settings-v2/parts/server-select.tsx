import { Show, createMemo, type Component } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { useGlobal } from "@/context/global"
import { ServerConnection, serverName } from "@/context/servers"

const allServers = { type: "all" } as const
type ServerOption = ServerConnection.Any | typeof allServers

export const InlineServerSelect: Component<{
  all?: {
    label: string
    selected: () => boolean
    onSelect: () => void
  }
  onServerSelect?: () => void
}> = (props) => {
  const global = useGlobal()
  const options = createMemo<ServerOption[]>(() => [...(props.all ? [allServers] : []), ...global.servers.list()])
  const current = () => (props.all?.selected() ? allServers : global.settings.server.selected())

  return (
    <Show when={options().length > 1}>
      <Select
        data-action="settings-server-select"
        options={options()}
        current={current()}
        value={(server) => (server.type === "all" ? server.type : ServerConnection.key(server))}
        label={(server) =>
          server.type === "all" ? (props.all?.label ?? "") : serverName(server) || ServerConnection.key(server)
        }
        optionDisabled={(server) =>
          server.type === "all" ? false : global.servers.health[ServerConnection.key(server)]?.healthy === false
        }
        placement="bottom-end"
        gutter={6}
        onSelect={(server) => {
          if (!server) return
          if (server.type === "all") {
            props.all?.onSelect()
            return
          }
          global.settings.server.set(ServerConnection.key(server))
          props.onServerSelect?.()
        }}
      />
    </Show>
  )
}
