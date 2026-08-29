/** @jsxImportSource @opentui/solid */
import type { FileDiffInfo, LocationRef } from "@opencode-ai/client"
import type { Vcs } from "@opencode-ai/schema/vcs"
import { Plugin } from "@opencode-ai/plugin/tui"
import type { KeymapCommand, Route } from "@opencode-ai/plugin/tui/context"
import {
  MouseButton,
  TextAttributes,
  type BoxRenderable,
  type MouseEvent,
  type ScrollBoxRenderable,
} from "@opentui/core"
import { filetype } from "../../util/filetype"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { DiffViewerFileTree } from "./diff-viewer-file-tree"
import { DiffViewerImage, isDiffImageFile } from "./diff-viewer-image"
import { DialogSelect } from "../../ui/dialog-select"
import { EmptyBorder } from "../../ui/border"
import { FilePath } from "../../ui/file-path"
import { getScrollAcceleration } from "../../util/scroll"
import { createDebouncedSignal } from "../../util/signal"
import { useConfig } from "../../config"
import { locationKey } from "../../context/data"
import { useThemes } from "../../context/theme"
import { PatchDiff, type PatchDiffRef } from "../../component/patch-diff"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  type FileTreeRow,
  flattenFileTree,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  showDiffViewerFileTree,
  singlePatchFileIndex,
  toggleFileTreeDirectory,
} from "./diff-viewer-file-tree-utils"

const ROUTE = "diff"
const MIN_SPLIT_WIDTH = 100
const FILE_TREE_MIN_WIDTH = 30
const FILE_TREE_MAX_WIDTH = 40
const FILE_HEADER_HEIGHT = 2
const VCS_DIFF_CONTEXT_LINES = 12
type DiffMode = Vcs.Mode
type DiffView = "split" | "unified"
type SelectedHunk = { readonly fileIndex: number; readonly hunkIndex: number; readonly scrollTop: number }
type FileMenuState = { readonly fileIndex: number; readonly x: number; readonly y: number }

