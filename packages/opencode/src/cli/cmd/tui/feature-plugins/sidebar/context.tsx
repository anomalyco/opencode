import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { Locale } from "@/util/locale"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const rows = createMemo(() => {
    const cur = props.api.state.session.get(props.session_id)
    if (!cur) return []

    const root = cur.parentID ?? cur.id
    return props.api.state.session
      .list()
      .filter((item) => item.id === root || item.parentID === root)
      .toSorted((a, b) => {
        if (a.id === root) return -1
        if (b.id === root) return 1
        return a.time.created - b.time.created
      })
      .map((item, index) => {
        const msg = props.api.state.session.messages(item.id)
        const last = msg.findLast(
          (entry): entry is AssistantMessage => entry.role === "assistant" && entry.tokens.output > 0,
        )
        const cost = msg.reduce((sum, entry) => sum + (entry.role === "assistant" ? entry.cost : 0), 0)
        const tokens = last
          ? last.tokens.input +
            last.tokens.output +
            last.tokens.reasoning +
            last.tokens.cache.read +
            last.tokens.cache.write
          : 0
        const model = last
          ? props.api.state.provider.find((entry) => entry.id === last.providerID)?.models[last.modelID]
          : undefined
        const name = (() => {
          if (item.id === root) return "Parent"
          const hit = item.title.match(/@(\w+) subagent/)
          if (hit?.[1]) return Locale.titlecase(hit[1])
          return `Child ${index}`
        })()
        return {
          id: item.id,
          name,
          tokens,
          percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
          cost,
        }
      })
  })

  const total = createMemo(() => {
    return rows().reduce(
      (sum, item) => {
        sum.tokens += item.tokens
        sum.cost += item.cost
        return sum
      },
      { tokens: 0, cost: 0 },
    )
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <Show when={rows().length <= 1}>
        <text fg={theme().textMuted}>{Locale.number(total().tokens)} tokens</text>
        <text fg={theme().textMuted}>{rows()[0]?.percent ?? 0}% used</text>
        <text fg={theme().textMuted}>{money.format(total().cost)} spent</text>
      </Show>
      <Show when={rows().length > 1}>
        <text fg={theme().textMuted}>{Locale.number(total().tokens)} tokens total</text>
        <text fg={theme().textMuted}>{money.format(total().cost)} spent</text>
        <box paddingTop={1} gap={1}>
          <For each={rows()}>
            {(item) => (
              <box flexDirection="row" justifyContent="space-between" gap={1}>
                <text fg={theme().text} wrapMode="none">
                  {item.name}
                </text>
                <text fg={theme().textMuted} wrapMode="none">
                  {Locale.number(item.tokens)}
                  <Show when={item.percent !== null}> ({item.percent}%)</Show>
                </text>
              </box>
            )}
          </For>
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

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
