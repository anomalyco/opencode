import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Match, Show, Switch } from "solid-js"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { useHomeSessionDestination } from "../../routes/home/session-destination"
import { FilePath } from "../../ui/file-path"
import { useTerminalDimensions } from "@opentui/solid"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi; maxWidth: number }) {
  const theme = () => props.api.theme.current
  const destination = useHomeSessionDestination()
  const paths = useTuiPaths()
  const dir = createMemo(() => {
    const selected = destination?.destination()
    if (!selected || selected.type === "new") return
    const branch =
      selected.directory === (props.api.state.path.directory || paths.cwd) ? props.api.state.vcs?.branch : undefined
    return { path: abbreviateHome(selected.directory, paths.home), branch }
  })

  return (
    <Show when={dir()}>
      {(value) => {
        const suffix = () => (value().branch ? `:${value().branch}` : "")
        const suffixWidth = () => Math.min(Bun.stringWidth(suffix()), Math.max(0, props.maxWidth - 2))
        return (
          <box flexDirection="row" minWidth={0}>
            <FilePath
              value={value().path}
              maxWidth={Math.max(2, props.maxWidth - suffixWidth())}
              fg={theme().textMuted}
            />
            <Show when={suffix()}>
              <text width={suffixWidth()} wrapMode="none" truncate fg={theme().textMuted}>
                {suffix()}
              </text>
            </Show>
          </box>
        )
      }}
    </Show>
  )
}

function Mcp(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const has = createMemo(() => list().length > 0)
  const err = createMemo(() => list().some((item) => item.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status === "connected").length)

  return (
    <Show when={has()}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={theme().text}>
          <Switch>
            <Match when={err()}>
              <span style={{ fg: theme().error }}>⊙ </span>
            </Match>
            <Match when={true}>
              <span style={{ fg: count() > 0 ? theme().success : theme().textMuted }}>⊙ </span>
            </Match>
          </Switch>
          {count()} MCP
        </text>
        <text fg={theme().textMuted}>/status</text>
      </box>
    </Show>
  )
}

function Version(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current

  return (
    <box flexShrink={0}>
      <text fg={theme().textMuted}>{props.api.app.version}</text>
    </box>
  )
}

function View(props: { api: TuiPluginApi }) {
  const dimensions = useTerminalDimensions()
  const mcpWidth = createMemo(() => {
    const list = props.api.state.mcp()
    if (list.length === 0) return 0
    const count = list.filter((item) => item.status === "connected").length
    return Bun.stringWidth(`⊙ ${count} MCP /status`) + 2
  })
  const directoryWidth = createMemo(() =>
    Math.max(2, dimensions().width - 8 - Bun.stringWidth(props.api.app.version) - mcpWidth()),
  )
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
      <Directory api={props.api} maxWidth={directoryWidth()} />
      <Mcp api={props.api} />
      <box flexGrow={1} />
      <Version api={props.api} />
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
