import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, createSignal, onMount, Show } from "solid-js"
import path from "path"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { useData } from "../context/data"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "../context/runtime"
import { Locale } from "../util/locale"
import { errorMessage } from "../util/error"
import { isRecord } from "../util/record"
import { useToast } from "../ui/toast"
import { useCommandShortcut } from "../keymap"
import { useProject } from "../context/project"
import { Spinner } from "./spinner"
import { DialogWorkspaceFileChanges } from "./dialog-workspace-file-changes"
import type { ProjectDirectoriesOutput } from "@opencode-ai/client"
import { useRoute } from "../context/route"
import { DialogProjectCopyName } from "./dialog-project-copy-name"

export type MoveSessionSelection =
  | { type: "directory"; directory: string; subdirectory: boolean }
  | { type: "new"; name: string }
type ProjectDirectory = ProjectDirectoriesOutput[number]

type DialogMoveSessionProps = {
  projectID: string
  current?: MoveSessionSelection
  onSelect: (selection: MoveSessionSelection) => void
  onCurrentChange?: (selection: MoveSessionSelection) => void
  initialDirectories?: ReadonlyArray<ProjectDirectory>
  initialRemoving?: string
}

export function DialogMoveSession(props: DialogMoveSessionProps) {
  const dialog = useDialog()
  const client = useClient()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sessionData = useData()
  const projectContext = useProject()
  const route = useRoute()
  const toast = useToast()
  const paths = useTuiPaths()
  const [working, setWorking] = createSignal(Boolean(props.initialRemoving))
  const [toDelete, setToDelete] = createSignal<string>()
  const [removing, setRemoving] = createSignal(props.initialRemoving)
  const [replacementCurrent, setReplacementCurrent] = createSignal<string>()
  const [loadError, setLoadError] = createSignal<unknown>()
  const deleteHint = useCommandShortcut("dialog.move_session.delete")
  onMount(() => dialog.setSize("xlarge"))

  function reopen(initialRemoving?: string) {
    dialog.replace(() => (
      <DialogMoveSession {...props} initialDirectories={directoryData()} initialRemoving={initialRemoving} />
    ))
  }

  // A failed current-checkout lookup only affects which row is highlighted, so
  // swallow it and let the directory list render without a current marker.
  // Once the current project is known, a mismatch is a guaranteed miss.
  const [loadedProject] = createResource(
    () => (projectContext.project() === undefined ? props.projectID : undefined),
    (projectID) =>
      client.api.project
        .current({ location: { directory: projectContext.instance.directory() || paths.cwd } })
        .then((project) => (project.id === projectID ? project.directory : undefined))
        .catch(() => undefined),
  )
  const currentCheckout = createMemo(() => {
    if (projectContext.project() === props.projectID) return projectContext.instance.path().worktree
    return loadedProject()
  })

  const [directories, { refetch }] = createResource(
    () => (props.initialRemoving ? undefined : props.projectID),
    async (projectID, info): Promise<ReadonlyArray<ProjectDirectory> | undefined> => {
      try {
        const location = { directory: projectContext.instance.directory() || paths.cwd }
        await client.api.projectCopy.refresh({
          projectID,
          location,
        })
        const directories = await client.api.project.directories({
          projectID,
          location,
        })
        setLoadError(undefined)
        return directories
      } catch (error) {
        setLoadError(error)
        // An initial load with no data surfaces the inline error view below. A
        // failed refresh intentionally stays quiet and keeps the already-shown
        // list interactive; reopening the dialog retries the load.
        return info.value
      }
    },
  )
  const directoryData = createMemo(() => directories() ?? props.initialDirectories)
  // Show the locked error view only when we have nothing to display. A refresh
  // that fails after the list rendered keeps the list and its actions.
  const showError = createMemo(() => Boolean(loadError()) && !directoryData())

  const currentDirectory = createMemo(
    () => replacementCurrent() ?? (props.current?.type === "directory" ? props.current.directory : currentCheckout()),
  )
  const currentRoot = createMemo<ProjectDirectory | undefined>(() => {
    if (showError()) return
    const directory = currentDirectory()
    if (!directory) return
    return (
      directoryData()
        ?.filter((root) => contains(root.directory, directory))
        .toSorted((a, b) => b.directory.length - a.directory.length)[0] ?? { directory }
    )
  })

  const options = createMemo<DialogSelectOption<MoveSessionSelection | undefined>[]>(() => {
    if (showError()) return []
    const data = directoryData()
    const current = currentRoot()?.directory
    if (directories.loading && !data && !current) return []
    const roots = [...(data ?? [])]
    if (current && !roots.some((item) => item.directory === current)) roots.unshift({ directory: current })
    roots.sort((a, b) => {
      if (a.directory === current) return -1
      if (b.directory === current) return 1
      if (Boolean(a.strategy) !== Boolean(b.strategy)) return a.strategy ? 1 : -1
      if (!a.strategy && !b.strategy) return a.directory.length - b.directory.length
      return 0
    })
    if (roots.length === 0) return []

    const subdirectories = sessionData.session
      .list()
      .filter(
        (session) => session.projectID === props.projectID && session.subpath && ![".", "/"].includes(session.subpath),
      )
      .map((session) => session.location.directory)
      .filter((directory) => !roots.some((root) => root.directory === directory))
      .filter((directory, index, directories) => directories.indexOf(directory) === index)
      .map((location) => ({
        location,
        root: roots
          .filter((root) => {
            const relative = path.relative(root.directory, location)
            return relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)
          })
          .toSorted((a, b) => b.directory.length - a.directory.length)[0],
      }))
      .filter((item): item is { location: string; root: ProjectDirectory } => item.root !== undefined)

    const list = [...roots.map((root) => ({ location: root.directory, root })), ...subdirectories].toSorted((a, b) => {
      const root = roots.indexOf(a.root) - roots.indexOf(b.root)
      if (root !== 0) return root
      if (a.location === a.root.directory) return -1
      if (b.location === b.root.directory) return 1
      return a.location.localeCompare(b.location)
    })
    const titleWidth = Math.max(1, Math.min(116, dimensions().width - 2) - 12)

    return list.map((item) => {
      const title = abbreviateHome(item.location, paths.home)
      const suffix =
        item.location === item.root.directory ? undefined : path.sep + path.relative(item.root.directory, item.location)
      const visible = Locale.truncateLeft(title, titleWidth)
      const split = suffix ? Math.max(0, visible.length - suffix.length) : visible.length
      const deleting = toDelete() === item.location
      const isRemoving = removing() === item.location
      return {
        title,
        titleView: isRemoving ? (
          <span style={{ fg: theme.error }}>Deleting {item.location}</span>
        ) : deleting ? (
          <span style={{ fg: theme.text }}>Press {deleteHint()} again to confirm</span>
        ) : suffix ? (
          <>
            {visible.slice(0, split)}
            <span style={{ fg: theme.textMuted }}>{visible.slice(split)}</span>
          </>
        ) : undefined,
        bg: deleting ? theme.error : undefined,
        value: {
          type: "directory",
          directory: item.location,
          subdirectory: item.location !== item.root.directory,
        } as const,
        category: item.root.directory === current ? "Current" : "Other",
        titleWidth,
        truncateTitle: "left" as const,
      }
    })
  })

  const current = createMemo(() => {
    if (directories.loading || loadedProject.loading) return
    const replacement = replacementCurrent()
    if (replacement) return { type: "directory", directory: replacement, subdirectory: false } as const
    return props.current
  })

  async function removedCurrent(current: boolean) {
    if (!current) return false
    const fallback = projectContext.data.project.mainDir
    if (fallback) setReplacementCurrent(fallback)
    if (route.data.type === "session") {
      route.navigate({ type: "home" })
      dialog.clear()
      return true
    }
    if (fallback) {
      props.onCurrentChange?.({ type: "directory", directory: fallback, subdirectory: false })
      return true
    }
    dialog.clear()
    return true
  }

  async function remove(option: DialogSelectOption<MoveSessionSelection | undefined>) {
    if (!option.value || option.value.type !== "directory" || option.value.subdirectory || removing()) return
    const data = directoryData()
    const selected = option.value
    const root = data?.find((item) => item.directory === selected.directory)
    if (!root?.strategy) return
    const deletingCurrent = selected.directory === currentRoot()?.directory
    if (toDelete() !== selected.directory) {
      setToDelete(selected.directory)
      return
    }
    setToDelete(undefined)
    setRemoving(selected.directory)
    setWorking(true)
    const error = await client.api.projectCopy
      .remove({
        projectID: props.projectID,
        location: { directory: projectContext.instance.directory() || paths.cwd },
        directory: selected.directory,
        force: false,
      })
      .then(
        () => undefined,
        (error) => error,
      )
    if (error) {
      setRemoving(undefined)
      setWorking(false)
      if (isRecord(error) && isRecord(error.data) && error.data.forceRequired === true) {
        const status = await client.api.vcs
          .status({ location: { directory: selected.directory } })
          .catch(() => undefined)
        const choice = await DialogWorkspaceFileChanges.show(dialog, status?.data ?? [], {
          title: "Delete working copy?",
          message: "This working copy has file changes. Do you want to delete it anyway?",
        })
        if (choice !== "yes") {
          reopen()
          return
        }
        reopen(selected.directory)
        const forcedError = await client.api.projectCopy
          .remove({
            projectID: props.projectID,
            location: { directory: projectContext.instance.directory() || paths.cwd },
            directory: selected.directory,
            force: true,
          })
          .then(
            () => undefined,
            (error) => error,
          )
        if (forcedError) {
          toast.show({
            variant: "error",
            title: "Failed to delete project copy",
            message: errorMessage(forcedError),
          })
          reopen()
          return
        }
        setRemoving(undefined)
        setWorking(false)
        if (await removedCurrent(deletingCurrent)) return
        reopen()
        return
      }
      toast.show({
        variant: "error",
        title: "Failed to delete project copy",
        message: errorMessage(error),
      })
      return
    }
    await refetch()
    setRemoving(undefined)
    setWorking(false)
    if (await removedCurrent(deletingCurrent)) return
  }

  async function create() {
    const name = await DialogProjectCopyName.show(dialog)
    if (name === null) return
    props.onSelect({ type: "new", name })
  }

  const fullHeight = createMemo(() =>
    Math.max(8, Math.min(16, dimensions().height - Math.floor(dimensions().height / 4) - 2)),
  )

  return (
    <box minHeight={showError() ? 5 : fullHeight()}>
      <DialogSelect
        title="Move session"
        titleView={
          <box flexDirection="row" gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Move session
            </text>
            <Show when={working() || directories.loading || loadedProject.loading}>
              <Spinner />
            </Show>
          </box>
        }
        renderFilter={!showError()}
        options={options()}
        emptyView={
          showError() ? (
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>
                Could not load project directories
              </text>
              <text fg={theme.textMuted}>{errorMessage(loadError())}</text>
              <text fg={theme.textMuted}>Close and reopen Move session to try again.</text>
            </box>
          ) : directories.loading || loadedProject.loading ? (
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={theme.textMuted}>Loading project directories…</text>
            </box>
          ) : (
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={theme.textMuted}>No project directories available</text>
            </box>
          )
        }
        noMatchView={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>No project directories found</text>
          </box>
        }
        locked={showError() || directories.loading || loadedProject.loading || Boolean(removing())}
        current={current()}
        onSelect={(option) => {
          if (option.value) props.onSelect(option.value)
        }}
        onMove={() => setToDelete(undefined)}
        actions={
          showError()
            ? []
            : [
                {
                  command: "dialog.move_session.new",
                  title: "new",
                  selection: "none",
                  onTrigger: () => void create(),
                },
                {
                  command: "dialog.move_session.delete",
                  title: "delete",
                  disabled: (option) => {
                    const value = option?.value
                    if (!value || value.type !== "directory" || value.subdirectory) return true
                    return !directoryData()?.find((item) => item.directory === value.directory)?.strategy
                  },
                  onTrigger: remove,
                },
                {
                  command: "dialog.move_session.refresh",
                  title: "refresh",
                  selection: "none",
                  onTrigger: () => void refetch(),
                },
              ]
        }
      />
    </box>
  )
}

function contains(root: string, directory: string) {
  if (root === directory) return true
  const relative = path.relative(root, directory)
  return relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)
}
