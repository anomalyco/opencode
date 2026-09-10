import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import type { InputRenderable } from "@opentui/core"
import { createMemo, createSignal, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const BUDGET_STEP = 0.25

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)
  const budget = createMemo(() => session()?.budget)

  const [editing, setEditing] = createSignal(false)
  let input: InputRenderable | undefined

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

  const saveBudget = (value: number | undefined) => {
    void props.api.client.session.update({
      sessionID: props.session_id,
      budget: value ?? null,
    })
  }

  const startEditing = () => {
    setEditing(true)
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
    }, 1)
  }

  const adjust = (direction: "up" | "down") => {
    const current = budget()
    const next =
      (current ?? Math.max(cost() + BUDGET_STEP, BUDGET_STEP)) + (direction === "up" ? BUDGET_STEP : -BUDGET_STEP)
    if (next < BUDGET_STEP) {
      if (current !== undefined) saveBudget(undefined)
      return
    }
    saveBudget(next)
  }

  const budgetLabel = createMemo(() => {
    const value = budget()
    return value !== undefined ? `${money.format(value)} budget` : "unlimited budget"
  })
  const exceeded = createMemo(() => {
    const value = budget()
    return value !== undefined && cost() >= value
  })
  const budgetColor = createMemo(() => (exceeded() ? theme().error : theme().textMuted))

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      <Show
        when={!editing()}
        fallback={
          <input
            value={budget()?.toString() ?? ""}
            placeholder="amount, e.g. 5"
            placeholderColor={theme().textMuted}
            focusedBackgroundColor={theme().backgroundPanel}
            focusedTextColor={theme().text}
            cursorColor={theme().primary}
            onSubmit={() => {
              const parsed = Number.parseFloat(input?.value ?? "")
              saveBudget(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined)
              setEditing(false)
            }}
            onKeyDown={(event) => {
              if (event.name === "escape") setEditing(false)
            }}
            ref={(ref) => (input = ref)}
          />
        }
      >
        <box
          onMouseScroll={(event) => {
            if (event.scroll?.direction === "up") adjust("up")
            else if (event.scroll?.direction === "down") adjust("down")
          }}
          onMouseUp={() => startEditing()}
        >
          <text fg={budgetColor()}>
            {money.format(cost())} / {budgetLabel()}
          </text>
        </box>
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
