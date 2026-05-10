import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { Show, createMemo } from "solid-js"

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
        cacheInput: 0,
        cacheNew: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cacheHitPercent: null,
        cacheOutput: 0,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const cacheInput = last.tokens.input + last.tokens.cache.read + last.tokens.cache.write
    const cacheHitPercent = cacheInput > 0 ? ((last.tokens.cache.read / cacheInput) * 100).toFixed(1) : null
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
      cacheInput,
      cacheNew: last.tokens.input,
      cacheRead: last.tokens.cache.read,
      cacheWrite: last.tokens.cache.write,
      cacheHitPercent,
      cacheOutput: last.tokens.output,
    }
  })

  return (
    <>
      <box>
        <text fg={theme().text}>
          <b>Context</b>
        </text>
        <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
        <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
        <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      </box>
      <Show when={Flag.OPENCODE_EXPERIMENTAL_CACHE_AUDIT && state().cacheHitPercent != null}>
        <box>
          <text fg={theme().text}><b>Cache Audit</b></text>
          <text fg={theme().textMuted}>{state().cacheInput.toLocaleString()} input tokens</text>
          <text fg={theme().textMuted}>  {state().cacheNew.toLocaleString()} new</text>
          <text fg={theme().textMuted}>  {state().cacheRead.toLocaleString()} cache read</text>
          <text fg={theme().textMuted}>  {state().cacheWrite.toLocaleString()} cache write</text>
          <text fg={theme().textMuted}>{state().cacheHitPercent}% hit rate</text>
          <text fg={theme().textMuted}>{state().cacheOutput.toLocaleString()} output tokens</text>
        </box>
      </Show>
    </>
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

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
