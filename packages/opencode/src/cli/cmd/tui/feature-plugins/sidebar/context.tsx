import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import * as Tps from "../../util/tps"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const status = createMemo(() => props.api.state.session.status(props.session_id)?.type ?? "idle")
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const active = createMemo(() => {
    return msg().findLast((item): item is AssistantMessage => item.role === "assistant" && !item.time.completed)
  })

  const [samples, setSamples] = createSignal<Tps.Sample[]>([])
  const [tick, setTick] = createSignal(Date.now())

  createEffect(
    on(
      () => active()?.id,
      () => setSamples([]),
      { defer: true },
    ),
  )

  onMount(() => {
    const off = props.api.event.on("message.part.delta", (evt) => {
      if (evt.properties.sessionID !== props.session_id) return
      if (evt.properties.field !== "text") return
      if (evt.properties.messageID !== active()?.id) return
      setSamples((list) => Tps.append(list, { delta: evt.properties.delta }))
    })
    onCleanup(off)
  })

  createEffect(() => {
    if (status() === "idle") return
    const timer = setInterval(() => setTick(Date.now()), 250)
    onCleanup(() => clearInterval(timer))
  })

  const liveTps = createMemo(() => {
    tick()
    if (status() === "idle") return
    return Tps.live(samples())
  })

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last && !liveTps()) {
      return {
        tokens: 0,
        percent: null,
        tps: undefined,
      }
    }

    if (!last) {
      return {
        tokens: 0,
        percent: null,
        tps: liveTps(),
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const user = msg().find((item) => item.role === "user" && item.id === last.parentID)
    const end = last.time.completed ?? Date.now()
    const tps = liveTps() ?? (user ? Locale.tokensPerSec(last.tokens.output, end - user.time.created) : undefined)
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
      tps,
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      {state().tps ? <text fg={theme().textMuted}>{state().tps}</text> : null}
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
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

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
