import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))

  // Fetch the cost rollup whenever the session changes; the rollup is
  // refreshed automatically when descendant sessions complete an assistant turn.
  createEffect(() => {
    const id = props.session_id
    if (!id) return
    props.api.state.session.refreshCost(id)
  })

  // Prefer the server-side rollup (which includes the parent's own cost). Fall
  // back to summing local messages so we still render before the first fetch
  // resolves.
  const cost = createMemo(() => {
    const rollup = props.api.state.session.cost(props.session_id)
    if (rollup) return { self: rollup.self, subagents: rollup.subagents, subagent_count: rollup.subagent_count }
    const self = msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    return { self, subagents: 0, subagent_count: 0 }
  })

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

  const costLine = createMemo(() => {
    const c = cost()
    if (c.subagent_count > 0) {
      return `${money.format(c.self)} (${money.format(c.subagents)} subagents) spent`
    }
    return `${money.format(c.self)} spent`
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{costLine()}</text>
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

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
