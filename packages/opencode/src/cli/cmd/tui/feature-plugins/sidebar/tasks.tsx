import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { createMemo, For, Show } from "solid-js"

const id = "internal:sidebar-tasks"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const messages = createMemo(() => props.api.state.session.messages(props.session_id))

  const runningTasks = createMemo(() => {
    const result: { description: string; type: string }[] = []
    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      for (const part of props.api.state.part(msg.id)) {
        if (part.type !== "tool" || part.tool !== "task") continue
        const tool = part as ToolPart
        const input = tool.state.input as { description?: string; subagent_type?: string }

        // Task tool part is "running" briefly, then completes with metadata.sessionId
        if (tool.state.status === "running") {
          const type = input.subagent_type ?? "General"
          result.push({
            description: input.description ?? "Task",
            type: type.charAt(0).toUpperCase() + type.slice(1),
          })
          continue
        }

        // Once completed, check if the child session is still busy
        if (tool.state.status === "completed") {
          const childSessionId = (tool.state.metadata as { sessionId?: string })?.sessionId
          if (!childSessionId) continue
          const status = props.api.state.session.status(childSessionId)
          if (!status || status.type !== "busy") continue
          const type = input.subagent_type ?? "General"
          result.push({
            description: input.description ?? "Task",
            type: type.charAt(0).toUpperCase() + type.slice(1),
          })
        }
      }
    }
    return result
  })

  return (
    <Show when={runningTasks().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>Background Tasks ({runningTasks().length})</b>
        </text>
        <For each={runningTasks()}>
          {(task) => (
            <text fg={theme().textMuted} wrapMode="none">
              ⟳ {task.type} — {task.description}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
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
