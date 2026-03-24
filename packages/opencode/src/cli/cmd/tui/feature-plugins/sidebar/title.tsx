import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Show } from "solid-js"

function View(props: { api: TuiPluginApi; title: string; share_url?: string }) {
  const theme = () => props.api.theme.current

  return (
    <box paddingRight={1}>
      <text fg={theme().text}>
        <b>{props.title}</b>
      </text>
      <Show when={props.share_url}>
        <text fg={theme().textMuted}>{props.share_url}</text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_title(_ctx, props) {
        return <View api={api} title={props.title} share_url={props.share_url} />
      },
    },
  })
}

export default {
  tui,
}
