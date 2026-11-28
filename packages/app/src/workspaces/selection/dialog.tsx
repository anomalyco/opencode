import "@pierre/trees/web-components"
import { FileTree } from "@pierre/trees"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { Divider } from "@opencode/ui/divider"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import {
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { inferHomeDirectory } from "@/runtime/server/global-sync/bootstrap"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { pathKey } from "@/workspaces/path-key"
import type { LocationRef } from "@opencode/client/promise"
import {
  absoluteTreePath,
  canonicalPickerPath,
  pickerAbsoluteInput,
  pickerMode,
  createPriorityTaskQueue,
  createDirectorySearch,
  displayInputDirectory,
  displayPickerPath,
  shortenPickerRecentPath,
  pickerBreadcrumbs,
  pickerParent,
  listPickerDirectory,
  pickerRelativePath,
  pickerAbsolutePath,
  pickerFolderPath,
} from "./domain"
import {
  createPickerTreeState,
  hasPickerGitRepo,
  pickerTreeView,
  transitionPickerTree,
  type PickerNode,
  type PickerTreeEffect,
  type PickerTreeEvent,
} from "./tree-machine"
import {
  createPickerComboboxState,
  ownsPickerEscape,
  pickerComboboxView,
  transitionPickerCombobox,
  type PickerComboboxEffect,
  type PickerComboboxEvent,
  type PickerSuggestion,
} from "./combobox-machine"
import "./dialog.css"

const TREE_SPRITE_SHEET = `<svg xmlns="http://www.w3.org/2000/svg" data-icon-sprite aria-hidden="true" width="0" height="0" style="display:none"><symbol id="picker-chevron-down" viewBox="0 0 14 14"><path d="M4 5.5L7 8.5L10 5.5" fill="none" stroke="currentColor"/></symbol></svg>`

const FOLDER_CLOSED_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'%3E%3Cpath d='M1.1667 1.75V11.6667H12.8334V3.5H7.58337L5.83337 1.75H1.1667Z' stroke='black' stroke-miterlimit='10' stroke-linecap='square'/%3E%3C/svg%3E")`

const FOLDER_OPEN_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'%3E%3Cpath opacity='0.3' d='M5.64738 1.70126H1.31254V11.9099H2.86062L4.12109 6.85385H12.6867V3.64608H7.29826L5.90031 1.99948L5.80973 1.89266L5.78666 1.86532L5.78068 1.85848L5.77897 1.85592L5.64738 1.70126Z' fill='black'/%3E%3Cpath d='M3.88891 11.4722H3.30558C2.44613 11.4722 1.75002 11.4722 1.75002 11.4722V3.69444C1.75002 2.835 1.75002 2.13889 1.75002 2.13889H5.44488C5.44488 2.13889 5.6148 2.33956 5.91035 2.68722L7.09569 4.08333H12.2492C12.2492 4.08333 12.2492 4.77944 12.2492 5.63889V6.41667M12.0267 10.3211L12.6475 7.88666C12.8368 7.14543 13.0279 6.41665 13.0279 6.41665H3.81968C3.81968 6.41665 3.7268 6.77054 3.59719 7.27999L2.90344 10.0022C2.71418 10.7434 2.52785 11.4722 2.52785 11.4722H11.7297C11.7297 11.4722 11.8536 11.0001 12.0267 10.3211Z' stroke='black'/%3E%3C/svg%3E")`

interface DirectoryPickerDialogProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
  server: ServerConnection.Any
  location?: LocationRef
  mode?: "directory" | "file"
  start?: string
}

type NewFolderState = { open: boolean; name: string; busy: boolean; error?: string }

