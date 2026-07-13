import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { Tips } from "./tips-view"
import { useBindings } from "../../keymap"
import { useData } from "../../context/data"
import { hasConnectedProvider } from "../../util/connected-provider"
import { useConfig } from "../../config"

const id = "internal:home-tips"

function View(props: { api: TuiPluginApi; hidden: boolean; show: boolean; connected: boolean }) {
  const config = useConfig()
  useBindings(() => ({
    commands: [
      {
        name: "tips.toggle",
        title: props.hidden ? "Show tips" : "Hide tips",
        category: "System",
        namespace: "palette",
        hidden: true,
        run() {
          void config
            .update((draft) => {
              draft.hints = { ...draft.hints, tips: props.hidden }
            })
            .catch(() => {})
          props.api.ui.dialog.clear()
        },
      },
    ],
    bindings: props.api.tuiConfig.keybinds.get("tips.toggle"),
  }))

  return (
    <box width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
      <Show when={props.show}>
        <Tips api={props.api} connected={props.connected} />
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const data = useData()
        const config = useConfig().data
        const hidden = createMemo(() => !(config.hints?.tips ?? true))
        const first = createMemo(() => api.state.session.count() === 0)
        const connected = createMemo(() => hasConnectedProvider(data.location.integration.list() ?? []))
        const show = createMemo(() => (!first() || !connected()) && !hidden())
        return <View api={api} hidden={hidden()} show={show()} connected={connected()} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
