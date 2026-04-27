import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Match, Show, Switch } from "solid-js"
import { Global } from "@opencode-ai/core/global"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const dir = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    const out = dir.replace(Global.Path.home, "~")
    const branch = props.api.state.vcs?.branch
    if (branch) return out + ":" + branch
    return out
  })

  return <text fg={theme().textMuted}>{dir()}</text>
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

function Workspace(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const workspaceID = createMemo(() => props.api.state.workspace.current())
  const workspaceInfo = createMemo(() => {
    const id = workspaceID()
    return id ? props.api.state.workspace.get(id) : undefined
  })
  const workspaceStatus = createMemo(() => {
    const id = workspaceID()
    return id ? props.api.state.workspace.status(id) : undefined
  })

  return (
    <Show when={workspaceInfo()}>
      <text fg={theme().textMuted}>
        <span style={{ fg: workspaceStatus() === "connected" ? theme().success : theme().error }}>●</span>{" "}
        {workspaceInfo()?.type}: {workspaceInfo()?.name}
      </text>
    </Show>
  )
}

function MultiRootWorkspace(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const workspaceID = createMemo(() => props.api.state.multiRootWorkspace.current())
  const workspaceInfo = createMemo(() => {
    const id = workspaceID()
    return id ? props.api.state.multiRootWorkspace.get(id) : undefined
  })

  return (
    <Show when={workspaceInfo()}>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>◆</span> ws: {workspaceInfo()?.name} ({workspaceInfo()?.folders.length}{" "}
        folder{workspaceInfo()?.folders.length === 1 ? "" : "s"})
      </text>
    </Show>
  )
}

function View(props: { api: TuiPluginApi }) {
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
      <Mcp api={props.api} />
      <Workspace api={props.api} />
      <MultiRootWorkspace api={props.api} />
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

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
