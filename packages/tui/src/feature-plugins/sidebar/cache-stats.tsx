import type { SessionMessageAssistant, TokenUsageInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"

function rate(tokens: TokenUsageInfo | undefined) {
  if (!tokens) return
  const total = tokens.input + tokens.cache.read + tokens.cache.write
  if (total <= 0) return
  return tokens.cache.read / total
}

function icon(value: number) {
  if (value >= 0.9) return "🔥"
  if (value >= 0.5) return "⚡"
  return "❄️"
}

function count(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return String(value)
}

function money(value: number | undefined) {
  if (!value || value <= 0) return
  return value < 0.01 ? `$${(value * 100).toFixed(2)}c` : `$${value.toFixed(2)}`
}

function lastTurn(context: Plugin.Context, sessionID: string | undefined) {
  if (!sessionID) return
  const message = context.data.session.message
    .list(sessionID)
    .findLast(
      (item): item is SessionMessageAssistant =>
        item.type === "assistant" && Boolean(item.tokens) && rate(item.tokens) !== undefined,
    )
  if (!message?.tokens) return
  return { tokens: message.tokens, cost: message.cost, model: message.model }
}

export function CacheStatsFooter(props: { context: Plugin.Context; sessionID?: string }) {
  const turn = createMemo(() => lastTurn(props.context, props.sessionID))
  const cacheRate = createMemo(() => rate(turn()?.tokens))
  const cost = createMemo(() => money(turn()?.cost))
  const text = createMemo(() => {
    const value = cacheRate()
    return ["cache", value === undefined ? "--" : `${icon(value)} ${(value * 100).toFixed(1)}%`, cost()]
      .filter((item): item is string => Boolean(item))
      .join(" ")
  })

  return <text fg={props.context.theme.text.base}>{text()}</text>
}

export function CacheStatsSidebar(props: { context: Plugin.Context; sessionID: string }) {
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const turn = createMemo(() => lastTurn(props.context, props.sessionID))
  const cacheRate = createMemo(() => rate(turn()?.tokens))
  const cost = createMemo(() => money(turn()?.cost))
  const cache = createMemo(() => {
    const value = cacheRate()
    return value === undefined ? "n/a" : `• ${(value * 100).toFixed(1)}% ${icon(value)} (last turn)`
  })
  const model = createMemo(() => {
    const value = turn()?.model
    return value ? `${value.providerID}/${value.id}` : undefined
  })

  return (
    <box>
      <text fg={props.context.theme.text.base}>
        Cache {cache()}
        <Show when={cost()}>{(value) => <> · {value()}</>}</Show>
      </text>
      <Show when={turn()?.tokens}>
        {(tokens) => (
          <text fg={props.context.theme.text.muted}>
            turn: in {count(tokens().input)} · out {count(tokens().output)} · r {count(tokens().cache.read)} / w{" "}
            {count(tokens().cache.write)}
          </text>
        )}
      </Show>
      <Show when={session()?.tokens}>
        {(tokens) => (
          <>
            <text fg={props.context.theme.text.muted}>
              total: in {count(tokens().input)} · out {count(tokens().output)}
            </text>
            <text fg={props.context.theme.text.muted}>
              total cache: read {count(tokens().cache.read)} · write {count(tokens().cache.write)}
            </text>
          </>
        )}
      </Show>
      <Show when={model()}>{(value) => <text fg={props.context.theme.text.muted}>{value()}</text>}</Show>
    </box>
  )
}

export default Plugin.define({
  // Keep the original external plugin ID so an installed copy replaces this
  // builtin instead of rendering the same statistics twice during migration.
  id: "cache-stats",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <CacheStatsFooter context={context} sessionID={props.sessionID} />,
    })
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <CacheStatsSidebar context={context} sessionID={props.sessionID} />,
    })
  },
})
