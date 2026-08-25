import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, For, Match, Show, Switch, createSignal } from "solid-js"
import { DialogMcp } from "../../component/dialog-mcp"

function View(props: { context: Plugin.Context; sessionID: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = props.context.theme
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const list = createMemo(() => props.context.data.location.mcp.server.list(session()?.location) ?? [])
  const on = createMemo(() => list().filter((item) => item.status.status === "connected").length)
  const bad = createMemo(
    () => list().filter((item) => item.status.status === "failed" || item.status.status === "needs_auth").length,
  )

  const dot = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.default
    if (status === "failed") return theme.text.feedback.error.default
    if (status === "disabled") return theme.text.subdued
    if (status === "needs_auth") return theme.text.feedback.warning.default
    return theme.text.subdued
  }

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme.text.default}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.default}>
            <b>MCP</b>
            <Show when={!open()}>
              <span style={{ fg: theme.text.subdued }}>
                {" "}
                ({on()} active{bad() > 0 ? `, ${bad()} error${bad() > 1 ? "s" : ""}` : ""})
              </span>
            </Show>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
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
                <text fg={theme.text.default} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                  <b>{item.name}</b>
                </text>
                <text
                  fg={item.status.status === "failed" ? theme.text.feedback.error.default : theme.text.subdued}
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
      render: (props) => <View context={context} sessionID={props.sessionID} />,
    })
  },
})
