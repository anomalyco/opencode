import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { readdir, readFile } from "fs/promises"
import path from "path"
import { Process } from "@/util/process"

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

async function countLocUnix(dir: string): Promise<number> {
  const result = await Process.text(["sh", "-c", FIND_CMD], { cwd: dir, nothrow: true })
  const n = parseInt(result.text.trim(), 10)
  return isNaN(n) ? 0 : n
}

async function countLocFallback(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name)) total += await countLocFallback(path.join(dir, entry.name))
        } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
          const buf = await readFile(path.join(dir, entry.name))
          let lines = 1
          for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++
          total += lines
        }
      }),
    )
  } catch {
    // skip unreadable directories
  }
  return total
}

const countLoc = process.platform === "win32" ? countLocFallback : countLocUnix

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  const [loc, setLoc] = createSignal("")

  async function refreshLoc() {
    const cwd = sync.data.path.directory || process.cwd()
    const count = await countLoc(cwd)
    if (count > 0) setLoc(`LOC: ${count.toLocaleString()} (${(count / 37000).toFixed(2)} GT)`)
  }

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    void refreshLoc()
    const locInterval = setInterval(() => void refreshLoc(), 60_000)

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
      clearInterval(locInterval)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <Show when={loc()}>
          <text fg={theme.textMuted}>{loc()}</text>
        </Show>
      </box>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
