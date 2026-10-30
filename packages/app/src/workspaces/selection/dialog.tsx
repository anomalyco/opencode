import "@pierre/trees/web-components"
import { FileTree } from "@pierre/trees"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { Divider } from "@opencode/ui/divider"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
import { getFilename } from "@opencode/util/path"
import { createEffect, createMemo, createResource, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobal } from "@/runtime/server/runtime"
import { inferHomeDirectory } from "@/runtime/server/global-sync/bootstrap"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { pathKey } from "@/workspaces/path-key"
import type { LocationRef } from "@opencode/client/promise"
import {
  absoluteTreePath,
  activeTreeNavigation,
  canonicalPickerPath,
  nextSuggestionIndex,
  pickerFileSearchQuery,
  pickerAbsoluteInput,
  pickerMode,
  cleanPickerInput,
  createPriorityTaskQueue,
  createDirectorySearch,
  currentPickerSuggestions,
  displayPickerPath,
  shortenPickerRecentPath,
  pickerParent,
  pickerRoot,
  listPickerDirectory,
  pickerRelativePath,
  pickerAbsolutePath,
} from "./domain"
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

export function DirectoryPickerDialog(props: DirectoryPickerDialogProps) {
  const global = useGlobal()
  const servers = useServers()
  const serverCtx = global.ensureServerCtx(props.server)
  const sync = serverCtx.sync
  const sdk = serverCtx.sdk
  const dialog = useDialog()
  const language = useLanguage()
  const policy = pickerMode(props.mode ?? "directory", props.start)

  const action = {
    file: language.t("dialog.directory.action.selectFile"),
    directory: language.t("dialog.directory.action.selectFolder"),
  }

  const [state, setState] = createStore({
    root: "",
    input: "",
    selected: "",
    suggestionsOpen: false,
    activeSuggestion: -1,
    loading: false,
    error: false,
    rootValid: false,
  })

  const listings = new Map<string, Promise<Array<{ name: string; type: "file" | "directory" }> | undefined>>()
  const loads = createPriorityTaskQueue<Array<{ name: string; type: "file" | "directory" }> | undefined>(3)
  const gitRepos = new Set<string>()
  let tree: FileTree | undefined
  let container: HTMLDivElement | undefined
  let pathArea: HTMLDivElement | undefined
  let navigation = 0

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

  const [fallbackPath] = createResource(
    () => (props.location ? undefined : true),
    () => sdk.api.location.get().catch(() => undefined),
    { initialValue: undefined },
  )

  const home = createMemo(
    () =>
      sync.data.path.home || inferHomeDirectory(props.location?.directory ?? ""),
  )

  const subtitle = createMemo(() => (servers.local(props.server) ? undefined : serverName(props.server)))

  const location = createMemo(() => {
    const current = props.location ?? fallbackPath.latest

    return current ? { directory: current.directory } : undefined
  })

  const start = createMemo(
    () =>
      props.start ||
      home() ||
      props.location?.directory ||
      sync.data.path.directory ||
      fallbackPath.latest?.directory,
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
      .slice(0, 5)
  })

  const search = createDirectorySearch({ sdk, home, location, base: () => state.root || start() })

  const [suggestions] = createResource(
    () => state.input,
    async (value) => {
      const cleaned = cleanPickerInput(value)
      const typed = cleaned.replace(/\/+$/, "")
      const current = displayPickerPath(state.root, value, home()).replace(/\/+$/, "")

      if (!cleaned || (state.root && typed === current)) return { query: value, items: [] }
      const directories = (await search(value)).map((absolute) => ({ absolute, type: "directory" as const }))

      if (!policy.includeFiles) return { query: value, items: directories.slice(0, 5) }
      const base = location()?.directory

      if (!base) return { query: value, items: directories.slice(0, 5) }
      const query = pickerRelativePath(base, pickerAbsoluteInput(cleaned, home(), state.root || base))

      if (query === undefined) return { query: value, items: directories.slice(0, 5) }

      const files = await sdk.api.file
        .find({
          location: location(),
          query,
          type: "file",
          limit: 20,
        })
        .then((result) => result.data)
        .catch(() => [])

      const results = [
        ...directories,
        ...files.map((entry) => ({ absolute: pickerAbsolutePath(entry.path, base), type: "file" as const })),
      ]

      return {
        query: value,
        items: Array.from(new Map(results.map((result) => [result.absolute, result])).values()).slice(0, 8),
      }
    },
  )

  const currentSuggestions = createMemo(() =>
    currentPickerSuggestions(suggestions.latest, state.input, suggestions.loading),
  )
  const resolvedResult = createMemo(() => policy.result(state.root, state.selected, state.rootValid))
  const fullSelectionPath = createMemo(() => {
    const value = resolvedResult()

    return value ? displayPickerPath(value, "", home()) : ""
  })
  const shortSelectionPath = createMemo(() => {
    const value = resolvedResult()

    return value ? shortenPickerRecentPath(value, home()) : ""
  })

  async function load(path: string, generation: number, priority: "user" | "background" = "user") {
    const key = path.replace(/\/+$/, "")
    setState("error", false)
    const absolute = absoluteTreePath(state.root, key)
    const existing = listings.get(key)

    if (existing && priority === "user") loads.promote(`${generation}:${key}`)

    const request =
      existing ??
      loads.schedule(`${generation}:${key}`, priority, () => {
        if (!activeTreeNavigation(generation, navigation)) return Promise.resolve(undefined)
        const current = location()

        if (!current) return Promise.resolve(undefined)

        return listPickerDirectory(sdk, current, absolute).catch(() => undefined)
      })

    listings.set(key, request)
    const nodes = await request

    if (!activeTreeNavigation(generation, navigation)) return false

    if (!nodes) {
      listings.delete(key)

      if (!key) setState("error", true)

      return false
    }

    const isRepo = nodes.some((node) => node.name === ".git")
    const repoKey = pathKey(canonicalPickerPath(absolute))
    const newlyDiscoveredRepo = isRepo && !gitRepos.has(repoKey)

    if (newlyDiscoveredRepo) gitRepos.add(repoKey)

    const entries = policy
      .entries(
        key,
        nodes.filter((node) => node.name !== ".git"),
      )
      .filter((item) => !tree?.getItem(item))

    if (entries.length > 0) {
      tree?.batch(entries.map((item) => ({ type: "add", path: item })))
    }

    if (newlyDiscoveredRepo) {
      tree?.setComposition(tree.getComposition())
    }

    // Preloading the root's folders makes their first expand instant and finds git repos for the badge.
    if (!key && priority === "user") {
      for (const node of nodes) {
        if (node.type === "directory" && node.name !== ".git") void load(node.name, generation, "background")
      }
    }

    return true
  }

  function displayInputDirectory(path: string) {
    const displayed = displayPickerPath(path, state.input, home())
    const separator = displayed.includes("\\") ? "\\" : "/"

    return displayed.endsWith(separator) ? displayed : displayed + separator
  }

  function expandTreeDirectory(path: string) {
    const item = tree?.getItem(`${path}/`)

    if (item && "expand" in item && !item.isExpanded()) item.expand()
  }

  function selectOnlyTreeItem(entry: string) {
    for (const selectedPath of tree?.getSelectedPaths() ?? []) {
      if (selectedPath !== entry) tree?.getItem(selectedPath)?.deselect()
    }
    tree?.getItem(entry)?.select()
    tree?.focusPath(entry)
    // The tree measures newly expanded rows after this frame, so an immediate scroll clamps to the old height.
    requestAnimationFrame(() => tree?.scrollToPath(entry, { offset: "center" }))
  }

  async function navigate(path: string, options?: { selectChild?: string; input?: string }) {
    const value = policy.navigation(
      pickerAbsoluteInput(cleanPickerInput(path), home(), state.root || start() || home()),
    )

    if (!value) return
    const token = ++navigation
    setState({
      loading: true,
      rootValid: false,
      selected: "",
      suggestionsOpen: false,
      activeSuggestion: -1,
      root: value,
      input: options?.input ?? "",
    })
    listings.clear()
    tree?.resetPaths([])
    const valid = await load("", token)

    if (!activeTreeNavigation(token, navigation)) return
    setState({
      rootValid: valid,
      loading: false,
    })

    if (!valid) return

    if (!options?.selectChild) {
      if (!tree?.getFocusedPath()) tree?.focusNearestPath(null)

      return
    }

    const entry = `${getFilename(options.selectChild)}/`
    selectOnlyTreeItem(entry)
    setState("selected", policy.selection(value, entry) ?? options.selectChild)
  }

  async function selectDirectory(path: string, options?: { fromInput?: boolean }) {
    const value = policy.navigation(
      pickerAbsoluteInput(cleanPickerInput(path), home(), state.root || start() || home()),
    )

    if (!value) return
    const nextInput = options?.fromInput ? displayInputDirectory(value) : state.input
    const relative = state.root && state.rootValid ? pickerRelativePath(state.root, value) : undefined

    if (relative === "") {
      for (const selectedPath of tree?.getSelectedPaths() ?? []) {
        tree?.getItem(selectedPath)?.deselect()
      }
      tree?.focusNearestPath(null)
      setState({
        selected: "",
        suggestionsOpen: false,
        activeSuggestion: -1,
        input: nextInput,
      })

      return
    }

    if (relative) {
      const token = navigation
      const segments = relative.split("/").filter(Boolean)
      const entry = `${relative}/`
      setState({
        suggestionsOpen: false,
        activeSuggestion: -1,
        input: nextInput,
      })

      const ancestors = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))

      for (const ancestor of ancestors) {
        const loaded = await load(ancestor, token)

        if (!activeTreeNavigation(token, navigation)) return

        if (!loaded) break
        expandTreeDirectory(ancestor)
      }

      if (!tree?.getItem(entry)) {
        await navigate(value, { input: nextInput })

        return
      }

      selectOnlyTreeItem(entry)
      setState("selected", policy.selection(state.root, entry) ?? value)

      if (!options?.fromInput) return
      expandTreeDirectory(relative)
      await load(relative, token)

      return
    }

    const parent = pickerParent(value)
    const leaf = getFilename(value)

    if (parent && leaf && parent !== value && parent === home()) {
      await navigate(parent, { selectChild: value, input: nextInput })

      return
    }

    await navigate(value, { input: nextInput })
  }

  function complete() {
    const items = currentSuggestions()
    const match = items[state.activeSuggestion] ?? items[0]

    if (!match) return
    const value = displayPickerPath(match.absolute, state.input, home())
    setState("input", match.type === "directory" && !value.endsWith("/") ? value + "/" : value)

    if (match.type === "file") {
      setState({
        selected: policy.selection(state.root, pickerFileSearchQuery(state.root, match.absolute, home())) ?? "",
        suggestionsOpen: false,
        activeSuggestion: -1,
      })
    }
  }

  function chooseSuggestion(suggestion: { absolute: string; type: "file" | "directory" }) {
    if (suggestion.type === "directory") {
      void selectDirectory(suggestion.absolute, { fromInput: true })

      return
    }

    setState({
      input: displayPickerPath(suggestion.absolute, state.input, home()),
      selected: policy.selection(state.root, pickerFileSearchQuery(state.root, suggestion.absolute, home())) ?? "",
      suggestionsOpen: false,
      activeSuggestion: -1,
    })
  }

  function moveSuggestion(delta: -1 | 1) {
    setState("suggestionsOpen", true)
    setState("activeSuggestion", nextSuggestionIndex(activeSuggestionIndex(), delta, currentSuggestions().length))
  }

  function activeSuggestionIndex() {
    if (!state.suggestionsOpen) return -1
    if (state.activeSuggestion >= 0) return state.activeSuggestion
    const raw = cleanPickerInput(state.input)

    if (raw === "~" || raw === "~/" || raw === "/" || raw.endsWith("/")) return -1

    return currentSuggestions().length > 0 ? 0 : -1
  }

  function activeSuggestionValue() {
    return currentSuggestions()[activeSuggestionIndex()]
  }

  const keyActions = new Map([
    ["ArrowDown", () => moveSuggestion(1)],
    ["ArrowUp", () => moveSuggestion(-1)],
    [
      "Enter",
      () => {
        const suggestion = activeSuggestionValue()

        if (suggestion) {
          chooseSuggestion(suggestion)

          return
        }

        if (state.input.trim()) void selectDirectory(state.input, { fromInput: true })
      },
    ],
    ["Tab", complete],
  ])

  function handleInputKey(event: KeyboardEvent) {
    if (event.key === "Escape" && state.suggestionsOpen && currentSuggestions().length > 0) {
      event.preventDefault()
      event.stopPropagation()
      setState({
        suggestionsOpen: false,
        activeSuggestion: -1,
      })

      return
    }

    if (event.key === "Tab") {
      if (event.shiftKey || !state.suggestionsOpen || currentSuggestions().length === 0) return
      event.preventDefault()
      complete()

      return
    }

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && currentSuggestions().length === 0) return

    const action = keyActions.get(event.key)

    if (!action) return
    event.preventDefault()
    action()
  }

  function resolve() {
    const path = resolvedResult()

    if (!path) return
    props.onSelect(props.multiple ? [path] : path)
    dialog.close()
  }

  onMount(() => {
    const closeSuggestions = (event: PointerEvent) => {
      if (event.target instanceof Node && pathArea?.contains(event.target)) return
      setState({
        suggestionsOpen: false,
        activeSuggestion: -1,
      })
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
        const key = pathKey(canonicalPickerPath(absoluteTreePath(state.root, context.item.path)))

        if (!gitRepos.has(key) && !knownGitRepos().has(key)) return null

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
          font-weight: 440 !important;
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
          box-shadow: inset 0 0 0 0.5px var(--v2-border-border-base) !important;
          color: var(--v2-text-text-base) !important;
          font-weight: 530 !important;
        }
        button[data-type="item"]:focus-visible {
          outline: none !important;
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
        [data-item-section="decoration"] > span {
          height: 16px;
          padding: 0 4px;
          border-radius: 2px;
          background: var(--v2-background-bg-layer-03);
          color: var(--v2-text-text-muted);
          font-size: 11px;
          font-weight: 530;
          line-height: 12px;
          letter-spacing: 0.05px;
        }
        [data-file-tree-virtualized-scroll] {
          overscroll-behavior: contain;
        }
      `,
      onExpansionChange(change) {
        if (change.expanded) void load(change.path, navigation)
      },
      onSelectionChange(paths) {
        const path = paths.at(-1)
        setState("selected", path ? (policy.selection(state.root, path) ?? "") : "")
      },
    })

    if (!container) return
    tree.render({ containerWrapper: container })
    tree.getFileTreeContainer()?.classList.add("directory-picker-tree")
  })

  createEffect(() => {
    const path = start()

    if (!path || !location() || state.root) return
    void navigate(path)
  })

  onCleanup(() => tree?.cleanUp())

  return (
    <Dialog size="large" fit class="directory-picker">
      <DialogHeader>
        <div class="directory-picker-header">
          <DialogTitle>{props.title ?? language.t("command.project.open")}</DialogTitle>
          <Show when={subtitle()}>
            {(value) => (
              <div class="directory-picker-subtitle" dir="ltr">
                {value()}
              </div>
            )}
          </Show>
        </div>
      </DialogHeader>
      <Divider />
      <DialogBody class="directory-picker-body">
        <div class="directory-picker-path" ref={pathArea}>
          <TextInput
            value={state.input}
            placeholder={language.t("dialog.directory.search.placeholder")}
            autofocus
            autocomplete="off"
            spellcheck={false}
            showClearButton={!!state.input}
            onClearClick={() => {
              setState({
                input: "",
                suggestionsOpen: false,
                activeSuggestion: -1,
              })
            }}
            class="directory-picker-input"
            onInput={(event) => {
              setState({
                input: cleanPickerInput(event.currentTarget.value),
                selected: "",
                suggestionsOpen: true,
                activeSuggestion: -1,
              })
            }}
            role="combobox"
            aria-label={language.t("dialog.directory.search.placeholder")}
            aria-autocomplete="list"
            aria-expanded={state.suggestionsOpen}
            aria-controls="directory-picker-suggestions"
            aria-activedescendant={
              activeSuggestionIndex() >= 0 ? `directory-picker-suggestion-${activeSuggestionIndex()}` : undefined
            }
            onKeyDown={handleInputKey}
          />
          <div class="directory-picker-actions">
            <Button size="normal" variant="ghost" onClick={() => void navigate(home() || state.root)}>
              ~
            </Button>
            <Button size="normal" variant="ghost" onClick={() => void navigate(pickerRoot(state.root) || state.root)}>
              {language.t("dialog.directory.root")}
            </Button>
            <Button
              size="normal"
              variant="ghost"
              onClick={() => void navigate(pickerParent(state.selected || state.root))}
            >
              {language.t("dialog.directory.parent")}
            </Button>
          </div>
          <Show when={state.suggestionsOpen && currentSuggestions().length > 0}>
            <div id="directory-picker-suggestions" role="listbox" class="directory-picker-suggestions">
              <For each={currentSuggestions()}>
                {(suggestion, index) => (
                  <button
                    id={`directory-picker-suggestion-${index()}`}
                    data-directory-path={suggestion.absolute}
                    role="option"
                    aria-selected={index() === activeSuggestionIndex()}
                    data-active={index() === activeSuggestionIndex() ? "" : undefined}
                    onPointerMove={() => setState("activeSuggestion", index())}
                    onClick={() => chooseSuggestion(suggestion)}
                  >
                    {displayPickerPath(suggestion.absolute, state.input, home())}
                    {suggestion.type === "directory" ? "/" : ""}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={recentProjects().length > 0}>
          <div class="directory-picker-recent">
            <div class="directory-picker-recent-label">{language.t("dialog.directory.recent")}</div>
            <div class="directory-picker-recent-list">
              <For each={recentProjects()}>
                {(project) => {
                  const name = () => displayName(project)
                  const fullPath = () => displayPickerPath(project.worktree, "", home())
                  const shortPath = () => shortenPickerRecentPath(project.worktree, home())

                  return (
                    <Tooltip placement="top" value={<bdi dir="ltr">{fullPath()}</bdi>}>
                      <Button
                        size="normal"
                        variant="neutral"
                        class="directory-picker-recent-item"
                        aria-label={language.t("dialog.directory.recentProject", {
                          name: name(),
                          path: shortPath(),
                        })}
                        onClick={() => void selectDirectory(project.worktree)}
                      >
                        <ProjectAvatar
                          class="shrink-0"
                          aria-hidden="true"
                          fallback={name()}
                          src={getProjectAvatarSource(project.id, project.icon)}
                          variant={getProjectAvatarVariant(project.icon?.color)}
                        />
                        <span class="min-w-0 truncate">{name()}</span>
                      </Button>
                    </Tooltip>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
        <div
          class="directory-picker-browser"
          ref={container}
          // The modal's scroll lock sees only the shadow host, not the tree's inner scroller. Stopping the event here
          // keeps the lock from cancelling it, and the passive listener leaves the scroller to the compositor.
          on:touchmove={(event) => event.stopPropagation()}
          on:wheel={{ handleEvent: (event: WheelEvent) => event.stopPropagation(), passive: true }}
        >
          <Show when={state.loading}>
            <div class="directory-picker-state">{language.t("common.loading")}</div>
          </Show>
          <Show when={!state.loading && state.error}>
            <div class="directory-picker-state">{language.t("dialog.directory.readError")}</div>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Tooltip
          placement="top"
          disabled={!fullSelectionPath() || fullSelectionPath() === shortSelectionPath()}
          value={<bdi dir="ltr">{fullSelectionPath()}</bdi>}
          class="directory-picker-selection"
        >
          <span dir="ltr" class="directory-picker-selection-text">
            {shortSelectionPath()}
          </span>
        </Tooltip>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={!resolvedResult()} onClick={resolve}>
          {action[policy.action]}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
