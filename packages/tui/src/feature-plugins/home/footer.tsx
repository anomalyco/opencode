import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { createMemo, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { abbreviateHome } from "../../runtime"
import { FilePath } from "../../ui/file-path"

function Directory(props: { context: Plugin.Context; maxWidth: number }) {
  const { themeV2 } = useTheme()
  const paths = useTuiPaths()
  const directory = createMemo(() =>
    props.context.location ? abbreviateHome(props.context.location.directory, paths.home) : undefined,
  )

  return (
    <Show when={directory()}>
      {(value) => <FilePath value={value()} maxWidth={props.maxWidth} fg={themeV2.text.subdued()} />}
    </Show>
  )
}

function Mcp(props: { context: Plugin.Context }) {
  const { themeV2 } = useTheme()
  const list = createMemo(() => props.context.data.location.mcp.server.list(props.context.location) ?? [])
  const failed = createMemo(() => list().some((item) => item.status.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status.status === "connected").length)

  return (
    <Show when={list().length}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={themeV2.text()}>
          <Switch>
            <Match when={failed()}>
              <span style={{ fg: themeV2.text.feedback.error() }}>⊙ </span>
            </Match>
            <Match when={true}>
              <span style={{ fg: count() > 0 ? themeV2.text.feedback.success() : themeV2.text.subdued() }}>
                ⊙{" "}
              </span>
            </Match>
          </Switch>
          {count()} MCP
        </text>
        <text fg={themeV2.text.subdued()}>/status</text>
      </box>
    </Show>
  )
}

function View(props: { context: Plugin.Context }) {
  const { themeV2 } = useTheme()
  const dimensions = useTerminalDimensions()
  const mcpWidth = createMemo(() => {
    const list = props.context.data.location.mcp.server.list(props.context.location) ?? []
    if (list.length === 0) return 0
    const count = list.filter((item) => item.status.status === "connected").length
    return Bun.stringWidth(`⊙ ${count} MCP /status`) + 2
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
        maxWidth={Math.max(2, dimensions().width - 8 - Bun.stringWidth(InstallationVersion) - mcpWidth())}
      />
      <Mcp context={props.context} />
      <box flexGrow={1} />
      <box flexShrink={0}>
        <text fg={themeV2.text.subdued()}>{InstallationVersion}</text>
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
