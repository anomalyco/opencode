import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo } from "solid-js"

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

  const cumulative = createMemo(() => {
    const msgs = msg()
    let input = 0
    let output = 0
    let totalTime = 0
    for (const m of msgs) {
      if (m.role === "assistant") {
        input += m.tokens.input + m.tokens.cache.read + m.tokens.cache.write
        output += m.tokens.output + m.tokens.reasoning
        if (m.time.completed) totalTime += m.time.completed - m.time.created
      }
    }
    return { input, output, duration: totalTime }
  })

  const lastQueryTime = createMemo(() => {
    const msgs = msg()
    const lastAssistantIdx = msgs.findLastIndex((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (lastAssistantIdx === -1) return 0
    const lastAssistant = msgs[lastAssistantIdx] as AssistantMessage
    const prevUser = msgs.slice(0, lastAssistantIdx).findLast((item) => item.role === "user")
    const start = prevUser ? prevUser.time.created : lastAssistant.time.created
    return (lastAssistant.time.completed ?? lastAssistant.time.created) - start
  })

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      <text fg={theme().text}>
        <b>Cumulative</b>
      </text>
      <text fg={theme().textMuted}>↑ {cumulative().input.toLocaleString()} in</text>
      <text fg={theme().textMuted}>↓ {cumulative().output.toLocaleString()} out</text>
      <text fg={theme().textMuted}>⏱ {formatDuration(lastQueryTime())} last query</text>
      <text fg={theme().textMuted}>⏱ {formatDuration(cumulative().duration)} total</text>
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
