import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"

const id = "internal:sidebar-git"
const REFRESH_DEBOUNCE_MS = 750
const REFRESH_INTERVAL_MS = 30_000

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const directory = createMemo(() => {
    const session = props.api.state.session.get(props.session_id)
    return session?.directory || props.api.state.path.directory
  })
  const [nonce, setNonce] = createSignal(0)
  const [data] = createResource(
    () => ({ directory: directory(), nonce: nonce() }),
    async (input) => {
      if (!input.directory) return { files: [], ahead: undefined, behind: undefined }
      const [status, info] = await Promise.all([
        props.api.client.vcs.status({ directory: input.directory }).catch(() => undefined),
        props.api.client.vcs.get({ directory: input.directory }).catch(() => undefined),
      ])
      return { files: status?.data ?? [], ahead: info?.data?.ahead, behind: info?.data?.behind }
    },
  )

  const refresh = () => setNonce((value) => value + 1)
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      refresh()
    }, REFRESH_DEBOUNCE_MS)
  }
  const offWatcher = props.api.event.on("file.watcher.updated", schedule)
  const offBranch = props.api.event.on("vcs.branch.updated", refresh)
  const poll = setInterval(refresh, REFRESH_INTERVAL_MS)
  onCleanup(() => {
    offWatcher()
    offBranch()
    clearInterval(poll)
    if (timer) clearTimeout(timer)
  })

  const files = createMemo(() => data()?.files ?? [])
  const changed = createMemo(() => files().length)
  const untracked = createMemo(() => files().filter((item) => item.code === "??").length)
  const insertions = createMemo(() => files().reduce((total, item) => total + item.additions, 0))
  const deletions = createMemo(() => files().reduce((total, item) => total + item.deletions, 0))
  const ahead = createMemo(() => data()?.ahead ?? 0)
  const behind = createMemo(() => data()?.behind ?? 0)
  const sync = createMemo(() => {
    const parts: string[] = []
    if (ahead() > 0) parts.push(`${ahead()} to push`)
    if (behind() > 0) parts.push(`${behind()} to pull`)
    return parts.join(" · ")
  })

  return (
    <Show when={changed() > 0 || sync() !== ""}>
      <box>
        <text fg={theme().text}>
          <b>Git</b>
        </text>
        <text fg={theme().textMuted}>
          <Show when={changed() > 0} fallback="no uncommitted changes">
            {changed()} changed
            <Show when={untracked() > 0}> · {untracked()} untracked</Show>
          </Show>
        </text>
        <Show when={sync() !== ""}>
          <text fg={theme().warning}>{sync()}</text>
        </Show>
        <Show when={insertions() > 0 || deletions() > 0}>
          <box flexDirection="row" gap={1}>
            <Show when={insertions() > 0}>
              <text fg={theme().diffAdded}>+{insertions()}</text>
            </Show>
            <Show when={deletions() > 0}>
              <text fg={theme().diffRemoved}>-{deletions()}</text>
            </Show>
          </box>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
