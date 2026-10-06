import { Menu } from "@opencode/ui/menu"
import { For } from "solid-js"
import { useServerRowItems } from "@/runtime/extension/servers"

/** Extension "server.row" menu items for one server, placed inside that row's menu. */
export function ServerRowItems(props: { server: string }) {
  const items = useServerRowItems(() => props.server)

  return (
    <For each={items()}>
      {(item) => (
        <Menu.Item disabled={item.enabled?.(props.server) === false} onSelect={() => item.run(props.server)}>
          {item.title}
        </Menu.Item>
      )}
    </For>
  )
}
