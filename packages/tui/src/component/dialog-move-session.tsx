import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, createSignal, onMount, Show } from "solid-js"
import path from "path"
import fs from "node:fs"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"
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
import { DialogPrompt } from "../ui/dialog-prompt"
import type { ProjectDirectories } from "@opencode-ai/sdk/v2"
import { useRoute } from "../context/route"

export type MoveSessionSelection = { type: "directory"; directory: string; subdirectory: boolean } | { type: "new" }
type ProjectDirectory = ProjectDirectories[number]

export function expandHome(input: string, home: string) {
  if (input === "~") return home
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(home, input.slice(2))
  }
  return path.resolve(input)
}

export function canonicalDirectory(input: string, home: string): string {
  const expanded = expandHome(input, home)
  try {
    return fs.realpathSync.native(expanded)
  } catch {
    return path.resolve(expanded)
  }
}

export function autocompleteDirectories(input: string, home: string, limit = 15): string[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const expanded = expandHome(trimmed, home)
  let dirToScan = expanded
  let partial = ""

  try {
    const stat = fs.statSync(expanded)
    if (!stat.isDirectory()) {
      dirToScan = path.dirname(expanded)
      partial = path.basename(expanded).toLowerCase()
    }
  } catch {
    dirToScan = path.dirname(expanded)
    partial = path.basename(expanded).toLowerCase()
  }

  const results: string[] = []
  try {
    const entries = fs.readdirSync(dirToScan, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith(".")) continue
      if (!partial || e.name.toLowerCase().startsWith(partial)) {
        const full = path.join(dirToScan, e.name)
        results.push(canonicalDirectory(full, home))
      }
    }
  } catch {}
  return results.slice(0, limit)
}

/**
 * Merge directories discovered across every opened project into the picker's
 * "Other" section.
 *
 * The dialog's own directory list is scoped to the active project, so nested
 * and sibling projects are otherwise unreachable. Candidates are canonicalized,
 * de-duplicated case-insensitively, filtered to directories that exist on disk,
 * and sorted alphabetically.
 */
export function mergeProjectDirectories(input: {
  candidates: readonly string[]
  existing: readonly string[]
  home: string
  limit?: number
  exists?: (directory: string) => boolean
}): string[] {
  const existing = new Set(
    input.existing.map((directory) => path.normalize(expandHome(directory, input.home)).toLowerCase()),
  )
  const exists = input.exists ?? ((directory: string) => fs.existsSync(directory))
  const seen = new Set<string>()
  const merged: string[] = []

  for (const candidate of input.candidates) {
    if (!candidate || !candidate.trim()) continue
    const canonical = canonicalDirectory(candidate, input.home)
    const key = path.normalize(canonical).toLowerCase()
    if (existing.has(key) || seen.has(key)) continue
    if (!exists(canonical)) continue
    seen.add(key)
    merged.push(canonical)
  }

  return merged.sort((a, b) => a.localeCompare(b)).slice(0, input.limit ?? 50)
}

type DialogMoveSessionProps = {
  projectID: string
  current?: MoveSessionSelection
  onSelect: (selection: MoveSessionSelection) => void
  onCurrentChange?: (selection: MoveSessionSelection) => void
  initialDirectories?: ProjectDirectory[]
  initialRemoving?: string
}

