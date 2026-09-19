import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function computeContextState(
  last: AssistantMessage,
  contextLimit?: number,
) {
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  const totalInput = last.tokens.input + last.tokens.cache.read
  return {
    tokens,
    input: last.tokens.input,
    cache: last.tokens.cache.read,
    cachePercent: totalInput > 0 ? Math.round(last.tokens.cache.read / totalInput * 100) : 0,
    percent: contextLimit ? Math.round((tokens / contextLimit) * 100) : null,
  }
}

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
        input: 0,
        cache: 0,
        cachePercent: null,
        percent: null,
      }
    }

    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return computeContextState(last, model?.limit.context)
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens ({state().percent ?? 0}%)</text>
      <Show when={state().input > 0 || state().cache > 0}>
        <text fg={theme().textMuted}>Input {Locale.number(state().input)} · Cache {Locale.number(state().cache)}</text>
        <text fg={theme().textMuted}>{state().cachePercent}% cached</text>
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
