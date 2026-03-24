import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { session_id: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const msg = createMemo(() => sync.data.message[props.session_id] ?? [])
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null as number | null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  return (
    <box>
      <text fg={theme.text}>
        <b>Context</b>
      </text>
      <text fg={theme.textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme.textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme.textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View session_id={props.session_id} />
      },
    },
  })
}

export default {
  tui,
}
