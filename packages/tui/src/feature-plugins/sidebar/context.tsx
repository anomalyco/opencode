import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const [sessionCost, setSessionCost] = createSignal<number>()
  const cost = createMemo(() => sessionCost() ?? session()?.cost ?? 0)
  const [todayCost, setTodayCost] = createSignal<number>()

  const refreshCosts = async () => {
    const [sessionResult, todayResult] = await Promise.all([
      props.api.client.v2.session.get({ sessionID: props.session_id }).catch(() => undefined),
      props.api.tuiConfig.show_today_cost ? props.api.client.v2.session.cost().catch(() => undefined) : undefined,
    ])
    const currentSessionCost = sessionResult?.data?.data.cost
    if (currentSessionCost !== undefined) setSessionCost(currentSessionCost)
    if (todayResult?.data?.data !== undefined) setTodayCost(todayResult.data.data)
  }

  createEffect(() => {
    session()
    void refreshCosts()
  })

  onMount(() => {
    const interval = setInterval(refreshCosts, 30_000)
    onCleanup(() => clearInterval(interval))
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

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      <Show when={props.api.tuiConfig.show_today_cost && todayCost() !== undefined}>
        <text fg={theme().textMuted}>{money.format(todayCost()!)} today</text>
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
