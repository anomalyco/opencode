import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, onMount, Show } from "solid-js"
import path from "path"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { Global } from "@opencode-ai/core/global"
import { Locale } from "@/util/locale"
import "opentui-spinner/solid"

const REFRESH_FRAMES = ["■", "⬝"]

export type MoveSessionSelection = { type: "directory"; directory: string } | { type: "new" }

export function DialogMoveSession(props: {
  projectID: string
  current?: MoveSessionSelection
  onSelect: (selection: MoveSessionSelection) => void
}) {
  const dialog = useDialog()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const kv = useKV()
  const sync = useSync()
  const [refreshing, setRefreshing] = createSignal(false)

  const [directories] = createResource(
    () => props.projectID,
    async (projectID) => {
      setRefreshing(true)
      const [, project] = await Promise.all([
        sdk.client.experimental.projectCopy
          .refresh({ projectID }, { throwOnError: true })
          .finally(() => setRefreshing(false)),
        sdk.client.project.current({}, { throwOnError: true }),
      ])
      const directories = await sdk.client.project.directories({ projectID }, { throwOnError: true })
      return {
        directories: directories.data ?? [],
        main: project.data?.id === projectID ? project.data.worktree : undefined,
      }
    },
  )

  const options = createMemo<DialogSelectOption<MoveSessionSelection | undefined>[]>(() => {
    if (directories.loading) return [{ title: "Loading project directories...", value: undefined }]
    if (directories.error) return [{ title: "Failed to load project directories", value: undefined }]
    const data = directories()
    const roots = data ? [...new Set(data.main ? [data.main, ...data.directories] : data.directories)] : []
    if (roots.length === 0) return [{ title: "No project directories found", value: undefined }]
    const subdirectories = sync.data.session
      .filter((session) => session.projectID === props.projectID && session.path && ![".", "/"].includes(session.path))
      .map((session) => session.directory)
      .filter((directory) => !roots.includes(directory))
      .filter((directory, index, directories) => directories.indexOf(directory) === index)
      .map((location) => ({
        location,
        root: roots
          .filter((root) => {
            const relative = path.relative(root, location)
            return relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)
          })
          .toSorted((a, b) => b.length - a.length)[0],
      }))
      .filter((item): item is { location: string; root: string } => item.root !== undefined)
    const list = [...roots.map((location) => ({ location, root: location })), ...subdirectories].toSorted((a, b) => {
      const root = roots.indexOf(a.root) - roots.indexOf(b.root)
      if (root !== 0) return root
      if (a.location === a.root) return -1
      if (b.location === b.root) return 1
      return a.location.localeCompare(b.location)
    })
    const titleWidth = Math.max(1, Math.min(116, dimensions().width - 2) - 12)
    return list.map((item) => {
      const title =
        Global.Path.home &&
        (item.location === Global.Path.home || item.location.startsWith(Global.Path.home + path.sep))
          ? item.location.replace(Global.Path.home, "~")
          : item.location
      const suffix = item.location === item.root ? undefined : path.sep + path.relative(item.root, item.location)
      const visible = Locale.truncateLeft(title, titleWidth)
      const split = suffix ? Math.max(0, visible.length - suffix.length) : visible.length
      return {
        title,
        titleView: suffix ? (
          <>
            {visible.slice(0, split)}
            <span style={{ fg: theme.textMuted }}>{visible.slice(split)}</span>
          </>
        ) : undefined,
        value: { type: "directory", directory: item.location } as const,
        category: item.root === data?.main ? "Project" : "Working copies",
        titleWidth,
        truncateTitle: "left" as const,
      }
    })
  })

  onMount(() => dialog.setSize("xlarge"))

  return (
    <box minHeight={Math.max(8, Math.min(16, dimensions().height - Math.floor(dimensions().height / 4) - 2))}>
      <DialogSelect
        title="Move session"
        options={options()}
        current={props.current}
        onSelect={(option) => {
          if (option.value) props.onSelect(option.value)
        }}
        actions={[
          {
            command: "dialog.move_session.new",
            title: "new",
            onTrigger: () => props.onSelect({ type: "new" }),
          },
        ]}
        footer={
          <Show when={refreshing()}>
            <box flexDirection="row" gap={1}>
              <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>⬝</text>}>
                <spinner color={theme.textMuted} frames={REFRESH_FRAMES} interval={160} />
              </Show>
              <text fg={theme.textMuted}>refreshing</text>
            </box>
          </Show>
        }
      />
    </box>
  )
}
