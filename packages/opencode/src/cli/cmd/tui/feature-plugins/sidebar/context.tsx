import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type MessageItem = {
  role: "assistant" | "user"
}

export function getMessageStats(messages: readonly MessageItem[]) {
  let total = 0
  let user = 0
  let assistant = 0

  for (const item of messages) {
    total += 1
    if (item.role === "user") {
      user += 1
      continue
    }
    assistant += 1
  }

  return { total, user, assistant }
}

const MESSAGE_TOTAL_WIDTH = 28

function StatRow(props: { label: string; value: string; theme: TuiPluginApi["theme"]["current"] }) {
  const label = () => props.label
  const value = () => props.value
  const pad = () => Math.max(0, MESSAGE_TOTAL_WIDTH - label().length - value().length)

  return (
    <text fg={props.theme.textMuted}>
      <span>{label()}</span>
      <span>{" ".repeat(pad())}</span>
      <span>{value()}</span>
    </text>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))
  const messageStats = createMemo(() => getMessageStats(msg()))

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
    <box gap={0}>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <StatRow theme={theme()} label="Total messages" value={messageStats().total.toLocaleString()} />
      <StatRow theme={theme()} label="User messages" value={messageStats().user.toLocaleString()} />
      <StatRow theme={theme()} label="Assistant messages" value={messageStats().assistant.toLocaleString()} />
      <StatRow theme={theme()} label="Tokens" value={state().tokens.toLocaleString()} />
      <StatRow theme={theme()} label="Used" value={`${state().percent ?? 0}%`} />
      <StatRow theme={theme()} label="Spent" value={money.format(cost())} />
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