export type DiffFile = {
  readonly file: string
  readonly patch?: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

const normalizeDiffs = (diffs: readonly FileDiffInfo[]): DiffFile[] =>
  diffs.map((item) => ({
    file: item.file,
    patch: item.patch,
    additions: item.additions,
    deletions: item.deletions,
    status: item.status,
  }))

function storedView(value: unknown): DiffView | undefined {
  if (value === "split" || value === "unified") return value
}

function diffSourceLabel(mode: DiffMode) {
  if (mode === "branch") return "All"
  if (mode === "committed") return "Committed"
  return "Uncommitted"
}

function DiffViewer(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const config = useConfig()
  const [memory, updateMemory] = props.context.storage.memory<{
    source?: DiffMode
    bases: Record<string, string>
  }>("review", { initial: { bases: {} } })
  const params = () => {
    const route = props.context.ui.router.current()
    return (route.type === "plugin" ? route.data : undefined) as
      | {
          mode?: DiffMode
          sessionID?: string
          returnRoute?: Route
        }
      | undefined
  }
  const [mode, setMode] = createSignal(params()?.mode ?? memory.source ?? config.data.diffs?.source ?? "branch")
  const location = createMemo(
    () => {
      const sessionID = params()?.sessionID
      return sessionID
        ? (props.context.data.session.get(sessionID)?.location ?? props.context.data.location.default())
        : props.context.data.location.default()
    },
    undefined,
    { equals: (a, b) => a.directory === b.directory && a.workspaceID === b.workspaceID },
  )
  const baseKey = createMemo(() =>
    JSON.stringify([locationKey(location()), props.context.data.location.vcs.info(location())?.branch.current]),
  )
  const selectedBase = () => memory.bases[baseKey()]
  // Mode changes share the same lazy base lookup until this viewer is closed.
  const bases = new Map<string, ReturnType<Plugin.Context["client"]["vcs"]["base"]>>()
  const [reportedBases, setReportedBases] = createSignal<ReadonlyMap<string, Vcs.Base | null>>(new Map())
  const loadBase = (location: LocationRef, key: string) => {
    const cached = bases.get(key)
    if (cached) return cached
    const pending = props.context.client.vcs.base({ location }).then((result) => {
      setReportedBases((known) => new Map(known).set(key, result.data))
      return result
    })
    bases.set(key, pending)
    return pending
  }
  const diffInput = createMemo(() => ({
    mode: mode(),
    location: location(),
    key: baseKey(),
    selected: mode() === "working" ? undefined : selectedBase(),
  }))
  const [diff] = createResource(diffInput, async (input) => {
    const base =
      input.mode === "working"
        ? undefined
        : input.selected
          ? { name: input.selected, ref: input.selected }
          : (await loadBase(input.location, input.key)).data
    if (input !== diffInput() || (input.mode === "committed" && !base)) {
      return { base: null, files: [] }
    }
    const result = await props.context.client.vcs.diff({
      location: input.location,
      mode: input.mode,
      ...(base ? { base: base.ref } : {}),
      context: VCS_DIFF_CONTEXT_LINES,
    })
    return { base, files: normalizeDiffs(result.data ?? []) }
  })
  const sourceBase = () => {
    const ref = selectedBase()
    return ref ? { name: ref, ref } : reportedBases().get(baseKey())
  }
  const result = () => (diff.error || diff.loading ? undefined : diff())
  const sourceDetail = () => {
    if (mode() === "working") return "vs HEAD"
    if (diff.error) return "Base or diff unavailable"
    if (!result()) return "Resolving diff..."
    const base = result()?.base
    if (!base) return "Base not reported"
    return `vs ${base.name}`
  }

  return (
    <box position="absolute" zIndex={2500} left={0} top={0} width={dimensions().width} height={dimensions().height}>
      <DiffViewerContent
        context={props.context}
        files={result()?.files ?? []}
        loading={diff.loading}
        error={diff.error}
        mode={mode()}
        sourceDetail={sourceDetail()}
        sourceBase={sourceBase()}
        unavailable={mode() === "committed" && !!result() && !result()?.base}
        preferences={config.data.diffs}
        loadImage={(file, signal) => props.context.client.file.read({ path: file, location: location() }, { signal })}
        onPreferencesChange={(value) => {
          void config
            .update((draft) => {
              draft.diffs = { ...draft.diffs, ...value }
            })
            .catch(() => {})
        }}
        onClose={() => props.context.ui.router.navigate(params()?.returnRoute ?? { type: "home" })}
        onSwitchSource={(mode) => {
          updateMemory((draft) => {
            draft.source = mode
          })
          setMode(mode)
        }}
        onChooseBase={() => {
          const target = { ...location() }
          const key = baseKey()
          if (!memory.bases[key]) void loadBase(target, key).catch(() => {})
          props.context.ui.dialog.show(() => (
            <DiffBaseDialog
              context={props.context}
              location={target}
              current={memory.bases[key] ?? reportedBases().get(key)?.ref}
              onSelect={(ref) =>
                updateMemory((draft) => {
                  draft.bases[key] = ref
                })
              }
            />
          ))
        }}
      />
    </box>
  )
}

function DiffBaseDialog(props: {
  context: Plugin.Context
  location: LocationRef
  current?: string
  onSelect: (ref: string) => void
}) {
  const theme = props.context.theme.contextual.elevated
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [branches] = createResource(search, (search) =>
    props.context.client.vcs.branches({ location: props.location, search, limit: 100 }),
  )
  const Empty = () => (
    <box paddingLeft={4} paddingRight={4}>
      <text fg={branches.error ? theme.text.feedback.error.default : theme.text.subdued}>
        {branches.loading
          ? "Loading branches..."
          : branches.error
            ? "Could not load branches. Reopen the picker to try again."
            : "No branches found"}
      </text>
    </box>
  )

  return (
    <DialogSelect
      title="Base branch"
      placeholder="Search local and remote branches"
      skipFilter
      current={props.current?.replace(/^refs\/(heads|remotes)\//, "")}
      onFilter={setSearch}
      emptyView={<Empty />}
      noMatchView={<Empty />}
      footer={<text fg={theme.text.subdued}>Remembered until the TUI exits</text>}
      options={(branches.loading || branches.error ? [] : (branches()?.data ?? [])).map((name) => ({
        title: name,
        value: name,
        onSelect() {
          props.onSelect(name)
          props.context.ui.dialog.clear()
        },
      }))}
    />
  )
}

type DiffPreferences = { tree?: boolean; single?: boolean; view?: "auto" | DiffView }

export function DiffViewerContent(props: {
  context: Plugin.Context
  files: readonly DiffFile[]
  loading?: boolean
  error?: unknown
  mode: DiffMode
  sourceDetail?: string
  sourceBase?: Pick<Vcs.Base, "name" | "ref"> | null
  unavailable?: boolean
  navigation?: "tree" | "list"
  loadImage?: (file: string, signal: AbortSignal) => Promise<Uint8Array>
  preferences?: DiffPreferences
  onPreferencesChange?: (value: DiffPreferences) => void
  onClose: () => void
  onSwitchSource: (mode: DiffMode) => void
  onChooseBase?: () => void
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const config = useConfig()
  const dialog = props.context.ui.dialog
  const theme = useThemes().current
  const currentSyntax = useThemes().currentSyntax
  const files = () => props.files
  const mode = () => props.mode
  const [fileTreeEnabled, setFileTreeEnabled] = createSignal(props.preferences?.tree ?? true)
  const showFileTree = createMemo(
    () => dimensions().width >= 90 && showDiffViewerFileTree(fileTreeEnabled(), files().length),
  )
  const [singlePatch, setSinglePatch] = createSignal(props.preferences?.single ?? false)
  const fileTreeWidth = createMemo(() =>
    Math.max(FILE_TREE_MIN_WIDTH, Math.min(FILE_TREE_MAX_WIDTH, Math.floor(dimensions().width / 4))),
  )
  const patchPaneWidth = createMemo(() => dimensions().width - (showFileTree() ? fileTreeWidth() : 0) - 4)
  const splitAvailable = createMemo(() => patchPaneWidth() >= MIN_SPLIT_WIDTH)
  const [viewOverride, setViewOverride] = createSignal<DiffView | undefined>(storedView(props.preferences?.view))
  const view = createMemo(() =>
    splitAvailable() ? (viewOverride() ?? storedView(props.preferences?.view) ?? "split") : "unified",
  )
  const fileTree = createMemo(() => buildFileTree(files()))
  const [expandedFileNodes, setExpandedFileNodes] = createSignal<ReadonlySet<number>>(new Set())
  const [selectedFileIndex, setSelectedFileIndex] = createSignal<number | undefined>()
  const [reviewedFileNames, setReviewedFileNames] = createSignal<ReadonlySet<string>>(new Set())
  const [fileMenu, setFileMenu] = createSignal<FileMenuState>()
  const patchScrollAcceleration = createMemo(() => getScrollAcceleration(config.data))
  const patchFileIndexes = createMemo(() => orderedPatchFileIndexes(flattenFileTree(fileTree())))
  const helpShortcut = () => props.context.keymap.shortcuts("diff.help")[0]
  let scroll: ScrollBoxRenderable | undefined
  const patchNodeByFileIndex = new Map<number, BoxRenderable>()
  const patchDiffByFileIndex = new Map<number, PatchDiffRef>()
  const [selectedHunk, setSelectedHunk] = createSignal<SelectedHunk | undefined>()
  const [pendingPatchScrollFileIndex, setPendingPatchScrollFileIndex] = createSignal<number | undefined>()

  onCleanup(() => dialog.clear())

  createEffect(() => {
    setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree()))
    setSelectedFileIndex(undefined)
    setSelectedHunk(undefined)
    setReviewedFileNames(new Set<string>())
    setFileMenu(undefined)
  })

  const clearPatchSelection = () => {
    setPendingPatchScrollFileIndex(undefined)
    setSelectedHunk(undefined)
    if (!singlePatch()) setSelectedFileIndex(undefined)
  }

  const scrollPage = (direction: -1 | 1, divisor: 1 | 2) => {
    clearPatchSelection()
    if (scroll) scroll.scrollBy(direction * Math.max(1, Math.floor(scroll.viewport.height / divisor)))
  }

  const scrollPatchNodeToTop = (patchNode: BoxRenderable, offset?: number) => {
    if (!scroll || patchNode.isDestroyed) return
    const contentY = patchNode.y - scroll.content.y
    // The fixed pane edge replaces the leading separator when jumping to a later file.
    scroll.scrollTo(contentY + (offset ?? (contentY > 0 ? 1 : 0)))
  }

  const revealFileTreeFile = (fileIndex: number) => {
    const selection = fileTreeFileSelection(fileTree(), fileIndex)
    if (!selection) return
    setExpandedFileNodes((expanded) => {
      if ([...selection.expandedNodes].every((node) => expanded.has(node))) return expanded
      const next = new Set(expanded)
      selection.expandedNodes.forEach((node) => next.add(node))
      return next
    })
  }

  const selectPatchFile = (fileIndex: number) => {
    setPendingPatchScrollFileIndex(undefined)
    revealFileTreeFile(fileIndex)
    setSelectedFileIndex(fileIndex)
  }

  const scrollToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    selectPatchFile(fileIndex)
    const patchNode = patchNodeByFileIndex.get(fileIndex)
    if (patchNode) scrollPatchNodeToTop(patchNode)
  }

  const jumpToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    setSelectedHunk(undefined)
    scrollToFileIndex(fileIndex)
    if (singlePatch()) scrollSinglePatchToTop()
  }

  const currentPatchFileIndex = () => {
    if (!scroll) return undefined
    const viewportContentY = scroll.scrollTop + 1
    const entries = patchFileIndexes()
      .map((fileIndex) => ({
        fileIndex,
        node: patchNodeByFileIndex.get(fileIndex),
      }))
      .filter((entry): entry is { fileIndex: number; node: BoxRenderable } => Boolean(entry.node))
      .map((entry) => ({
        ...entry,
        contentY: scroll!.scrollTop + entry.node.y - scroll!.viewport.y,
      }))
      .sort((left, right) => left.contentY - right.contentY)
    return entries.findLast((entry) => entry.contentY <= viewportContentY)?.fileIndex ?? entries[0]?.fileIndex
  }

  const jumpRelativePatchFile = (offset: number) => {
    setSelectedHunk(undefined)
    const next = movePatchFileIndex(patchFileIndexes(), selectedFileIndex() ?? currentPatchFileIndex(), offset)
    if (singlePatch()) {
      if (next === undefined) return
      selectPatchFile(next)
      scrollSinglePatchToTop()
      return
    }
    scrollToFileIndex(next)
  }

  const jumpRelativeHunk = (offset: -1 | 1) => {
    const patchScroll = scroll
    if (!patchScroll) return
    const hunks = visiblePatchFiles()
      .flatMap((entry) => {
        return (
          patchDiffByFileIndex
            .get(entry.fileIndex)
            ?.hunks()
            .map((node, hunkIndex) => ({
              fileIndex: entry.fileIndex,
              hunkIndex,
              contentY: patchScroll.scrollTop + node.y - patchScroll.viewport.y - (hunkIndex > 0 ? 1 : 0),
            })) ?? []
        )
      })
      .sort((left, right) => left.contentY - right.contentY)
    const selected = selectedHunk()
    const selectedIndex =
      selected?.scrollTop === patchScroll.scrollTop
        ? hunks.findIndex((hunk) => hunk.fileIndex === selected.fileIndex && hunk.hunkIndex === selected.hunkIndex)
        : -1
    const contentTop = patchScroll.scrollTop + FILE_HEADER_HEIGHT
    const next =
      selectedIndex !== -1
        ? hunks[selectedIndex + offset]
        : offset === 1
          ? hunks.find((hunk) => hunk.contentY > contentTop)
          : hunks.findLast((hunk) => hunk.contentY < contentTop)
    if (!next) return
    selectPatchFile(next.fileIndex)
    patchScroll.scrollTo(Math.max(0, next.contentY - FILE_HEADER_HEIGHT))
    setSelectedHunk({ fileIndex: next.fileIndex, hunkIndex: next.hunkIndex, scrollTop: patchScroll.scrollTop })
  }

  const firstPatchFileIndex = () => patchFileIndexes()[0]
  const visiblePatchFiles = createMemo(() => {
    if (!singlePatch()) {
      return patchFileIndexes().flatMap((fileIndex) => {
        const file = files()[fileIndex]
        return file ? [{ file, fileIndex }] : []
      })
    }
    const fileIndex = singlePatchFileIndex(selectedFileIndex(), currentPatchFileIndex(), firstPatchFileIndex())
    const file = fileIndex === undefined ? undefined : files()[fileIndex]
    return file && fileIndex !== undefined ? [{ file, fileIndex }] : []
  })

  const ensureHighlightedPatchFile = () => {
    const fileIndex = currentPatchFileIndex() ?? selectedFileIndex() ?? firstPatchFileIndex()
    if (fileIndex === undefined) return
    selectPatchFile(fileIndex)
  }

  const scrollToPatchFileIndexAfterRender = (fileIndex: number, offset?: number) => {
    setPendingPatchScrollFileIndex(fileIndex)
    requestAnimationFrame(() => {
      if (pendingPatchScrollFileIndex() !== fileIndex) return
      const patchNode = patchNodeByFileIndex.get(fileIndex)
      if (patchNode) scrollPatchNodeToTop(patchNode, offset)
      requestAnimationFrame(() => {
        if (pendingPatchScrollFileIndex() !== fileIndex) return
        const patchNode = patchNodeByFileIndex.get(fileIndex)
        if (patchNode) scrollPatchNodeToTop(patchNode, offset)
        setPendingPatchScrollFileIndex(undefined)
      })
    })
  }

  const scrollSinglePatchToTop = () => {
    requestAnimationFrame(() => {
      scroll?.scrollTo(0)
      requestAnimationFrame(() => scroll?.scrollTo(0))
    })
  }

  const registerPatchNode = (fileIndex: number, element: BoxRenderable) => {
    patchNodeByFileIndex.set(fileIndex, element)
    if (pendingPatchScrollFileIndex() !== fileIndex) return
    scrollToPatchFileIndexAfterRender(fileIndex)
  }

  const clickFileTreeRow = (row: FileTreeRow) => {
    if (row.fileIndex !== undefined) {
      jumpToFileIndex(row.fileIndex)
      return
    }
    setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree(), expanded, row.id))
  }

  const toggleFileReviewed = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    const file = files()[fileIndex]?.file
    if (!file) return
    const current = selectedFileIndex() ?? currentPatchFileIndex()
    const anchor = current === undefined ? undefined : patchNodeByFileIndex.get(current)
    const offset = anchor && scroll ? scroll.viewport.y - anchor.y : undefined
    const reviewed = reviewedFileNames().has(file)
    setReviewedFileNames((reviewed) => {
      const next = new Set(reviewed)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
    // Completing another file from its menu must not navigate away from the current file.
    if (fileIndex !== current) {
      if (current !== undefined && offset !== undefined && !singlePatch())
        scrollToPatchFileIndexAfterRender(current, offset)
      return
    }
    const nextFileIndex =
      singlePatch() && !reviewed ? (movePatchFileIndex(patchFileIndexes(), fileIndex, 1) ?? fileIndex) : fileIndex
    selectPatchFile(nextFileIndex)
    setSelectedHunk(undefined)
    scrollToPatchFileIndexAfterRender(nextFileIndex)
  }

  const openFileMenu = (fileIndex: number, event: MouseEvent) => {
    if (event.button !== MouseButton.RIGHT) return
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ fileIndex, x: event.x, y: event.y })
  }

  const close = () => {
    dialog.clear()
    props.onClose()
  }

  const commands: KeymapCommand[] = [
    {
      id: "diff.close",
      title: "Close diff viewer",
      group: "VCS",
      run: close,
    },
    {
      id: "diff.down",
      title: "Move diff viewer down",
      group: "VCS",
      run() {
        clearPatchSelection()
        scroll?.scrollBy(1)
      },
    },
    {
      id: "diff.up",
      title: "Move diff viewer up",
      group: "VCS",
      run() {
        clearPatchSelection()
        scroll?.scrollBy(-1)
      },
    },
    {
      id: "diff.page.down",
      title: "Page diff viewer down",
      group: "VCS",
      run: () => scrollPage(1, 1),
    },
    {
      id: "diff.page.up",
      title: "Page diff viewer up",
      group: "VCS",
      run: () => scrollPage(-1, 1),
    },
    {
      id: "diff.half_page.down",
      title: "Scroll down half a page",
      group: "VCS",
      run: () => scrollPage(1, 2),
    },
    {
      id: "diff.half_page.up",
      title: "Scroll up half a page",
      group: "VCS",
      run: () => scrollPage(-1, 2),
    },
    {
      id: "diff.first",
      title: "Go to the start of the diff",
      group: "VCS",
      run() {
        clearPatchSelection()
        scroll?.scrollTo(0)
      },
    },
    {
      id: "diff.last",
      title: "Go to the end of the diff",
      group: "VCS",
      run() {
        clearPatchSelection()
        if (scroll) scroll.scrollTo(scroll.scrollHeight)
      },
    },
    {
      id: "diff.next_hunk",
      title: "Jump to next diff hunk",
      group: "VCS",
      run() {
        jumpRelativeHunk(1)
      },
    },
    {
      id: "diff.previous_hunk",
      title: "Jump to previous diff hunk",
      group: "VCS",
      run() {
        jumpRelativeHunk(-1)
      },
    },
    {
      id: "diff.next_file",
      title: "Jump to next diff file",
      group: "VCS",
      run() {
        jumpRelativePatchFile(1)
      },
    },
    {
      id: "diff.previous_file",
      title: "Jump to previous diff file",
      group: "VCS",
      run() {
        jumpRelativePatchFile(-1)
      },
    },
    {
      id: "diff.mark_reviewed",
      title: "Toggle selected diff file reviewed",
      group: "VCS",
      run() {
        toggleFileReviewed(selectedFileIndex() ?? currentPatchFileIndex())
      },
    },
    {
      id: "diff.toggle_file_tree",
      title: "Toggle diff viewer file tree",
      group: "VCS",
      run() {
        const next = !fileTreeEnabled()
        setFileTreeEnabled(next)
        props.onPreferencesChange?.({ tree: next })
      },
    },
    {
      id: "diff.single_patch",
      title: "Toggle single patch view",
      group: "VCS",
      run() {
        setSelectedHunk(undefined)
        if (!singlePatch()) {
          ensureHighlightedPatchFile()
          setSinglePatch(true)
          props.onPreferencesChange?.({ single: true })
          scrollSinglePatchToTop()
          return
        }
        const fileIndex =
          visiblePatchFiles()[0]?.fileIndex ??
          singlePatchFileIndex(selectedFileIndex(), currentPatchFileIndex(), firstPatchFileIndex())
        if (fileIndex !== undefined) selectPatchFile(fileIndex)
        setSinglePatch(false)
        props.onPreferencesChange?.({ single: false })
        if (fileIndex !== undefined) scrollToPatchFileIndexAfterRender(fileIndex)
      },
    },
    {
      id: "diff.switch_source",
      title: "Switch diff viewer source",
      group: "VCS",
      run() {
        openSwitchDiffDialog()
      },
    },
    {
      id: "diff.toggle_view",
      title: "Toggle diff viewer split or unified view",
      group: "VCS",
      run() {
        if (!splitAvailable()) return
        setSelectedHunk(undefined)
        const next = view() === "split" ? "unified" : "split"
        setViewOverride(next)
        props.onPreferencesChange?.({ view: next })
      },
    },
    {
      id: "diff.help",
      title: "Show more diff viewer shortcuts",
      group: "VCS",
      run() {
        openHelpDialog()
      },
    },
    // Specific diff bindings take precedence over app.exit's Ctrl+D binding.
    {
      id: "app.exit",
      title: "Close diff viewer",
      group: "VCS",
      run: close,
    },
  ]

  const openSwitchDiffDialog = () => {
    const options = [
      {
        value: "branch" as const,
        description: "Branch + local changes",
      },
      {
        value: "committed" as const,
        description: "Branch commits only",
      },
      {
        value: "working" as const,
        description: "Local changes only",
      },
    ]
    dialog.show(() => (
      <DialogSelect<DiffMode | "base">
        title="Diff source"
        skipFilter={true}
        renderFilter={false}
        current={mode()}
        options={[
          ...options.map((option) => ({
            ...option,
            title: diffSourceLabel(option.value),
            titleView: diffSourceLabel(option.value).padEnd(11),
            onSelect() {
              dialog.clear()
              props.onSwitchSource(option.value)
            },
          })),
          ...(props.onChooseBase
            ? [
                {
                  title: "Base",
                  titleView: "Base".padEnd(11),
                  value: "base" as const,
                  description: props.sourceBase?.name ?? "Choose...",
                  onSelect: props.onChooseBase,
                },
              ]
            : []),
        ]}
      />
    ))
  }

  const openHelpDialog = () => {
    dialog.show(() => <DiffViewerHelpDialog context={props.context} single={singlePatch()} />)
    dialog.set({ size: "medium", centered: true })
  }

  const HelpShortcut = (props: { compact?: boolean }) => (
    <Show when={helpShortcut()}>
      {(shortcut) => (
        <text
          id="diff-help-shortcut"
          fg={theme.text.default}
          selectable={false}
          flexShrink={0}
          wrapMode="none"
          onMouseUp={(event) => {
            if (event.button !== MouseButton.LEFT) return
            event.stopPropagation()
            openHelpDialog()
          }}
        >
          {props.compact ? "?" : shortcut()}
          <Show when={!props.compact}>
            <span style={{ fg: theme.text.subdued }}> help</span>
          </Show>
        </text>
      )}
    </Show>
  )

  props.context.keymap.layer(() => ({
    commands,
  }))

  return (
    <box width="100%" height="100%" backgroundColor={theme.background.default}>
      <Show when={!showFileTree()}>
        <box
          id="diff-source-header"
          paddingLeft={2}
          paddingRight={2}
          height={1}
          flexShrink={0}
          flexDirection="row"
          gap={1}
        >
          <box
            id="diff-source-switch"
            flexDirection="row"
            flexGrow={1}
            minWidth={0}
            onMouseUp={(event) => {
              if (event.button !== MouseButton.LEFT) return
              event.stopPropagation()
              openSwitchDiffDialog()
            }}
          >
            <text
              fg={theme.text.action.secondary.default}
              attributes={TextAttributes.BOLD}
              selectable={false}
              flexShrink={0}
              wrapMode="none"
            >
              {diffSourceLabel(mode())}
            </text>
            <Show when={props.sourceDetail}>
              <text fg={theme.text.subdued} selectable={false} flexGrow={1} minWidth={0} wrapMode="none" truncate>
                {` · ${props.sourceDetail}`}
              </text>
            </Show>
          </box>
          <text id="diff-review-count" fg={theme.text.subdued} flexShrink={0} wrapMode="none">
            {files().filter((file) => reviewedFileNames().has(file.file)).length}/{files().length}
          </text>
        </box>
      </Show>
      <box flexGrow={1} minHeight={0}>
        <Switch>
          <Match when={props.loading}>
            <box flexGrow={1} padding={2}>
              <text fg={theme.text.subdued}>Loading diff…</text>
            </box>
          </Match>
          <Match when={!props.loading && props.error}>
            <box flexGrow={1} padding={2}>
              <text fg={theme.text.feedback.error.default}>
                {!props.sourceBase && mode() !== "working"
                  ? "Could not load diff. Choose a base branch from Diff source, or select Uncommitted."
                  : "Could not load diff. Reopen the diff viewer to try again."}
              </text>
            </box>
          </Match>
          <Match when={!props.loading && props.unavailable}>
            <box flexGrow={1} padding={2}>
              <text fg={theme.text.subdued}>
                Committed comparison unavailable without base metadata. Choose a base branch from Diff source.
              </text>
            </box>
          </Match>
          <Match when={!props.loading && files().length === 0}>
            <box flexGrow={1} padding={2}>
              <text fg={theme.text.subdued}>No changes to show</text>
            </box>
          </Match>
          <Match when={!props.loading}>
            <box flexDirection="row" flexGrow={1} minHeight={0}>
              <Show when={showFileTree()}>
                <DiffViewerFileTree
                  files={files()}
                  loading={props.loading ?? false}
                  error={props.error}
                  layout={props.navigation}
                  width={fileTreeWidth()}
                  selectedFileIndex={
                    selectedFileIndex() ?? (singlePatch() ? visiblePatchFiles()[0]?.fileIndex : undefined)
                  }
                  reviewedFileNames={reviewedFileNames()}
                  expandedNodes={expandedFileNodes()}
                  onRowClick={clickFileTreeRow}
                  onFileContextMenu={openFileMenu}
                  source={diffSourceLabel(mode())}
                  sourceDetail={props.sourceDetail}
                  onSwitchSource={openSwitchDiffDialog}
                  footer={<HelpShortcut />}
                />
              </Show>

              <box flexGrow={1} minWidth={0} minHeight={0} paddingLeft={2} paddingRight={2}>
                <box
                  id="diff-patch-top-edge"
                  ref={(edge: BoxRenderable) => {
                    // The fixed edge belongs to the visible card, not the tree selection.
                    edge.onLifecyclePass = () => {
                      if (!scroll) return
                      const entry = visiblePatchFiles().findLast(
                        (entry) => (patchNodeByFileIndex.get(entry.fileIndex)?.y ?? Infinity) <= scroll!.viewport.y,
                      )
                      edge.backgroundColor =
                        entry && reviewedFileNames().has(entry.file.file)
                          ? theme.background.surface.overlay
                          : theme.diff.background.context
                    }
                    renderer.registerLifecyclePass(edge)
                    onCleanup(() => renderer.unregisterLifecyclePass(edge))
                  }}
                  height={1}
                  flexShrink={0}
                  backgroundColor={theme.diff.background.context}
                />
                <scrollbox
                  id="diff-patches"
                  ref={(element: ScrollBoxRenderable) => (scroll = element)}
                  flexGrow={1}
                  minHeight={0}
                  scrollAcceleration={patchScrollAcceleration()}
                  onMouseScroll={clearPatchSelection}
                  verticalScrollbarOptions={{ visible: false }}
                  horizontalScrollbarOptions={{ visible: false }}
                >
                  <For each={visiblePatchFiles()}>
                    {(entry, index) => {
                      const reviewed = () => reviewedFileNames().has(entry.file.file)
                      const background = () =>
                        reviewed() ? theme.background.surface.overlay : theme.diff.background.context
                      const image = () => isDiffImageFile(entry.file.file)
                      const countsWidth = () =>
                        (image() ? 6 : String(entry.file.additions).length + String(entry.file.deletions).length + 5) +
                        (reviewed() ? 2 : 0)
                      return (
                        <box ref={(element: BoxRenderable) => registerPatchNode(entry.fileIndex, element)}>
                          <Show when={index() > 0}>
                            <box
                              height={1}
                              flexShrink={0}
                              border={["top"]}
                              borderColor={background()}
                              backgroundColor={theme.background.default}
                              customBorderChars={{ ...EmptyBorder, horizontal: "▄" }}
                            />
                          </Show>
                          <box backgroundColor={background()}>
                            <box
                              id={`diff-file-header-${entry.fileIndex}`}
                              onMouseDown={(event) => openFileMenu(entry.fileIndex, event)}
                              ref={(header: BoxRenderable) => {
                                // Move the original title without changing flow, bounded by its own card.
                                header.onLifecyclePass = () => {
                                  if (!scroll || !header.parent) return
                                  header.translateY = Math.max(
                                    0,
                                    Math.min(
                                      scroll.scrollTop - (header.parent.y - scroll.content.y),
                                      header.parent.height - header.height,
                                    ),
                                  )
                                }
                                renderer.registerLifecyclePass(header)
                                onCleanup(() => renderer.unregisterLifecyclePass(header))
                              }}
                              flexDirection="row"
                              gap={1}
                              flexShrink={0}
                              height={FILE_HEADER_HEIGHT}
                              zIndex={1}
                              backgroundColor={background()}
                              paddingLeft={1}
                              paddingRight={1}
                              paddingBottom={1}
                            >
                              <box flexGrow={1} minWidth={0}>
                                <FilePath
                                  value={entry.file.file}
                                  maxWidth={Math.max(1, patchPaneWidth() - countsWidth() - 2)}
                                  fg={theme.text.subdued}
                                  basenameFg={reviewed() ? theme.text.subdued : theme.text.default}
                                />
                              </box>
                              <Show when={reviewed()}>
                                <text fg={theme.text.subdued} flexShrink={0}>
                                  ✓
                                </text>
                              </Show>
                              <Show when={!image()} fallback={<text fg={theme.text.subdued}>Image</text>}>
                                <text flexShrink={0} fg={reviewed() ? theme.text.subdued : theme.diff.text.added}>
                                  +{entry.file.additions}
                                </text>
                                <text flexShrink={0} fg={reviewed() ? theme.text.subdued : theme.diff.text.removed}>
                                  -{entry.file.deletions}
                                </text>
                              </Show>
                              <Show when={reviewed()}>
                                <box
                                  position="absolute"
                                  left={0}
                                  bottom={0}
                                  width="100%"
                                  height={1}
                                  border={["bottom"]}
                                  borderColor={background()}
                                  backgroundColor={theme.background.default}
                                  customBorderChars={{ ...EmptyBorder, horizontal: "▀" }}
                                />
                              </Show>
                            </box>
                            <Show when={!reviewed()}>
                              <Switch
                                fallback={
                                  <box width="100%" flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
                                    <text fg={theme.text.subdued}>
                                      {mode() === "committed" && image()
                                        ? "Committed image preview unavailable. The working-tree image is not shown."
                                        : entry.file.status === "deleted" && image()
                                          ? "Deleted image. The previous revision is not available for preview."
                                          : "No patch available for this file."}
                                    </text>
                                  </box>
                                }
                              >
                                <Match
                                  when={
                                    mode() !== "committed" &&
                                    entry.file.status !== "deleted" &&
                                    image() &&
                                    props.loadImage
                                  }
                                >
                                  {(load) => <DiffViewerImage file={entry.file.file} load={load()} />}
                                </Match>
                                <Match when={!(mode() === "committed" && image()) && entry.file.patch}>
                                  {(patch) => (
                                    <PatchDiff
                                      ref={(component) => {
                                        patchDiffByFileIndex.set(entry.fileIndex, component)
                                        onCleanup(() => patchDiffByFileIndex.delete(entry.fileIndex))
                                      }}
                                      diff={patch()}
                                      hunkFg={theme.diff.text.hunkHeader}
                                      view={entry.file.status === "modified" ? view() : "unified"}
                                      filetype={filetype(entry.file.file)}
                                      syntaxStyle={currentSyntax()}
                                      showLineNumbers={true}
                                      width="100%"
                                      wrapMode="char"
                                      fg={theme.text.default}
                                      addedBg={theme.diff.background.added}
                                      removedBg={theme.diff.background.removed}
                                      contextBg={theme.diff.background.context}
                                      addedSignColor={theme.diff.highlight.added}
                                      removedSignColor={theme.diff.highlight.removed}
                                      lineNumberFg={theme.diff.lineNumber.text}
                                      lineNumberBg={theme.diff.background.context}
                                      addedLineNumberBg={theme.diff.lineNumber.background.added}
                                      removedLineNumberBg={theme.diff.lineNumber.background.removed}
                                    />
                                  )}
                                </Match>
                              </Switch>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </scrollbox>
              </box>
            </box>
          </Match>
        </Switch>
      </box>
      <Show when={!showFileTree()}>
        <box position="absolute" top={0} right={0} width={1} height={1}>
          <HelpShortcut compact />
        </box>
      </Show>
      <Show when={fileMenu()} keyed>
        {(state) => (
          <DiffFileMenu
            context={props.context}
            state={state}
            reviewed={reviewedFileNames().has(files()[state.fileIndex]?.file ?? "")}
            onToggle={() => toggleFileReviewed(state.fileIndex)}
            onClose={() => setFileMenu(undefined)}
          />
        )}
      </Show>
    </box>
  )
}

function DiffFileMenu(props: {
  context: Plugin.Context
  state: FileMenuState
  reviewed: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme.contextual.overlay
  const [hovered, setHovered] = createSignal(false)
  const label = () => (props.reviewed ? "Mark incomplete" : "Mark complete")
  const run = () => {
    props.onClose()
    props.onToggle()
  }
  onCleanup(props.context.keymap.mode.push("menu"))
  props.context.keymap.layer(() => ({
    mode: "menu",
    commands: [
      { bind: "escape,ctrl+c", title: "Close file menu", group: "Diff", run: props.onClose },
      { bind: "return", title: label(), group: "Diff", run },
    ],
  }))

  return (
    <box
      id="diff-file-menu-overlay"
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      zIndex={2600}
      onMouseDown={(event) => {
        props.onClose()
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <box
        id="diff-file-menu"
        position="absolute"
        left={Math.max(0, Math.min(props.state.x, dimensions().width - 19))}
        top={Math.max(0, Math.min(props.state.y + 1, dimensions().height - 1))}
        width={19}
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={hovered() ? theme.background.action.primary.hovered : theme.background.default}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseDown={(event) => {
          if (event.button === MouseButton.RIGHT) props.onClose()
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseUp={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (event.button === MouseButton.LEFT) run()
        }}
      >
        <text fg={theme.text.default} selectable={false}>
          {label()}
        </text>
      </box>
    </box>
  )
}

function DiffViewerHelpDialog(props: { context: Plugin.Context; single: boolean }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme.contextual.elevated
  const shortcut =
    (...ids: string[]) =>
    () =>
      ids
        .map((id) => props.context.keymap.shortcuts(id)[0])
        .filter(Boolean)
        .join(" / ")
  const groups = [
    {
      title: "Review",
      rows: [
        { shortcut: () => props.context.keymap.shortcuts("diff.next_file").join(" / "), label: "Next file" },
        { shortcut: () => props.context.keymap.shortcuts("diff.previous_file").join(" / "), label: "Previous file" },
        {
          shortcut: shortcut("diff.mark_reviewed"),
          label: props.single ? "Review + next / reopen" : "Review + collapse / reopen",
        },
        { shortcut: shortcut("diff.next_hunk", "diff.previous_hunk"), label: "Next / previous change" },
        { shortcut: () => "right-click", label: "File menu (heading or tree)" },
      ],
    },
    {
      title: "Scroll",
      rows: [
        { shortcut: shortcut("diff.down", "diff.up"), label: "Down / up" },
        { shortcut: shortcut("diff.half_page.down", "diff.half_page.up"), label: "Half page down / up" },
        { shortcut: shortcut("diff.page.down", "diff.page.up"), label: "Page down / up" },
        { shortcut: shortcut("diff.first", "diff.last"), label: "First / last" },
      ],
    },
    {
      title: "View",
      rows: [
        { shortcut: shortcut("diff.toggle_view"), label: "Split / unified" },
        { shortcut: shortcut("diff.single_patch"), label: "All files / single file" },
        { shortcut: shortcut("diff.toggle_file_tree"), label: "Show / hide file tree" },
        { shortcut: shortcut("diff.switch_source"), label: "Switch diff source" },
        { shortcut: () => props.context.keymap.shortcuts("diff.close").join(" / "), label: "Close diff viewer" },
      ],
    },
  ]

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          Diff shortcuts
        </text>
        <text fg={theme.text.subdued} selectable={false} onMouseUp={() => props.context.ui.dialog.clear()}>
          esc close
        </text>
      </box>
      <scrollbox
        id="diff-help-scroll"
        focused
        height={Math.max(
          1,
          Math.min(
            dimensions().height - 6,
            groups.reduce((height, group) => height + group.rows.length + 2, -1),
          ),
        )}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ visible: false }}
      >
        <box gap={1}>
          <For each={groups}>
            {(group) => (
              <box flexShrink={0}>
                <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
                  {group.title}
                </text>
                <For each={group.rows}>
                  {(row) => (
                    <box flexDirection="row" gap={2}>
                      <text fg={theme.text.default} width={17} flexShrink={0}>
                        {row.shortcut() || "unbound"}
                      </text>
                      <text fg={theme.text.subdued} flexGrow={1} minWidth={0}>
                        {row.label}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "diff.open",
        title: "Open diff viewer",
        slash: { name: "diff" },
        group: "VCS",
        palette: true,
        run() {
          const route = props.context.ui.router.current()
          const returnRoute: Route =
            route.type === "home"
              ? { type: "home" }
              : route.type === "session"
                ? { type: "session", sessionID: route.sessionID }
                : {
                    type: "plugin",
                    id: route.id,
                    name: route.name,
                    ...(route.data ? { data: { ...route.data } } : {}),
                  }
          props.context.ui.router.navigate({
            type: "plugin",
            name: ROUTE,
            data: {
              sessionID: route.type === "session" ? route.sessionID : undefined,
              returnRoute,
            },
          })
          props.context.ui.dialog.clear()
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "opencode.diffs",
  setup(context) {
    context.ui.router.register({
      name: ROUTE,
      render: () => <DiffViewer context={context} />,
    })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
