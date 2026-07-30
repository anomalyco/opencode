import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { stringWidth } from "../../util/string-width"
import { FadeFilePath } from "../../ui/fade-file-path"

function Directory(props: { context: Plugin.Context; maxWidth: number }) {
  const directory = createMemo(() =>
    props.context.location ? props.context.ui.format.path(props.context.location.directory) : undefined,
  )

  return (
    <FadeFilePath
      value={directory()}
      maxWidth={props.maxWidth}
      fg={props.context.theme.text.subdued}
      bg={props.context.theme.background.default}
    />
  )
}

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
  const mcpWidth = createMemo(() => {
    const list = props.context.data.location.mcp.server.list(props.context.location) ?? []
    if (list.length === 0) return 0
    const count = list.filter((item) => item.status.status === "connected").length
    return stringWidth(`⊙ ${count} MCP /status`) + 2
  })

  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
    >
      <Directory
        context={props.context}
        maxWidth={Math.max(2, dimensions().width - 8 - stringWidth(props.context.app.version) - mcpWidth())}
      />
      <Mcp context={props.context} />
      <box flexGrow={1} />
      <box flexShrink={0}>
        <text fg={props.context.theme.text.subdued}>{props.context.app.version}</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.home-footer",
  setup(context) {
    context.ui.slot("home.footer", () => <View context={context} />)
  },
})
