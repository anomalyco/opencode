import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"

const REFRESH_DEBOUNCE_MS = 750
const REFRESH_INTERVAL_MS = 30_000

export function SidebarGit(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const location = createMemo(() => session()?.location ?? props.context.location)

  const [nonce, setNonce] = createSignal(0)
  const [data] = createResource(
    () => ({ location: location(), nonce: nonce() }),
    async (input) => {
      const [status, info] = await Promise.all([
        props.context.client.vcs.status({ location: input.location }).catch(() => undefined),
        props.context.client.vcs.get({ location: input.location }).catch(() => undefined),
      ])
      return {
        files: status?.data ?? [],
        ahead: info?.data?.ahead,
        behind: info?.data?.behind,
      }
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

  const offFilesystem = props.context.data.on("filesystem.changed", schedule)
  const offBranch = props.context.data.on("vcs.branch.updated", refresh)
  const poll = setInterval(refresh, REFRESH_INTERVAL_MS)

  onCleanup(() => {
    offFilesystem()
    offBranch()
    clearInterval(poll)
    if (timer) clearTimeout(timer)
  })

  const files = createMemo(() => data()?.files ?? [])
  const changed = createMemo(() => files().length)
  const untracked = createMemo(() => files().filter((item) => item.untracked).length)
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
  const visible = createMemo(() => changed() > 0 || sync() !== "")

  return (
    <Show when={visible()}>
      <box>
        <text fg={theme.text.base}>
          <b>Git</b>
        </text>
        <text fg={theme.text.muted}>
          <Show when={changed() > 0} fallback="no uncommitted changes">
            {changed()} changed
            <Show when={untracked() > 0}> · {untracked()} untracked</Show>
          </Show>
        </text>
        <Show when={sync() !== ""}>
          <text fg={theme.text.feedback.warning.base}>{sync()}</text>
        </Show>
        <Show when={insertions() > 0 || deletions() > 0}>
          <box flexDirection="row" gap={1}>
            <Show when={insertions() > 0}>
              <text fg={theme.diff.text.added}>+{insertions()}</text>
            </Show>
            <Show when={deletions() > 0}>
              <text fg={theme.diff.text.removed}>-{deletions()}</text>
            </Show>
          </box>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.git",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarGit context={context} sessionID={props.sessionID} />,
    })
  },
})