export function DialogMoveSession(props: DialogMoveSessionProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sync = useSync()
  const projectContext = useProject()
  const route = useRoute()
  const toast = useToast()
  const paths = useTuiPaths()
  const [working, setWorking] = createSignal(Boolean(props.initialRemoving))
  const [toDelete, setToDelete] = createSignal<string>()
  const [removing, setRemoving] = createSignal(props.initialRemoving)
  const [replacementCurrent, setReplacementCurrent] = createSignal<string>()
  const [loadError, setLoadError] = createSignal<unknown>()
  const [filterQuery, setFilterQuery] = createSignal("")
  const [highlightedOption, setHighlightedOption] = createSignal<DialogSelectOption<MoveSessionSelection | undefined>>()
  let selectRef: DialogSelectRef<MoveSessionSelection | undefined> | undefined
  const deleteHint = useCommandShortcut("dialog.move_session.delete")
  onMount(() => dialog.setSize("xlarge"))

  function reopen(initialRemoving?: string) {
    dialog.replace(() => (
      <DialogMoveSession {...props} initialDirectories={directoryData()} initialRemoving={initialRemoving} />
    ))
  }

  // A failed current-checkout lookup only affects which row is highlighted, so
  // swallow it and let the directory list render without a current marker.
  const [loadedProject] = createResource(
    () => (projectContext.project() === props.projectID ? undefined : props.projectID),
    (projectID) =>
      sdk.client.project
        .current({}, { throwOnError: true })
        .then((result) => (result.data?.id === projectID ? result.data.worktree : undefined))
        .catch(() => undefined),
  )
  const currentCheckout = createMemo(() => {
    if (projectContext.project() === props.projectID) return projectContext.instance.path().worktree
    return loadedProject()
  })

  const [directories, { refetch }] = createResource(
    () => (props.initialRemoving ? undefined : props.projectID),
    async (projectID, info): Promise<ProjectDirectory[] | undefined> => {
      try {
        await sdk.client.v2.projectCopy.refresh(
          { projectID, location: { directory: sdk.directory } },
          { throwOnError: true },
        )
        const directories = await sdk.client.project.directories({ projectID }, { throwOnError: true })
        setLoadError(undefined)
        return directories.data ?? []
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

  // Known directories for every opened project (`project.list` is global, not
  // scoped to the active project), plus the registered `project_directory`
  // rows for each. Without this the picker can never reach a nested or sibling
  // project — the sync-backed list is scoped to the active project's directory.
  const [otherProjectDirectories, { refetch: refetchOtherProjects }] = createResource(async (): Promise<string[]> => {
    const listed = await sdk.client.project.list({}, { throwOnError: true }).catch(() => undefined)
    const projects = listed?.data ?? []
    if (projects.length === 0) return []

    const registered = await Promise.all(
      projects.map((project) =>
        sdk.client.project
          .directories({ projectID: project.id }, { throwOnError: true })
          .then((result) => (result.data ?? []).map((item) => item.directory))
          .catch(() => [] as string[]),
      ),
    )

    const candidates: string[] = []
    for (const project of projects) {
      candidates.push(project.worktree)
      for (const sandbox of project.sandboxes) candidates.push(sandbox)
    }
    for (const group of registered) {
      for (const directory of group) candidates.push(directory)
    }
    return candidates
  })

  const options = createMemo<DialogSelectOption<MoveSessionSelection | undefined>[]>(() => {
    if (showError()) return []
    const data = directoryData()
    const current = currentRoot()?.directory
    if (directories.loading && !data && !current) return [{ title: "Loading project directories…", value: undefined }]
    const roots = [...(data ?? [])]
    if (current && !roots.some((item) => item.directory === current)) roots.unshift({ directory: current })
    roots.sort((a, b) => {
      if (a.directory === current) return -1
      if (b.directory === current) return 1
      if (Boolean(a.strategy) !== Boolean(b.strategy)) return a.strategy ? 1 : -1
      if (!a.strategy && !b.strategy) return a.directory.length - b.directory.length
      return 0
    })
    if (roots.length === 0) return [{ title: "No project directories found", value: undefined }]

    const subdirectories = sync.data.session
      .filter((session) => session.projectID === props.projectID && session.path && ![".", "/"].includes(session.path))
      .map((session) => session.directory)
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

    const knownProjectDirectories = roots.map((root) => root.directory)
    const otherProjectDirs = mergeProjectDirectories({
      candidates: [
        ...(otherProjectDirectories() ?? []),
        ...sync.data.session.map((session) => session.directory).filter(Boolean),
      ],
      existing: [...knownProjectDirectories, ...subdirectories.map((item) => item.location)],
      home: paths.home,
    })

    const otherProjects = otherProjectDirs.map((location) => ({
      location,
      root: { directory: location } as ProjectDirectory,
      other: true,
    }))

    const list = [
      ...roots.map((root) => ({ location: root.directory, root, other: false })),
      ...subdirectories.map((item) => ({ location: item.location, root: item.root, other: false })),
      ...otherProjects,
    ]
      .filter((item, index, self) => self.findIndex((s) => s.location === item.location) === index)
      .toSorted((a, b) => {
        // Keep the active project's checkouts before other projects.
        if (a.other !== b.other) return a.other ? 1 : -1
        if (a.other) return a.location.localeCompare(b.location)
        const root = roots.indexOf(a.root) - roots.indexOf(b.root)
        if (root !== 0) return root
        if (a.location === a.root.directory) return -1
        if (b.location === b.root.directory) return 1
        return a.location.localeCompare(b.location)
      })
    const titleWidth = Math.max(1, Math.min(116, dimensions().width - 2) - 12)

    const custom = filterQuery().trim()
    const autoDirs = custom ? autocompleteDirectories(custom, paths.home) : []
    const customOptions: DialogSelectOption<MoveSessionSelection | undefined>[] = []

    if (custom) {
      const canonicalCustom = canonicalDirectory(custom, paths.home)
      customOptions.push({
        title: abbreviateHome(canonicalCustom, paths.home),
        value: {
          type: "directory" as const,
          directory: canonicalCustom,
          subdirectory: false,
        },
        category: "Directories",
        titleWidth,
        truncateTitle: "left" as const,
      })

      const sortedSubdirs = autoDirs
        .filter((dir) => dir !== canonicalCustom && !list.some((item) => item.location === dir))
        .sort((a, b) => a.localeCompare(b))

      for (const dir of sortedSubdirs) {
        const abbrev = abbreviateHome(dir, paths.home)
        customOptions.push({
          title: abbrev,
          value: {
            type: "directory" as const,
            directory: dir,
            subdirectory: false,
          },
          category: "Directories",
          titleWidth,
          truncateTitle: "left" as const,
        })
      }
    }

    return [
      ...customOptions,
      ...list.map((item) => {
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
          category: item.root.directory === current ? "Current" : item.root.strategy ? "Copies" : "Other",
          titleWidth,
          truncateTitle: "left" as const,
        }
      }),
    ]
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
    const result = await sdk.client.v2.projectCopy
      .remove({
        projectID: props.projectID,
        location: { directory: sdk.directory },
        directory: selected.directory,
        force: false,
      })
      .catch((error) => ({ error }))
    if (result.error) {
      setRemoving(undefined)
      setWorking(false)
      if ("data" in result.error && result.error.data.forceRequired) {
        const status = await sdk.client.vcs.status({ directory: selected.directory }).catch(() => undefined)
        const choice = await DialogWorkspaceFileChanges.show(dialog, status?.data ?? [], {
          title: "Delete working copy?",
          message: "This working copy has file changes. Do you want to delete it anyway?",
        })
        if (choice !== "yes") {
          reopen()
          return
        }
        reopen(selected.directory)
        const forced = await sdk.client.v2.projectCopy
          .remove({
            projectID: props.projectID,
            location: { directory: sdk.directory },
            directory: selected.directory,
            force: true,
          })
          .catch((error) => ({ error }))
        if (forced.error) {
          toast.show({
            variant: "error",
            title: "Failed to delete project copy",
            message: errorMessage(forced.error),
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
        message: errorMessage(result.error),
      })
      return
    }
    await Promise.all([refetch(), refetchOtherProjects()])
    setRemoving(undefined)
    setWorking(false)
    if (await removedCurrent(deletingCurrent)) return
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
        skipFilter={Boolean(filterQuery().trim())}
        onFilter={setFilterQuery}
        options={options()}
        emptyView={
          showError() ? (
            <box paddingLeft={4} paddingRight={4}>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>
                Could not load project directories
              </text>
              <text fg={theme.textMuted}>{errorMessage(loadError())}</text>
            </box>
          ) : undefined
        }
        ref={(r) => (selectRef = r)}
        locked={showError() || directories.loading || loadedProject.loading || Boolean(removing())}
        current={current()}
        onSelect={(option) => {
          if (option.value) props.onSelect(option.value)
        }}
        onMove={(opt) => {
          setToDelete(undefined)
          setHighlightedOption(opt)
        }}
        footerHints={[
          { title: "➔", label: "drill down" },
          { title: "⬅", label: "up" },
        ]}
        bindings={[
          {
            key: "right",
            desc: "Drill down into directory",
            cmd: () => {
              const opt = highlightedOption() ?? options()[0]
              if (!opt || !opt.value || opt.value.type !== "directory") return
              const target = canonicalDirectory(opt.value.directory, paths.home)
              const withSlash = target.endsWith(path.sep) ? target : target + path.sep
              selectRef?.setFilter(withSlash)
            },
          },
          {
            key: "left",
            desc: "Go up one directory level",
            cmd: () => {
              const current = filterQuery().trim()
              if (!current) return
              const expanded = expandHome(current, paths.home)
              const parent = path.dirname(expanded)
              if (parent && parent !== expanded) {
                const withSlash = parent.endsWith(path.sep) ? parent : parent + path.sep
                selectRef?.setFilter(withSlash)
              } else {
                selectRef?.setFilter("")
              }
            },
          },
        ]}
        actions={
          showError()
            ? []
            : [
                {
                  command: "dialog.move_session.new",
                  title: "new",
                  onTrigger: () => {
                    dialog.replace(() => (
                      <DialogPrompt
                        title="Enter directory path to move session to"
                        placeholder="Path, or leave empty for new worktree copy"
                        onConfirm={(enteredPath) => {
                          const trimmed = enteredPath.trim()
                          if (trimmed) {
                            props.onSelect({
                              type: "directory",
                              directory: canonicalDirectory(trimmed, paths.home),
                              subdirectory: false,
                            })
                          } else {
                            props.onSelect({ type: "new" })
                          }
                        }}
                        onCancel={() => reopen()}
                      />
                    ))
                  },
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
                  onTrigger: () => {
                    void refetch()
                    void refetchOtherProjects()
                  },
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
