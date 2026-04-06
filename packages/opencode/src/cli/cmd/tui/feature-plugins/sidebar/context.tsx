import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"
import { show as showViewer } from "./context-viewer"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function counts(parts: readonly Part[]) {
  let tools = 0
  let errors = 0
  let files = 0
  for (const p of parts) {
    if (p.type === "tool") {
      tools++
      if (p.state.status === "error") errors++
      if (p.state.status === "completed" && (p.tool === "read" || p.tool === "glob" || p.tool === "grep")) files++
    }
  }
  return { tools, errors, files }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

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

  const stats = createMemo(() => {
    const all = msg()
    let tools = 0
    let errors = 0
    let files = 0
    for (const m of all) {
      const c = counts(props.api.state.part(m.id))
      tools += c.tools
      errors += c.errors
      files += c.files
    }
    return { messages: all.length, tools, errors, files }
  })

  return (
    <box onMouseDown={() => props.api.command.trigger("session.context_panel.toggle")}>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>
        {state().tokens.toLocaleString()} tokens · {state().percent ?? 0}% used
      </text>
      <text fg={theme().textMuted}>
        {stats().messages} msgs · {stats().tools} tools{stats().errors > 0 ? ` · ${stats().errors} err` : ""}
        {stats().files > 0 ? ` · ${stats().files} reads` : ""}
      </text>
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

  api.command.register(() => [
    {
      title: "View context",
      value: "context.viewer",
      category: "Session",
      description: "Browse session messages and parts with token estimates",
      slash: { name: "context" },
      onSelect() {
        const route = api.route.current
        if (route.name !== "session") return
        const sessionID = (route.params as { sessionID?: string }).sessionID
        if (!sessionID) return
        showViewer(api, sessionID)
      },
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
