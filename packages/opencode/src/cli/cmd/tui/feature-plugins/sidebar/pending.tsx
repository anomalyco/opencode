import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-pending"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const pendingKnown = createMemo(() => props.api.state.session.pendingKnown(props.session_id))
  const pending = createMemo(() => props.api.state.session.pending(props.session_id))
  const counts = createMemo(() => {
    const snapshot = pending()
    return {
      steer: snapshot?.steer.length ?? 0,
      queue: snapshot?.queue.length ?? 0,
    }
  })
  const total = createMemo(() => counts().steer + counts().queue)
  const status = createMemo(() => {
    const snapshot = pending()
    if (snapshot?.paused && total() > 0) return "  Paused"
    return ""
  })

  return (
    <Show when={pendingKnown() && total() > 0}>
      <box>
        <text fg={theme().text}>
          <b>Pending</b>
        </text>
        <text fg={theme().textMuted}>
          {` Steer ${counts().steer}  Queue ${counts().queue}`}
          {status()}
        </text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.command.register(() => {
    const current = api.route.current
    const sessionID =
      current.name === "session" && typeof current.params?.sessionID === "string"
        ? current.params.sessionID
        : undefined
    const snapshot = sessionID ? api.state.session.pending(sessionID) : undefined
    const canResume = !!sessionID && !!snapshot?.paused && snapshot.steer.length === 0 && snapshot.queue.length > 0
    return [
      {
        title: "Resume pending follow-ups",
        value: "session.pending.resume",
        category: "Session",
        hidden: !canResume,
        async onSelect() {
          if (!sessionID) return
          const result = await api.client.session.pendingResume({ sessionID })
          if (result.error) {
            const errorData = "data" in result.error ? result.error.data : undefined
            const message =
              typeof errorData === "object" &&
              errorData !== null &&
              "message" in errorData &&
              typeof errorData.message === "string"
                ? errorData.message
                : "Failed to resume pending follow-ups"
            api.ui.toast({
              variant: "error",
              message,
            })
            return
          }
          api.ui.dialog.clear()
        },
      },
    ]
  })

  api.slots.register({
    order: 410,
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
