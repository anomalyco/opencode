import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"

function Mcp(props: { context: Plugin.Context }) {
  const list = createMemo(() => props.context.data.location.mcp.server.list(props.context.location) ?? [])
  const failed = createMemo(() => list().some((item) => item.status.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status.status === "connected").length)

  return (
    <Show when={list().length}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={props.context.theme.text.default}>
          <Switch>
            <Match when={failed()}>
              <span style={{ fg: props.context.theme.text.feedback.error.default }}>⊙ </span>
            </Match>
            <Match when={true}>
              <span
                style={{
                  fg:
                    count() > 0 ? props.context.theme.text.feedback.success.default : props.context.theme.text.subdued,
                }}
              >
                ⊙{" "}
              </span>
            </Match>
          </Switch>
          {count()} MCP
        </text>
        <text fg={props.context.theme.text.subdued}>/status</text>
      </box>
    </Show>
  )
}

function View(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()

  return (
    <Show when={dimensions().height >= 12 && dimensions().width >= 44}>
      <box
        width="100%"
        paddingTop={dimensions().height < 16 ? 0 : 1}
        paddingBottom={dimensions().height < 16 ? 0 : 1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        flexShrink={0}
        gap={2}
      >
        <Mcp context={props.context} />
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={props.context.theme.text.subdued}>{props.context.app.version}</text>
        </box>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.home-footer",
  setup(context) {
    // Root takeover: an external plugin replacing home.footer wins (last-
    // enabled) and this builtin shows as suppressed, not silently gone.
    // Append keeps the path open to additive plugin claims; an external
    // replace still takes the boundary over.
    context.ui.slot({ append: "home.footer", render: () => <View context={context} /> })
  },
})
