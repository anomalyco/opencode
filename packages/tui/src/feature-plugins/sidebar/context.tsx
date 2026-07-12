import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { useData } from "../../context/data"
import { contextUsage } from "../../util/session"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const data = useData()
  const theme = () => props.api.theme.current
  const msg = createMemo(() => data.session.message.list(props.session_id))
  const session = createMemo(() => data.session.get(props.session_id))
  const cost = createMemo(() => data.session.cost(props.session_id))

  const state = createMemo(() => contextUsage(msg(), data.location.model.list(session()?.location), session()?.revert?.messageID))

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <Show when={state()} fallback={<text fg={theme().textMuted}>Not measured</text>}>
        {(value) => (
          <>
            <text fg={theme().textMuted}>{value().tokens.toLocaleString()} tokens</text>
            <Show when={value().percent !== undefined}>
              <text fg={theme().textMuted}>{value().percent}% used</text>
            </Show>
          </>
        )}
      </Show>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
