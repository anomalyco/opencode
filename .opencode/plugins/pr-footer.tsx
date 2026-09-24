/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

type PR = { number: number; url: string }
const cache = new Map<string, PR | undefined>()

async function lookup(directory: string, branch: string, isCancelled: () => boolean) {
  const key = `${directory}:${branch}`
  if (cache.has(key)) return cache.get(key)
  try {
    const proc = Bun.spawn(["gh", "pr", "view", "--json", "number,url"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "ignore",
    })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) return undefined
    const parsed = JSON.parse(out) as PR
    if (!isCancelled()) cache.set(key, parsed)
    return parsed
  } catch {
    return undefined // gh missing, not a repo, no auth, no PR
  }
}

function openInBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
  Bun.spawn([command, url], { stdout: "ignore", stderr: "ignore" })
}

function View(props: { api: TuiPluginApi }) {
  const [pr, setPr] = createSignal<PR | undefined>()
  createEffect(() => {
    const directory = props.api.state.path.directory
    const branch = props.api.state.vcs?.branch
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    if (!directory || !branch) {
      setPr(undefined)
      return
    }
    setPr(cache.get(`${directory}:${branch}`))
    lookup(directory, branch, () => cancelled).then((next) => {
      if (!cancelled) setPr(next)
    })
  })
  return (
    <Show when={pr()}>
      {(value) => (
        <text fg={props.api.theme.current.textMuted} onMouseDown={() => openInBrowser(value().url)}>
          #{value().number}
        </text>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    slots: { app_bottom: () => <View api={api} /> },
  })
}

const plugin: TuiPluginModule & { id: string } = { id: "local.pr-footer", tui }
export default plugin
