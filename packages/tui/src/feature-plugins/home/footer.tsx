import type { TuiPlugin, TuiPluginApi } from "@bolt-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Match, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { usePlugin } from "../../plugin/context"
import { Slot } from "../../plugin/render"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const destination = useHomeSessionDestination()
  const paths = useTuiPaths()
  const dir = createMemo(() => {
    const selected = destination?.destination()
    if (!selected || selected.type === "new") return
    const out = abbreviateHome(selected.directory, paths.home)
    const branch =
      selected.directory === (props.api.state.path.directory || paths.cwd) ? props.api.state.vcs?.branch : undefined
    if (branch) return out + ":" + branch
    return out
  })

  return (
    <Show when={dir()}>
      {(value) => (
        <text fg={theme().textMuted} wrapMode="none" flexShrink={1} truncate>
          {value()}
        </text>
      )}
    </Show>
  )
}

function Mcp(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const visibility = createMemo(() => homeFooterVisibility(dimensions().width))
  const list = createMemo(() => props.context.data.location.mcp.server.list(props.context.location) ?? [])
  const failed = createMemo(() => list().filter((item) => item.status.status === "failed").length)
  const count = createMemo(() => list().filter((item) => item.status.status === "connected").length)

  return (
    <Show when={list().length}>
      <box gap={1} flexDirection="row" flexShrink={0} onMouseUp={() => props.context.keymap.dispatch("mcp.list")}>
        <text fg={props.context.theme.text.base}>
          <Switch>
            <Match when={failed()}>
              <span style={{ fg: props.context.theme.text.feedback.error.base }}>⊙ </span>
              {failed()} MCP failed
            </Match>
            <Match when={true}>
              <span
                style={{
                  fg:
                    count() > 0 ? props.context.theme.text.feedback.success.base : props.context.theme.text.muted,
                }}
              >
                ⊙{" "}
              </span>
              {count()} MCP
            </Match>
          </Switch>
        </text>
        <Show when={visibility().mcpCommand}>
          <text fg={props.context.theme.text.muted}>/mcps</text>
        </Show>
      </box>
    </Show>
  )
}

function Lsp(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.lsp())

  return (
    <Show when={list().length > 0}>
      <box flexShrink={0}>
        <text fg={theme().text}>
          <span style={{ fg: theme().success }}>• </span>
          {list().length} LSP
        </text>
      </box>
    </Show>
  )
}

function Version(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current

  return (
    <Show when={failed()}>
      <box gap={1} flexDirection="row" flexShrink={0} onMouseUp={() => props.context.keymap.dispatch("plugins.list")}>
        <text fg={props.context.theme.text.base}>
          <span style={{ fg: props.context.theme.text.feedback.error.base }}>⊙ </span>
          {failed()} plugin{failed() === 1 ? "" : "s"} failed
        </text>
        <Show when={visibility().pluginCommand}>
          <text fg={props.context.theme.text.muted}>/plugins</text>
        </Show>
      </box>
    </Show>
  )
}

function View(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const visibility = createMemo(() => homeFooterVisibility(dimensions().width))

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
      <Directory api={props.api} />
      <Lsp api={props.api} />
      <Mcp api={props.api} />
      <box flexGrow={1} />
      <Version api={props.api} />
    </box>
  )
}

export default Plugin.define({
  id: "opencode.home.footer",
  setup(context) {
    // Root takeover: an external plugin replacing home.footer wins (last-
    // enabled) and this builtin shows as suppressed, not silently gone.
    // Append keeps the path open to additive plugin claims; an external
    // replace still takes the boundary over.
    context.ui.slot({ append: "home.footer", render: () => <View context={context} /> })
  },
})
