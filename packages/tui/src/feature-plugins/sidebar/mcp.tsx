import { Plugin } from "@opencode/plugin/tui"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { DialogMcp } from "../../component/dialog-mcp"

export function SidebarMcp(props: { context: Plugin.Context; sessionID: string }) {
  const [view, updateView] = props.context.storage.store("view", { initial: { open: true } })
  const theme = props.context.theme
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const list = createMemo(() => props.context.data.location.mcp.server.list(session()?.location) ?? [])
  const on = createMemo(() => list().filter((item) => item.status.status === "connected").length)
  const bad = createMemo(
    () => list().filter((item) => item.status.status === "failed" || item.status.status === "needs_auth").length,
  )

  const dot = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.base
    if (status === "failed") return theme.text.feedback.error.base
    if (status === "disabled") return theme.text.muted
    if (status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => {
            if (list().length <= 2) return
            void updateView((draft) => {
              draft.open = !draft.open
            }).catch((error) => console.error("Failed to persist MCP sidebar state", error))
          }}
        >
          <Show when={list().length > 2}>
            <text fg={theme.text.base}>{view.open ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.base}>
            <b>MCP</b>
            <Show when={!view.open}>
              <span style={{ fg: theme.text.muted }}>
                {" "}
                ({on()} active{bad() > 0 ? `, ${bad()} error${bad() > 1 ? "s" : ""}` : ""})
              </span>
            </Show>
          </text>
        </box>
        <Show when={list().length <= 2 || view.open}>
          <For each={list()}>
            {(item) => (
              <box
                flexDirection="row"
                gap={1}
                minWidth={0}
                onMouseUp={() =>
                  props.context.ui.dialog.show(() => (
                    <DialogMcp initialServer={item.name} details={item.status.status === "failed"} />
                  ))
                }
              >
                <text
                  flexShrink={0}
                  style={{
                    fg: dot(item.status.status),
                  }}
                >
                  •
                </text>
                <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                  <b>{item.name}</b>
                </text>
                <text
                  fg={item.status.status === "failed" ? theme.text.feedback.error.base : theme.text.muted}
                  wrapMode="none"
                  flexShrink={0}
                >
                  <Switch fallback={item.status.status}>
                    <Match when={item.status.status === "connected"}>Connected</Match>
                    <Match when={item.status.status === "pending"}>Connecting</Match>
                    <Match when={item.status.status === "failed"}>Error</Match>
                    <Match when={item.status.status === "disabled"}>Disabled</Match>
                    <Match when={item.status.status === "needs_auth"}>Sign in</Match>
                  </Switch>
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.mcp",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarMcp context={context} sessionID={props.sessionID} />,
    })
  },
})