export function DirectoryPickerDialog(props: DirectoryPickerDialogProps) {
  const servers = useServers()
  const serverCtx = useServer().ctx
  const sync = serverCtx.sync
  const sdk = serverCtx.sdk
  const dialog = useDialog()
  const language = useLanguage()
  const policy = pickerMode(props.mode ?? "directory", props.start)

  const action = {
    file: language.t("dialog.directory.action.selectFile"),
    directory: language.t("dialog.directory.action.selectFolder"),
  }

  // One signal holds both immutable machine states, so a write replaces them whole and never merges into shared objects.
  const [machines, setMachines] = createSignal({
    tree: createPickerTreeState(),
    combobox: createPickerComboboxState(),
  })
  const [newFolder, setNewFolder] = createSignal<NewFolderState>({ open: false, name: "", busy: false })

  const treeMachine = createMemo(() => machines().tree)
  const treeView = createMemo(() => pickerTreeView(treeMachine(), policy))
  const treeRoot = createMemo(() => treeView().root)
  const comboboxView = createMemo(() => pickerComboboxView(machines().combobox))
  const loads = createPriorityTaskQueue<PickerNode[]>(3)
  const treeTimers = new Set<ReturnType<typeof setTimeout>>()
  let activeSearch: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined
  let tree: FileTree | undefined
  let container: HTMLDivElement | undefined
  let pathArea: HTMLDivElement | undefined
  let newFolderTrigger: HTMLButtonElement | undefined

  const knownGitRepos = createMemo(() => {
    const keys = new Set<string>()
    const items = [...serverCtx.projects.list(), ...sync.data.project]

    for (const project of items) {
      if (!project.worktree || project.id === "global") continue

      if (project.vcs && project.vcs !== "git") continue
      keys.add(pathKey(canonicalPickerPath(project.worktree)))

      for (const sandbox of project.sandboxes ?? []) {
        keys.add(pathKey(canonicalPickerPath(sandbox)))
      }
    }

    return keys
  })

  const home = createMemo(() => sync.data.path.home || inferHomeDirectory(props.location?.directory ?? ""))

  const subtitle = createMemo(() => (servers.local(props.server) ? undefined : serverName(props.server)))

  const location = createMemo(
    () => {
      const directory = props.location?.directory ?? treeView().locationDirectory

      return directory ? { directory } : undefined
    },
    undefined,
    { equals: (previous, next) => previous?.directory === next?.directory },
  )

  const start = createMemo(
    () =>
      props.start || home() || props.location?.directory || sync.data.path.directory || treeView().locationDirectory,
  )

  const recentProjects = createMemo(() => {
    if ((props.mode ?? "directory") !== "directory") return []
    const seen = new Set<string>()
    const items = [...serverCtx.projects.list(), ...sync.data.project]

    return items
      .filter((project) => {
        if (!project.worktree || project.id === "global") return false
        const key = pathKey(project.worktree)

        if (seen.has(key)) return false
        seen.add(key)

        return true
      })
      .slice(0, 10)
  })

  const search = createDirectorySearch({ sdk, home, location, base: () => treeView().root || start() })

  const breadcrumbs = createMemo(() => {
    const root = treeView().root
    const crumbs = root ? pickerBreadcrumbs(root, home()) : []
    // Deep paths collapse the folders between / and ~ and the last two into an ellipsis that opens the one above them.
    const lead = crumbs[1]?.label === "~" ? 2 : 1

    if (crumbs.length <= lead + 3) return crumbs

    return [...crumbs.slice(0, lead), { label: "…", path: crumbs[crumbs.length - 3].path }, ...crumbs.slice(-2)]
  })

  const committed = createMemo(() => {
    const selected = treeView().selected

    if (!selected) return ""

    return policy.action === "file" ? displayPickerPath(selected, "", home()) : displayInputDirectory(selected, home())
  })

  function atSelection(input: HTMLInputElement) {
    if (!input.value) return true

    const end = input.value.length

    return input.value === committed() && input.selectionStart === end && input.selectionEnd === end
  }

  function choose(directory: string) {
    dispatchCombobox({ type: "dismissed" })
    dispatchTree({ type: "directory.chosen", ...navigation(directory), fromInput: false })
  }

  function closeNewFolder() {
    setNewFolder({ open: false, name: "", busy: false })
    newFolderTrigger?.focus()
  }

  async function createFolder() {
    if (newFolder().busy) return
    const base = treeView().root
    const requestLocation = location()

    if (!base || !requestLocation) return

    const path = pickerFolderPath(base, newFolder().name, home())

    if (!path) {
      setNewFolder((state) => ({ ...state, error: language.t("dialog.directory.newFolder.invalid") }))

      return
    }

    setNewFolder((state) => ({ ...state, busy: true, error: undefined }))

    try {
      const created = await sdk.api.experimental.file.mkdir({ location: requestLocation, path })
      closeNewFolder()
      choose(created.data.path)
    } catch {
      setNewFolder((state) => ({
        ...state,
        busy: false,
        error: language.t("dialog.directory.newFolder.failed"),
      }))
    }
  }

  function navigation(path: string) {
    return { path, home: home(), fallback: start() || home(), located: Boolean(location()) }
  }

  function dispatchTree(event: PickerTreeEvent) {
    untrack(() => {
      const previous = machines().tree
      const next = transitionPickerTree(previous, event, policy)

      if (next.state !== previous) setMachines((current) => ({ ...current, tree: next.state }))
      next.effects.forEach(
        (effect) => void Promise.try(() => runTreeEffect(effect)).catch((cause: unknown) => console.error(cause)),
      )
    })
  }

  function dispatchCombobox(event: PickerComboboxEvent) {
    return untrack(() => {
      const previous = machines().combobox

      const next = transitionPickerCombobox(previous, event, {
        policy,
        home: home(),
        root: treeView().root,
        fallback: start() || home(),
        locationDirectory: location()?.directory,
        committed: committed(),
      })

      if (next.state !== previous) setMachines((current) => ({ ...current, combobox: next.state }))
      next.effects.forEach(
        (effect) => void Promise.try(() => runComboboxEffect(effect)).catch((cause: unknown) => console.error(cause)),
      )

      return next
    })
  }

  function runTreeEffect(effect: PickerTreeEffect) {
    if (effect.type === "resolve-location") {
      const settle = (event: Extract<PickerTreeEvent, { attempt: number }>) => {
        clearTimeout(timer)
        treeTimers.delete(timer)
        dispatchTree(event)
      }

      const timer = setTimeout(() => settle({ type: "location.timed-out", attempt: effect.attempt }), effect.timeoutMs)

      treeTimers.add(timer)
      void Promise.try(() => sdk.api.location.get()).then(
        (current) => settle({ type: "location.resolved", attempt: effect.attempt, directory: current?.directory }),
        () => settle({ type: "location.failed", attempt: effect.attempt }),
      )

      return
    }

    if (effect.type === "list") {
      const failed = { type: "dir.failed" as const, dir: effect.dir, attempt: effect.attempt }

      void loads
        .schedule(String(effect.attempt), effect.priority, (signal) => {
          const current = location()

          if (!current) return Promise.reject(new Error("The picker has no server location"))

          // The timeout starts when the listing does, so preloads waiting in the queue cannot expire. Aborting the
          // job cancels the request and frees its queue slot, so hung listings cannot block the next root.
          const timer = setTimeout(() => {
            treeTimers.delete(timer)
            dispatchTree({ type: "dir.timed-out", dir: effect.dir, attempt: effect.attempt })
            loads.abort(String(effect.attempt))
          }, effect.timeoutMs)

          treeTimers.add(timer)

          return listPickerDirectory(sdk, current, absoluteTreePath(effect.root, effect.dir), signal).finally(() => {
            clearTimeout(timer)
            treeTimers.delete(timer)
          })
        })
        .then(
          (nodes) =>
            dispatchTree(nodes ? { type: "dir.loaded", dir: effect.dir, attempt: effect.attempt, nodes } : failed),
          () => dispatchTree(failed),
        )

      return
    }

    if (effect.type === "promote") return loads.promote(String(effect.attempt))

    if (effect.type === "queue.reset") {
      loads.clear()
      treeTimers.forEach((timer) => clearTimeout(timer))
      treeTimers.clear()

      return
    }

    if (effect.type === "tree.reset") return tree?.resetPaths([])

    if (effect.type === "tree.add") {
      const paths = effect.paths.filter((path) => !tree?.getItem(path))

      if (paths.length > 0) tree?.batch(paths.map((path) => ({ type: "add", path })))

      return
    }

    if (effect.type === "tree.expand") {
      const item = tree?.getItem(`${effect.dir}/`)

      if (item && "expand" in item && !item.isExpanded()) item.expand()

      return
    }

    if (effect.type === "tree.select") {
      for (const selectedPath of tree?.getSelectedPaths() ?? []) {
        if (selectedPath !== effect.entry) tree?.getItem(selectedPath)?.deselect()
      }

      tree?.getItem(effect.entry)?.select()
      tree?.focusPath(effect.entry)
      // The tree measures newly expanded rows after this frame, so an immediate scroll clamps to the old height.
      requestAnimationFrame(() => tree?.scrollToPath(effect.entry, { offset: "center" }))

      return
    }

    if (effect.type === "tree.clear-selection") {
      for (const selectedPath of tree?.getSelectedPaths() ?? []) {
        tree?.getItem(selectedPath)?.deselect()
      }

      tree?.focusNearestPath(null)

      return
    }

    if (effect.type === "submit") return resolve()

    if (effect.type === "tree.focus-initial") {
      if (!tree?.getFocusedPath()) tree?.focusNearestPath(null)

      return
    }

    tree?.setComposition(tree.getComposition())
  }

  function runComboboxEffect(effect: PickerComboboxEffect) {
    if (effect.type === "search.start") {
      stopSearch()
      const controller = new AbortController()

      const settle = (event: Extract<PickerComboboxEvent, { attempt: number }>) => {
        if (activeSearch?.controller === controller) stopSearch()
        dispatchCombobox(event)
      }

      activeSearch = {
        controller,
        timer: setTimeout(() => settle({ type: "search.timed-out", attempt: effect.attempt }), effect.timeoutMs),
      }

      void Promise.try(() => suggestions(effect.query, controller.signal)).then(
        (items) => settle({ type: "search.resolved", attempt: effect.attempt, items }),
        () => settle({ type: "search.failed", attempt: effect.attempt }),
      )

      return
    }

    if (effect.type === "search.cancel") return stopSearch()

    if (effect.type === "submit") return resolve()

    if (effect.type === "choose.directory") {
      return dispatchTree({
        type: "directory.chosen",
        ...navigation(effect.path),
        fromInput: true,
        submit: effect.submit,
      })
    }

    dispatchTree({ type: "file.chosen", absolute: effect.absolute, home: home() })

    if (effect.submit) resolve()
  }

  function stopSearch() {
    if (!activeSearch) return
    activeSearch.controller.abort()
    clearTimeout(activeSearch.timer)
    activeSearch = undefined
  }

  async function suggestions(value: string, signal: AbortSignal): Promise<PickerSuggestion[]> {
    const directories = (await search(value, { signal })).map((absolute) => ({ absolute, type: "directory" as const }))

    if (!policy.includeFiles) return directories.slice(0, 5)
    const current = location()
    const base = current?.directory

    if (!base) return directories.slice(0, 5)
    const query = pickerRelativePath(base, pickerAbsoluteInput(value, home(), treeView().root || base))

    if (query === undefined || signal.aborted) return directories.slice(0, 5)

    const files = await sdk.api.file
      .find(
        {
          location: current,
          query,
          type: "file",
          limit: 20,
        },
        { signal },
      )
      .then((result) => result.data)
      .catch(() => [])

    const results = [
      ...directories,
      ...files.map((entry) => ({ absolute: pickerAbsolutePath(entry.path, base), type: "file" as const })),
    ]

    return Array.from(new Map(results.map((result) => [result.absolute, result])).values()).slice(0, 8)
  }

  // A root the mode does not allow (a file picker's parent outside its base) keeps the input as it was.
  function navigate(path: string) {
    const previous = untrack(machines).tree
    dispatchTree({ type: "navigate", ...navigation(path) })

    if (untrack(machines).tree !== previous) dispatchCombobox({ type: "cleared" })
  }

  function resolve() {
    const path = treeView().result

    if (!path) return
    props.onSelect(props.multiple ? [path] : path)
    dialog.close()
  }

  onMount(() => {
    const closeSuggestions = (event: PointerEvent) => {
      if (event.target instanceof Node && pathArea?.contains(event.target)) return
      dispatchCombobox({ type: "dismissed" })
    }

    document.addEventListener("pointerdown", closeSuggestions)
    onCleanup(() => document.removeEventListener("pointerdown", closeSuggestions))
    tree = new FileTree({
      paths: [],
      flattenEmptyDirectories: false,
      initialExpansion: "closed",
      itemHeight: 24,
      stickyFolders: true,
      icons: {
        spriteSheet: TREE_SPRITE_SHEET,
        remap: {
          "file-tree-icon-chevron": {
            name: "picker-chevron-down",
            width: 14,
            height: 14,
            viewBox: "0 0 14 14",
          },
        },
      },
      renderRowDecoration(context) {
        if (context.row.kind !== "directory") return null
        const current = untrack(machines).tree

        const key = pathKey(
          canonicalPickerPath(absoluteTreePath(pickerTreeView(current, policy).root, context.item.path)),
        )

        if (!hasPickerGitRepo(current, context.item.path) && !knownGitRepos().has(key)) return null

        return { text: language.t("dialog.directory.gitRepo") }
      },
      unsafeCSS: `
        button[data-type="item"] {
          height: 24px !important;
          min-height: 24px !important;
          padding: 4px 8px !important;
          margin: 0 !important;
          gap: 6px !important;
          border-radius: 4px !important;
          background: transparent !important;
          box-shadow: none !important;
          color: var(--v2-text-text-muted) !important;
          font-size: 13px !important;
          font-weight: 500 !important;
          letter-spacing: -0.04px !important;
        }
        button[data-type="item"]:hover {
          background: var(--v2-overlay-simple-overlay-hover) !important;
          color: var(--v2-text-text-muted) !important;
        }
        button[data-type="item"][data-file-tree-sticky-row="true"] {
          background-color: var(--v2-background-bg-base) !important;
        }
        button[data-type="item"][data-file-tree-sticky-row="true"]:hover {
          background:
            linear-gradient(0deg, var(--v2-overlay-simple-overlay-hover), var(--v2-overlay-simple-overlay-hover)),
            var(--v2-background-bg-base) !important;
        }
        button[data-type="item"][aria-selected="true"],
        button[data-type="item"][data-item-selected="true"] {
          background:
            linear-gradient(0deg, var(--v2-overlay-simple-overlay-pressed), var(--v2-overlay-simple-overlay-pressed)),
            var(--v2-background-bg-base) !important;
          color: var(--v2-text-text-base) !important;
        }
        button[data-type="item"]:focus-visible {
          outline: none !important;
          box-shadow: inset 0 0 0 1px var(--v2-border-border-focus) !important;
        }
        [data-item-type="folder"] > [data-item-section="icon"] {
          width: auto !important;
          gap: 6px !important;
          color: var(--v2-icon-icon-muted) !important;
        }
        [data-item-type="folder"] > [data-item-section="icon"] > svg {
          width: 14px !important;
          height: 14px !important;
          flex-shrink: 0 !important;
          transform: none !important;
        }
        [aria-expanded="false"][data-item-type="folder"]
          > [data-item-section="icon"]
          > [data-icon-name="file-tree-icon-chevron"] {
          transform: rotate(-90deg) !important;
        }
        [data-item-type="folder"] > [data-item-section="icon"]::after {
          content: "";
          display: block;
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          background-color: currentColor;
          -webkit-mask-image: ${FOLDER_CLOSED_MASK};
          mask-image: ${FOLDER_CLOSED_MASK};
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-size: 14px 14px;
          mask-size: 14px 14px;
        }
        [aria-expanded="true"][data-item-type="folder"] > [data-item-section="icon"]::after,
        [data-file-tree-sticky-row="true"][data-item-type="folder"] > [data-item-section="icon"]::after {
          -webkit-mask-image: ${FOLDER_OPEN_MASK};
          mask-image: ${FOLDER_OPEN_MASK};
        }
        /* The tree renders rows in its shadow root, which only takes text decorations, so this repeats Badge's neutral compact style. */
        [data-item-section="decoration"] > span {
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          height: 16px;
          padding: 0 4px;
          border-radius: 2px;
          border: 0.5px solid var(--v2-border-border-base);
          background: var(--v2-background-bg-layer-02);
          color: var(--v2-text-text-muted);
          font-size: 11px;
          font-weight: 530;
          line-height: 1;
          letter-spacing: 0.05px;
          font-variant-numeric: tabular-nums;
        }
        [data-item-section="spacing"] {
          padding-inline-start: 6.5px;
        }
        [data-item-section="spacing-item"] {
          border-left: none;
          margin-right: 0;
          border-inline-start: 1px solid color-mix(in srgb, var(--v2-border-border-muted) 50%, transparent);
          margin-inline-end: calc(var(--trees-level-gap) - 1px);
          transform: none;
        }
        /* The tree always reserves a lane for git change letters. */
        [data-item-section="git"] {
          display: none;
        }
        [data-file-tree-virtualized-scroll] {
          overscroll-behavior: contain;
        }
        /* @pierre/trees reveals middle-truncation markers at height > 1lh, which trips on subpixel rounding at
           fractional UI zoom; overflowing text wraps to >= 2lh, so 1.5lh sits cleanly between fitting and overflowing rows. */
        [data-truncate-marker] {
          opacity: 0;
          transition: opacity var(--truncate-internal-marker-fade-out-duration) ease-in-out;
        }
        @container measure (height > 1.5lh) {
          [data-truncate-marker] {
            opacity: 1;
            transition: opacity var(--truncate-internal-marker-fade-in-duration) ease-in-out;
          }
        }
      `,
      onExpansionChange(change) {
        if (change.expanded) dispatchTree({ type: "dir.expanded", dir: change.path })
      },
      onSelectionChange(paths) {
        dispatchTree({ type: "tree.selected", path: paths.at(-1) })
      },
    })

    if (!container) return
    tree.render({ containerWrapper: container })
    tree.getFileTreeContainer()?.classList.add("directory-picker-tree")
  })

  // Opens the first root. Without a dialog location the tree first resolves the server's default one.
  createEffect(() => {
    if (treeMachine().status !== "booting") return

    if (!location()) return dispatchTree({ type: "location.requested" })
    const path = start()

    if (path) dispatchTree({ type: "navigate", ...navigation(path) })
  })

  createEffect(on(committed, () => dispatchCombobox({ type: "synced" }), { defer: true }))

  // Suggestions search against the root and location, so a search started before either arrived runs again.
  createEffect(
    on([() => location()?.directory, treeRoot], () => dispatchCombobox({ type: "context.changed" }), {
      defer: true,
    }),
  )

  onCleanup(() => {
    dispatchTree({ type: "disposed" })
    dispatchCombobox({ type: "disposed" })
    search.dispose()
    tree?.cleanUp()
  })

  return (
    <Dialog size="large" fit class="directory-picker">
      <DialogHeader>
        <div class="directory-picker-header">
          <DialogTitle>{props.title ?? language.t("command.project.open")}</DialogTitle>
          <Show when={subtitle()}>
            {(value) => (
              <span class="directory-picker-server" dir="ltr">
                <Icon name="server" />
                <span class="truncate">{value()}</span>
              </span>
            )}
          </Show>
        </div>
      </DialogHeader>
      <Divider />
      <DialogBody class="directory-picker-body">
        <div class="directory-picker-path" ref={pathArea}>
          <TextInput
            value={comboboxView().input}
            placeholder={language.t("dialog.directory.search.placeholder")}
            autofocus
            autocomplete="off"
            spellcheck={false}
            showClearButton={!!comboboxView().input}
            onClearClick={() => dispatchCombobox({ type: "cleared" })}
            class="directory-picker-input"
            data-owns-escape={ownsPickerEscape(machines().combobox, committed()) ? "" : undefined}
            appearance="large"
            leadingIcon={<Icon name="magnifying-glass" />}
            onInput={(event) => dispatchCombobox({ type: "input.changed", value: event.currentTarget.value })}
            role="combobox"
            aria-label={language.t("dialog.directory.search.placeholder")}
            aria-autocomplete="list"
            aria-expanded={comboboxView().listboxOpen}
            aria-controls="directory-picker-suggestions"
            aria-activedescendant={comboboxView().activeDescendant}
            onKeyDown={(event) => {
              // Goes up a level from the shown selection; a held key that just cleared the text must not keep climbing.
              if (
                event.key === "Backspace" &&
                !event.repeat &&
                !event.isComposing &&
                atSelection(event.currentTarget)
              ) {
                event.preventDefault()
                const selected = treeView().selected

                return selected ? choose(pickerParent(selected)) : navigate(pickerParent(treeView().root))
              }

              const next = dispatchCombobox({
                type: "key.down",
                key: event.key,
                shiftKey: event.shiftKey,
                composing: event.isComposing,
              })

              if (next.preventDefault) event.preventDefault()

              if (next.stopPropagation) event.stopPropagation()
            }}
          />
          <Show when={comboboxView().listboxOpen}>
            <div data-component="menu-v2-content" class="directory-picker-suggestions">
              <MenuScroll viewportClass="directory-picker-suggestions-viewport">
                <div id="directory-picker-suggestions" role="listbox">
                  <For each={comboboxView().items}>
                    {(suggestion, index) => (
                      <div
                        id={`directory-picker-suggestion-${index()}`}
                        data-component="menu-v2-item"
                        data-directory-path={suggestion.absolute}
                        role="option"
                        aria-selected={index() === comboboxView().active}
                        data-highlighted={index() === comboboxView().active ? "" : undefined}
                        onPointerMove={() => dispatchCombobox({ type: "item.hovered", index: index() })}
                        onClick={() => dispatchCombobox({ type: "item.clicked", index: index() })}
                      >
                        <span data-slot="menu-v2-item-content">
                          <Icon name={suggestion.type === "directory" ? "folder" : "open-file"} />
                          <span class="directory-picker-item-name">
                            {pickerBreadcrumbs(suggestion.absolute, home()).at(-1)?.label}
                          </span>
                          <bdi dir="ltr" class="directory-picker-item-path">
                            {shortenPickerRecentPath(pickerParent(suggestion.absolute), home())}
                          </bdi>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </MenuScroll>
            </div>
          </Show>
        </div>
        <Show when={recentProjects().length > 0}>
          <div class="directory-picker-recent" aria-label={language.t("dialog.directory.recent")} role="group">
            <For each={recentProjects().slice(0, 3)}>
              {(project) => {
                const name = () => displayName(project)
                const shortPath = () => shortenPickerRecentPath(project.worktree, home())

                return (
                  <Tooltip
                    placement="top"
                    value={<bdi dir="ltr">{displayPickerPath(project.worktree, "", home())}</bdi>}
                  >
                    <Button
                      size="small"
                      variant="neutral"
                      class="directory-picker-recent-item"
                      aria-label={language.t("dialog.directory.recentProject", { name: name(), path: shortPath() })}
                      onClick={() => choose(project.worktree)}
                    >
                      <ProjectAvatar
                        class="shrink-0"
                        aria-hidden="true"
                        fallback={name()}
                        src={getProjectAvatarSource(project.id, project.icon)}
                        variant={getProjectAvatarVariant(project.icon?.color)}
                        generated={getProjectAvatarGenerated(project)}
                      />
                      <span class="min-w-0 truncate">{name()}</span>
                    </Button>
                  </Tooltip>
                )
              }}
            </For>
            <Show when={recentProjects().length > 3}>
              <Menu gutter={4} modal={false} placement="bottom-start">
                <Menu.Trigger as={Button} size="small" variant="neutral">
                  {language.t("dialog.directory.moreProjects")}
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content class="directory-picker-recent-menu">
                    <For each={recentProjects().slice(3)}>
                      {(project) => {
                        const name = () => displayName(project)
                        const shortPath = () => shortenPickerRecentPath(project.worktree, home())

                        return (
                          <Menu.Item
                            aria-label={language.t("dialog.directory.recentProject", {
                              name: name(),
                              path: shortPath(),
                            })}
                            onSelect={() => choose(project.worktree)}
                          >
                            <ProjectAvatar
                              class="shrink-0"
                              aria-hidden="true"
                              fallback={name()}
                              src={getProjectAvatarSource(project.id, project.icon)}
                              variant={getProjectAvatarVariant(project.icon?.color)}
                              generated={getProjectAvatarGenerated(project)}
                            />
                            <span class="directory-picker-item-name">{name()}</span>
                            <bdi dir="ltr" class="directory-picker-item-path">
                              {shortPath()}
                            </bdi>
                          </Menu.Item>
                        )
                      }}
                    </For>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </Show>
          </div>
        </Show>
        <div class="directory-picker-folder">
          <div class="directory-picker-folder-header">
            <nav class="directory-picker-breadcrumbs" aria-label={language.t("dialog.directory.breadcrumbs")} dir="ltr">
              <For each={breadcrumbs()}>
                {(crumb, index) => (
                  <>
                    <Show when={index() > 0}>
                      <Icon name="chevron-right" class="directory-picker-breadcrumb-separator" />
                    </Show>
                    <button
                      type="button"
                      class="directory-picker-breadcrumb"
                      aria-current={index() === breadcrumbs().length - 1 ? "location" : undefined}
                      onClick={() => navigate(crumb.path)}
                    >
                      {crumb.label}
                    </button>
                  </>
                )}
              </For>
            </nav>
            <Show when={policy.action === "directory"}>
              <Button
                ref={newFolderTrigger}
                size="small"
                variant="ghost-muted"
                icon="plus"
                class="directory-picker-new-folder-button"
                disabled={!location() || !treeView().root || newFolder().busy}
                onClick={() => setNewFolder({ open: true, name: "", busy: false })}
              >
                {language.t("dialog.directory.newFolder")}
              </Button>
            </Show>
          </div>
          <Show when={newFolder().open}>
            <form
              class="directory-picker-new-folder"
              data-owns-escape=""
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.isComposing) return
                event.preventDefault()
                if (newFolder().busy) return
                event.stopPropagation()
                closeNewFolder()
              }}
              onSubmit={(event) => {
                event.preventDefault()
                void createFolder()
              }}
            >
              <TextInput
                class="directory-picker-new-folder-input"
                appearance="small"
                value={newFolder().name}
                placeholder={language.t("dialog.directory.newFolder.placeholder")}
                autofocus
                autocomplete="off"
                spellcheck={false}
                aria-label={language.t("dialog.directory.newFolder.placeholder")}
                invalid={!!newFolder().error}
                onInput={(event) =>
                  setNewFolder((state) => ({ ...state, name: event.currentTarget.value, error: undefined }))
                }
              />
              <Button
                type="submit"
                size="small"
                variant="contrast"
                disabled={newFolder().busy || !newFolder().name.trim()}
              >
                {newFolder().busy
                  ? language.t("dialog.directory.newFolder.creating")
                  : language.t("dialog.directory.newFolder.create")}
              </Button>
              <Button type="button" size="small" variant="neutral" disabled={newFolder().busy} onClick={closeNewFolder}>
                {language.t("common.cancel")}
              </Button>
            </form>
            <Show when={newFolder().error}>
              {(error) => (
                <p class="directory-picker-new-folder-error" role="alert">
                  {error()}
                </p>
              )}
            </Show>
          </Show>
          <div
            class="directory-picker-browser"
            ref={container}
            // The modal's scroll lock sees only the shadow host, not the tree's inner scroller. Stopping the event here
            // keeps the lock from cancelling it, and the passive listener leaves the scroller to the compositor.
            on:touchmove={(event) => event.stopPropagation()}
            on:wheel={{ handleEvent: (event: WheelEvent) => event.stopPropagation(), passive: true }}
          >
            <Show when={treeView().loading}>
              <div class="directory-picker-state">{language.t("common.loading")}</div>
            </Show>
            <Show when={treeView().error}>
              <div class="directory-picker-state">{language.t("dialog.directory.readError")}</div>
            </Show>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button
          variant="contrast"
          disabled={!treeView().result && !comboboxView().input}
          onClick={() => dispatchCombobox({ type: "submitted" })}
        >
          {action[policy.action]}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
