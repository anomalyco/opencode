import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, createSignal, onMount, Show } from "solid-js"
import path from "path"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "../context/runtime"
import { Locale } from "../util/locale"
import { errorMessage } from "../util/error"
import { useToast } from "../ui/toast"
import { useCommandShortcut } from "../keymap"
import { useProject } from "../context/project"
import { Spinner } from "./spinner"
import { DialogWorkspaceFileChanges } from "./dialog-workspace-file-changes"

export type MoveSessionSelection = { type: "directory"; directory: string; subdirectory: boolean } | { type: "new" }

export function DialogMoveSession(props: {
  projectID: string
  current?: MoveSessionSelection
  onSelect: (selection: MoveSessionSelection) => void
  initialDirectories?: string[]
  initialRemoving?: string
}) {
  const dialog = useDialog()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sync = useSync()
  const projectContext = useProject()
  const toast = useToast()
  const paths = useTuiPaths()
  const [working, setWorking] = createSignal(Boolean(props.initialRemoving))
  const [toDelete, setToDelete] = createSignal<string>()
  const [removing, setRemoving] = createSignal(props.initialRemoving)
  const deleteHint = useCommandShortcut("dialog.move_session.delete")

  function reopen(initialRemoving?: string) {
    dialog.replace(() => (
      <DialogMoveSession {...props} initialDirectories={directories()} initialRemoving={initialRemoving} />
    ))
  }

  const [loadedProject] = createResource(
    () => (projectContext.project() === props.projectID ? undefined : props.projectID),
    async (projectID) => {
      const result = await sdk.client.project.current({}, { throwOnError: true })
      return result.data?.id === projectID ? result.data.worktree : undefined
    },
  )
  const project = createMemo(() =>
    projectContext.project() === props.projectID ? projectContext.data.project.worktree : loadedProject(),
  )

  const [directories, { refetch }] = createResource(
    () => (props.initialRemoving ? undefined : props.projectID),
    async (projectID) => {
      setWorking(true)
      try {
        await sdk.client.experimental.projectCopy.refresh({ projectID }, { throwOnError: true })
        const directories = await sdk.client.project.directories({ projectID }, { throwOnError: true })
        return directories.data?.map((item) => item.directory) ?? []
      } finally {
        setWorking(false)
      }
    },
    { initialValue: props.initialDirectories },
  )

  const options = createMemo<DialogSelectOption<MoveSessionSelection | undefined>[]>(() => {
    const data = directories()
    const main = project()
    if (directories.loading && !data && !main) return [{ title: "Loading project directories...", value: undefined }]
    if (directories.error && !data && !main) return [{ title: "Failed to load project directories", value: undefined }]
    const roots = [...new Set(main ? [main, ...(data ?? [])] : (data ?? []))]
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
      const title = abbreviateHome(item.location, paths.home)
      const suffix = item.location === item.root ? undefined : path.sep + path.relative(item.root, item.location)
      const visible = Locale.truncateLeft(title, titleWidth)
      const split = suffix ? Math.max(0, visible.length - suffix.length) : visible.length
      const deleting = toDelete() === item.location
      const isRemoving = removing() === item.location
      return {
        title: isRemoving ? `Deleting ${item.location}` : deleting ? `Press ${deleteHint()} again to confirm` : title,
        titleView: isRemoving ? (
          <span style={{ fg: theme.error }}>Deleting {item.location}</span>
        ) : !deleting && suffix ? (
          <>
            {visible.slice(0, split)}
            <span style={{ fg: theme.textMuted }}>{visible.slice(split)}</span>
          </>
        ) : undefined,
        bg: deleting ? theme.error : undefined,
        value: { type: "directory", directory: item.location, subdirectory: item.location !== item.root } as const,
        category: item.root === main ? "Project" : "Working copies",
        titleWidth,
        truncateTitle: "left" as const,
      }
    })
  })

  const current = createMemo(() => {
    if (directories.loading || loadedProject.loading || !props.current) return
    if (props.current.type === "new") return props.current
    const directory = props.current.directory
    return options().find((option) => option.value?.type === "directory" && option.value.directory === directory)?.value
  })

  async function remove(option: DialogSelectOption<MoveSessionSelection | undefined>) {
    if (!option.value || option.value.type !== "directory" || option.value.subdirectory || removing()) return
    const data = directories()
    const main = project()
    if (!data || !main || option.value.directory === main || !data.includes(option.value.directory)) return
    if (toDelete() !== option.value.directory) {
      setToDelete(option.value.directory)
      return
    }
    setToDelete(undefined)
    setRemoving(option.value.directory)
    setWorking(true)
    const result = await sdk.client.experimental.projectCopy
      .remove({ projectID: props.projectID, directory: option.value.directory, force: false })
      .catch((error) => ({ error }))
    if (result.error) {
      setRemoving(undefined)
      setWorking(false)
      if ("data" in result.error && result.error.data.forceRequired) {
        const status = await sdk.client.vcs.status({ directory: option.value.directory }).catch(() => undefined)
        const choice = await DialogWorkspaceFileChanges.show(dialog, status?.data ?? [], {
          title: "Delete working copy?",
          message: "This working copy has file changes. Do you want to delete it anyway?",
        })
        if (choice !== "yes") {
          reopen()
          return
        }
        reopen(option.value.directory)
        const forced = await sdk.client.experimental.projectCopy
          .remove({ projectID: props.projectID, directory: option.value.directory, force: true })
          .catch((error) => ({ error }))
        if (forced.error) {
          toast.show({
            variant: "error",
            title: "Failed to delete project copy",
            message: errorMessage(forced.error),
          })
        }
        reopen()
        return
      }
      toast.show({
        variant: "error",
        title: "Failed to delete project copy",
        message: errorMessage(result.error),
      })
      return
    }
    await refetch()
    setRemoving(undefined)
  }

  onMount(() => dialog.setSize("xlarge"))

  return (
    <box minHeight={Math.max(8, Math.min(16, dimensions().height - Math.floor(dimensions().height / 4) - 2))}>
      <DialogSelect
        title="Move session"
        titleView={
          <box flexDirection="row" gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Move session
            </text>
            <Show when={working()}>
              <Spinner />
            </Show>
          </box>
        }
        options={options()}
        locked={directories.loading || loadedProject.loading || Boolean(removing())}
        current={current()}
        onSelect={(option) => {
          if (option.value) props.onSelect(option.value)
        }}
        onMove={() => setToDelete(undefined)}
        actions={[
          {
            command: "dialog.move_session.new",
            title: "new",
            onTrigger: () => props.onSelect({ type: "new" }),
          },
          {
            command: "dialog.move_session.delete",
            title: "delete",
            disabled: (option) =>
              !option?.value ||
              option.value.type !== "directory" ||
              option.value.subdirectory ||
              option.value.directory === project(),
            onTrigger: remove,
          },
          {
            command: "dialog.move_session.refresh",
            title: "refresh",
            onTrigger: () => void refetch(),
          },
        ]}
      />
    </box>
  )
}
