import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const progressBar = createMemo(() => {
    const pct = state().percent ?? 0
    const totalBlocks = 12
    const filled = Math.min(totalBlocks, Math.max(0, Math.round((pct / 100) * totalBlocks)))
    const empty = totalBlocks - filled
    return "█".repeat(filled) + "░".repeat(empty)
  })

  return (
    <box gap={0} paddingTop={1}>
      <text fg={theme().text}>
        <b>Context Buffer</b>
      </text>
      <text fg={theme().primary}>
        <span>[{progressBar()}]</span> <span>{state().percent ?? 0}%</span>
      </text>
      <text fg={theme().textMuted}>
        {state().tokens.toLocaleString()} tokens
      </text>
      <Show when={cost() > 0}>
        <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      </Show>
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
