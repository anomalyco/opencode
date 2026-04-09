import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Global } from "@/global"
import { Process } from "@/util/process"

const id = "internal:home-footer"

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "__pycache__",
  ".gradle",
  "Pods",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "venv",
  ".venv",
  "vendor",
  ".yarn",
  "coverage",
  ".nyc_output",
  ".terraform",
  ".tox",
  ".cache",
])

const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
])

const FIND_PRUNE = [...EXCLUDED_DIRS].map((d) => `-name "${d}"`).join(" -o ")
const FIND_NAMES = [...SOURCE_EXTS].map((e) => `-name "*${e}"`).join(" -o ")
const FIND_CMD = `find . \\( ${FIND_PRUNE} \\) -prune -o -type f \\( ${FIND_NAMES} \\) -print | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'`

async function countLoc(dir: string): Promise<number> {
  const result = await Process.text(["sh", "-c", FIND_CMD], { cwd: dir, nothrow: true })
  const n = parseInt(result.text.trim(), 10)
  return isNaN(n) ? 0 : n
}

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

function Loc(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [loc, setLoc] = createSignal("")
  const dir = () => props.api.state.path.directory || process.cwd()

  async function refreshLoc() {
    const count = await countLoc(dir())
    if (count > 0) setLoc(`LOC: ${count.toLocaleString()} (${(count / 37000).toFixed(2)} GT)`)
  }

  onMount(() => {
    void refreshLoc()
    const interval = setInterval(() => void refreshLoc(), 60_000)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <Show when={loc()}>
      <text fg={theme().textMuted}>{loc()}</text>
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
      <Loc api={props.api} />
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
