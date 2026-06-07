import { sampledChecksum } from "@opencode-ai/core/util/encode"
import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  type DiffLineAnnotation,
  type FileContents,
  File as PierreFile,
  type FileDiffOptions,
  FileDiff,
  type FileOptions,
  type LineAnnotation,
  type SelectedLineRange,
  type VirtualFileMetrics,
  VirtualizedFile,
  VirtualizedFileDiff,
  Virtualizer,
} from "@pierre/diffs"
import { type PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { createMediaQuery } from "@solid-primitives/media"
import {
  type ComponentProps,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from "solid-js"
import { useI18n } from "../context/i18n"
import { createDefaultOptions, styleVariables } from "../pierre"
import { markCommentedDiffLines, markCommentedFileLines } from "../pierre/commented-lines"
import { fixDiffSelection, findDiffSide, type DiffSelectionSide } from "../pierre/diff-selection"
import { createFileFind } from "../pierre/file-find"
import { dataUrlFromMediaValue, mediaKindFromPath } from "../pierre/media"
import {
  applyViewerScheme,
  clearReadyWatcher,
  createReadyWatcher,
  getViewerHost,
  getViewerRoot,
  notifyShadowReady,
  observeViewerScheme,
} from "../pierre/file-runtime"
import {
  findCodeSelectionSide,
  findDiffLineNumber,
  findElement,
  findFileLineNumber,
  readShadowLineSelection,
} from "../pierre/file-selection"
import { createLineNumberSelectionBridge, restoreShadowTextSelection } from "../pierre/selection-bridge"
import { acquireVirtualizer, virtualMetrics } from "../pierre/virtualizer"
import { getWorkerPool } from "../pierre/worker"
import { Button } from "./button"
import { FileMedia, type FileMediaOptions } from "./file-media"
import { FileSearchBar } from "./file-search"
import { IconButton } from "./icon-button"
import { Markdown } from "./markdown"
import { RadioGroup } from "./radio-group"
import { Tooltip } from "./tooltip"

const VIRTUALIZE_BYTES = 500_000
const MARKDOWN_VIRTUALIZE_BYTES = 180_000
const MARKDOWN_VIRTUALIZE_LINES = 4_000
const MARKDOWN_PREVIEW_BYTES = 180_000
const MARKDOWN_PREVIEW_LINES = 4_000
const MARKDOWN_PREVIEW_CHARS = 12_000
const MARKDOWN_PREVIEW_HEAD = 160

const codeMetrics = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  lineHeight: 24,
  fileGap: 0,
} satisfies Partial<VirtualFileMetrics>

type SharedProps<T> = {
  annotations?: LineAnnotation<T>[] | DiffLineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  onLineNumberSelectionEnd?: (selection: SelectedLineRange | null) => void
  onRendered?: () => void
  class?: string
  classList?: ComponentProps<"div">["classList"]
  media?: FileMediaOptions
  search?: FileSearchControl
  openFolder?: () => void
  copyPath?: () => void
}

export type FileSearchHandle = {
  focus: () => void
}

export type FileSearchControl = {
  register: (handle: FileSearchHandle | null) => void
}

export type TextFileProps<T = {}> = FileOptions<T> &
  SharedProps<T> & {
    mode: "text"
    file: FileContents
    annotations?: LineAnnotation<T>[]
    preloadedDiff?: PreloadMultiFileDiffResult<T>
  }

export type DiffFileProps<T = {}> = FileDiffOptions<T> &
  SharedProps<T> & {
    mode: "diff"
    before: FileContents
    after: FileContents
    annotations?: DiffLineAnnotation<T>[]
    preloadedDiff?: PreloadMultiFileDiffResult<T>
  }

export type FileProps<T = {}> = TextFileProps<T> | DiffFileProps<T>

const sharedKeys = [
  "mode",
  "media",
  "class",
  "classList",
  "annotations",
  "selectedLines",
  "commentedLines",
  "search",
  "openFolder",
  "copyPath",
  "onLineSelected",
  "onLineSelectionEnd",
  "onLineNumberSelectionEnd",
  "onRendered",
  "preloadedDiff",
] as const

const textKeys = ["file", ...sharedKeys] as const
const diffKeys = ["before", "after", ...sharedKeys] as const

function fileText(file: FileContents) {
  const value = file.contents as unknown
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.join("\n")
  if (value == null) return ""
  return String(value)
}

function fileBytes(file: FileContents) {
  const value = file.contents as unknown
  if (typeof value === "string") return value.length
  if (Array.isArray(value)) {
    return value.reduce((sum, part) => sum + (typeof part === "string" ? part.length + 1 : String(part).length + 1), 0)
  }
  if (value == null) return 0
  return String(value).length
}

function markdownFile(name: string) {
  return /\.(md|markdown|mdx)$/i.test(name)
}

function fileLines(text: string) {
  const total = text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
  return Math.max(1, total)
}

function previewText(text: string) {
  const rows = text.split("\n")
  const head = rows.slice(0, MARKDOWN_PREVIEW_HEAD).join("\n").slice(0, MARKDOWN_PREVIEW_CHARS).trimEnd()
  if (head.length >= text.length) return head
  return `${head}\n\n...`
}

// ---------------------------------------------------------------------------
// Shared viewer hook
// ---------------------------------------------------------------------------

type MouseHit = {
  line: number | undefined
  numberColumn: boolean
  side?: DiffSelectionSide
}

type ViewerConfig = {
  enableLineSelection: () => boolean
  selectedLines: () => SelectedLineRange | null | undefined
  commentedLines: () => SelectedLineRange[]
  onLineSelectionEnd: (range: SelectedLineRange | null) => void

  // mode-specific callbacks
  lineFromMouseEvent: (event: MouseEvent) => MouseHit
  setSelectedLines: (range: SelectedLineRange | null, preserve?: { root: ShadowRoot; text: Range }) => void
  updateSelection: (preserveTextSelection: boolean) => void
  buildDragSelection: () => SelectedLineRange | undefined
  buildClickSelection: () => SelectedLineRange | undefined
  onDragStart: (hit: MouseHit) => void
  onDragMove: (hit: MouseHit) => void
  onDragReset: () => void
  markCommented: (root: ShadowRoot, ranges: SelectedLineRange[]) => void
}

function useFileViewer(config: ViewerConfig) {
  let wrapper!: HTMLDivElement
  let container!: HTMLDivElement
  let overlay!: HTMLDivElement
  let selectionFrame: number | undefined
  let dragFrame: number | undefined
  let dragStart: number | undefined
  let dragEnd: number | undefined
  let dragMoved = false
  let lastSelection: SelectedLineRange | null = null
  let pendingSelectionEnd = false

  const ready = createReadyWatcher()
  const bridge = createLineNumberSelectionBridge()
  const [rendered, setRendered] = createSignal(0)

  const getRoot = () => getViewerRoot(container)
  const getHost = () => getViewerHost(container)

  const find = createFileFind({
    wrapper: () => wrapper,
    overlay: () => overlay,
    getRoot,
  })

  // -- selection scheduling --

  const scheduleSelectionUpdate = () => {
    if (selectionFrame !== undefined) return
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = undefined
      const finishing = pendingSelectionEnd
      config.updateSelection(finishing)
      if (!pendingSelectionEnd) return
      pendingSelectionEnd = false
      config.onLineSelectionEnd(lastSelection)
    })
  }

  const scheduleDragUpdate = () => {
    if (dragFrame !== undefined) return
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined
      const selected = config.buildDragSelection()
      if (selected) config.setSelectedLines(selected)
    })
  }

  // -- mouse handlers --

  const handleMouseDown = (event: MouseEvent) => {
    if (!config.enableLineSelection()) return
    if (event.button !== 0) return

    const hit = config.lineFromMouseEvent(event)
    if (hit.numberColumn) {
      bridge.begin(true, hit.line)
      return
    }
    if (hit.line === undefined) return

    bridge.begin(false, hit.line)
    dragStart = hit.line
    dragEnd = hit.line
    dragMoved = false
    config.onDragStart(hit)
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (!config.enableLineSelection()) return

    const hit = config.lineFromMouseEvent(event)
    if (bridge.track(event.buttons, hit.line)) return
    if (dragStart === undefined) return

    if ((event.buttons & 1) === 0) {
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
      config.onDragReset()
      bridge.finish()
      return
    }

    if (hit.line === undefined) return
    dragEnd = hit.line
    dragMoved = true
    config.onDragMove(hit)
    scheduleDragUpdate()
  }

  const handleMouseUp = () => {
    if (!config.enableLineSelection()) return
    if (bridge.finish() === "numbers") return
    if (dragStart === undefined) return

    if (!dragMoved) {
      pendingSelectionEnd = false
      const selected = config.buildClickSelection()
      if (selected) config.setSelectedLines(selected)
      config.onLineSelectionEnd(lastSelection)
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
      config.onDragReset()
      return
    }

    pendingSelectionEnd = true
    scheduleDragUpdate()
    scheduleSelectionUpdate()

    dragStart = undefined
    dragEnd = undefined
    dragMoved = false
    config.onDragReset()
  }

  const handleSelectionChange = () => {
    if (!config.enableLineSelection()) return
    if (dragStart === undefined) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    scheduleSelectionUpdate()
  }

  // -- shared effects --

  onMount(() => {
    onCleanup(observeViewerScheme(getHost))
  })

  createEffect(() => {
    rendered()
    const ranges = config.commentedLines()
    requestAnimationFrame(() => {
      const root = getRoot()
      if (!root) return
      config.markCommented(root, ranges)
    })
  })

  createEffect(() => {
    config.setSelectedLines(config.selectedLines() ?? null)
  })

  createEffect(() => {
    if (!config.enableLineSelection()) return

    container.addEventListener("mousedown", handleMouseDown)
    container.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    document.addEventListener("selectionchange", handleSelectionChange)

    onCleanup(() => {
      container.removeEventListener("mousedown", handleMouseDown)
      container.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      document.removeEventListener("selectionchange", handleSelectionChange)
    })
  })

  onCleanup(() => {
    clearReadyWatcher(ready)

    if (selectionFrame !== undefined) cancelAnimationFrame(selectionFrame)
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame)

    selectionFrame = undefined
    dragFrame = undefined
    dragStart = undefined
    dragEnd = undefined
    dragMoved = false
    bridge.reset()
    lastSelection = null
    pendingSelectionEnd = false
  })

  return {
    get wrapper() {
      return wrapper
    },
    set wrapper(v: HTMLDivElement) {
      wrapper = v
    },
    get container() {
      return container
    },
    set container(v: HTMLDivElement) {
      container = v
    },
    get overlay() {
      return overlay
    },
    set overlay(v: HTMLDivElement) {
      overlay = v
    },
    get dragStart() {
      return dragStart
    },
    get dragEnd() {
      return dragEnd
    },
    get lastSelection() {
      return lastSelection
    },
    set lastSelection(v: SelectedLineRange | null) {
      lastSelection = v
    },
    ready,
    bridge,
    rendered,
    setRendered,
    getRoot,
    getHost,
    find,
    scheduleSelectionUpdate,
  }
}

type Viewer = ReturnType<typeof useFileViewer>

type ModeAdapter = Omit<ViewerConfig, "enableLineSelection" | "selectedLines" | "commentedLines" | "onLineSelectionEnd">

type ModeConfig = {
  enableLineSelection: () => boolean
  selectedLines: () => SelectedLineRange | null | undefined
  commentedLines: () => SelectedLineRange[] | undefined
  onLineSelectionEnd: (range: SelectedLineRange | null) => void
}

type RenderTarget = {
  cleanUp: () => void
}

type AnnotationTarget<A> = {
  setLineAnnotations: (annotations: A[]) => void
  rerender: () => void
}

type VirtualStrategy = {
  get: () => Virtualizer | undefined
  cleanup: () => void
}

function useModeViewer(config: ModeConfig, adapter: ModeAdapter) {
  return useFileViewer({
    enableLineSelection: config.enableLineSelection,
    selectedLines: config.selectedLines,
    commentedLines: () => config.commentedLines() ?? [],
    onLineSelectionEnd: config.onLineSelectionEnd,
    ...adapter,
  })
}

function useSearchHandle(opts: {
  search: () => FileSearchControl | undefined
  find: ReturnType<typeof createFileFind>
}) {
  createEffect(() => {
    const search = opts.search()
    if (!search) return

    const handle = {
      focus: () => opts.find.focus(),
    } satisfies FileSearchHandle

    search.register(handle)
    onCleanup(() => search.register(null))
  })
}

function createLineCallbacks(opts: {
  viewer: Viewer
  normalize?: (range: SelectedLineRange | null) => SelectedLineRange | null | undefined
  onLineSelected?: (range: SelectedLineRange | null) => void
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd?: (selection: SelectedLineRange | null) => void
}) {
  const select = (range: SelectedLineRange | null) => {
    if (!opts.normalize) return range
    const next = opts.normalize(range)
    if (next !== undefined) return next
    return range
  }

  return {
    onLineSelected: (range: SelectedLineRange | null) => {
      const next = select(range)
      opts.viewer.lastSelection = next
      opts.onLineSelected?.(next)
    },
    onLineSelectionEnd: (range: SelectedLineRange | null) => {
      const next = select(range)
      opts.viewer.lastSelection = next
      opts.onLineSelectionEnd?.(next)
      if (!opts.viewer.bridge.consume(next)) return
      requestAnimationFrame(() => opts.onLineNumberSelectionEnd?.(next))
    },
  }
}

function useAnnotationRerender<A>(opts: {
  viewer: Viewer
  current: () => AnnotationTarget<A> | undefined
  annotations: () => A[]
}) {
  createEffect(() => {
    opts.viewer.rendered()
    const active = opts.current()
    if (!active) return
    active.setLineAnnotations(opts.annotations())
    active.rerender()
    requestAnimationFrame(() => opts.viewer.find.refresh({ reset: true }))
  })
}

function notifyRendered(opts: {
  viewer: Viewer
  isReady: (root: ShadowRoot) => boolean
  settleFrames?: number
  onReady: () => void
}) {
  notifyShadowReady({
    state: opts.viewer.ready,
    container: opts.viewer.container,
    getRoot: opts.viewer.getRoot,
    isReady: opts.isReady,
    settleFrames: opts.settleFrames,
    onReady: opts.onReady,
  })
}

function renderViewer<I extends RenderTarget>(opts: {
  viewer: Viewer
  current: I | undefined
  create: () => I
  assign: (value: I) => void
  draw: (value: I) => void
  onReady: () => void
}) {
  clearReadyWatcher(opts.viewer.ready)
  opts.current?.cleanUp()
  const next = opts.create()
  opts.assign(next)

  opts.viewer.container.innerHTML = ""
  opts.draw(next)

  applyViewerScheme(opts.viewer.getHost())
  opts.viewer.setRendered((value) => value + 1)
  opts.onReady()
}

function preserve(viewer: Viewer) {
  const root = scrollParent(viewer.wrapper)
  if (!root) return () => {}

  const high = viewer.container.getBoundingClientRect().height
  if (!high) return () => {}

  const top = viewer.wrapper.getBoundingClientRect().top - root.getBoundingClientRect().top
  const prev = viewer.container.style.minHeight
  viewer.container.style.minHeight = `${Math.ceil(high)}px`

  let done = false
  return () => {
    if (done) return
    done = true
    viewer.container.style.minHeight = prev

    const next = viewer.wrapper.getBoundingClientRect().top - root.getBoundingClientRect().top
    const delta = next - top
    if (delta) root.scrollTop += delta
  }
}

function scrollParent(el: HTMLElement): HTMLElement | undefined {
  let parent = el.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    if (style.overflowY === "auto" || style.overflowY === "scroll") return parent
    parent = parent.parentElement
  }
}

function createLocalVirtualStrategy(host: () => HTMLDivElement | undefined, enabled: () => boolean): VirtualStrategy {
  let virtualizer: Virtualizer | undefined
  let root: Document | HTMLElement | undefined

  const release = () => {
    virtualizer?.cleanUp()
    virtualizer = undefined
    root = undefined
  }

  return {
    get: () => {
      if (!enabled()) {
        release()
        return
      }
      if (typeof document === "undefined") return

      const wrapper = host()
      if (!wrapper) return

      const next = scrollParent(wrapper) ?? document
      if (virtualizer && root === next) return virtualizer

      release()
      virtualizer = new Virtualizer()
      root = next
      virtualizer.setup(next, next instanceof Document ? undefined : wrapper)
      return virtualizer
    },
    cleanup: release,
  }
}

function createSharedVirtualStrategy(host: () => HTMLDivElement | undefined): VirtualStrategy {
  let shared: NonNullable<ReturnType<typeof acquireVirtualizer>> | undefined

  const release = () => {
    shared?.release()
    shared = undefined
  }

  return {
    get: () => {
      if (shared) return shared.virtualizer

      const container = host()
      if (!container) return

      const result = acquireVirtualizer(container)
      if (!result) return
      shared = result
      return result.virtualizer
    },
    cleanup: release,
  }
}

function parseLine(node: HTMLElement) {
  if (!node.dataset.line) return
  const value = parseInt(node.dataset.line, 10)
  if (Number.isNaN(value)) return
  return value
}

function mouseHit(
  event: MouseEvent,
  line: (node: HTMLElement) => number | undefined,
  side?: (node: HTMLElement) => DiffSelectionSide | undefined,
): MouseHit {
  const path = event.composedPath()
  let numberColumn = false
  let value: number | undefined
  let branch: DiffSelectionSide | undefined

  for (const item of path) {
    if (!(item instanceof HTMLElement)) continue

    numberColumn = numberColumn || item.dataset.columnNumber != null
    if (value === undefined) value = line(item)
    if (branch === undefined && side) branch = side(item)

    if (numberColumn && value !== undefined && (side == null || branch !== undefined)) break
  }

  return {
    line: value,
    numberColumn,
    side: branch,
  }
}

function diffMouseSide(node: HTMLElement) {
  const type = node.dataset.lineType
  if (type === "change-deletion") return "deletions" satisfies DiffSelectionSide
  if (type === "change-addition" || type === "change-additions") return "additions" satisfies DiffSelectionSide
  if (node.dataset.code == null) return
  return node.hasAttribute("data-deletions") ? "deletions" : "additions"
}

function diffSelectionSide(node: Node | null) {
  const el = findElement(node)
  if (!el) return
  return findDiffSide(el)
}

// ---------------------------------------------------------------------------
// Shared JSX shell
// ---------------------------------------------------------------------------

function FileRoot(props: {
  mode: "text" | "diff" | "markdown"
  class: string | undefined
  classList: ComponentProps<"div">["classList"] | undefined
  children: JSX.Element
}) {
  return (
    <div
      data-component="file"
      data-mode={props.mode}
      style={styleVariables}
      classList={{
        ...(props.classList || {}),
        [props.class ?? ""]: !!props.class,
      }}
    >
      {props.children}
    </div>
  )
}

function ViewerShell(props: {
  mode: "text" | "diff"
  viewer: ReturnType<typeof useFileViewer>
  class: string | undefined
  classList: ComponentProps<"div">["classList"] | undefined
  head?: JSX.Element
}) {
  return (
    <FileRoot mode={props.mode} class={props.class} classList={props.classList}>
      <div
        data-slot="file-viewer-shell"
        class="relative outline-none"
        ref={(el) => (props.viewer.wrapper = el)}
        tabIndex={0}
        onPointerDown={props.viewer.find.onPointerDown}
        onFocus={props.viewer.find.onFocus}
      >
        {props.head}
        <Show when={props.viewer.find.open()}>
          <FileSearchBar
            pos={props.viewer.find.pos}
            query={props.viewer.find.query}
            count={props.viewer.find.count}
            index={props.viewer.find.index}
            setInput={props.viewer.find.setInput}
            onInput={props.viewer.find.setQuery}
            onKeyDown={props.viewer.find.onInputKeyDown}
            onClose={props.viewer.find.close}
            onPrev={() => props.viewer.find.next(-1)}
            onNext={() => props.viewer.find.next(1)}
          />
        </Show>
        <div ref={(el) => (props.viewer.container = el)} />
        <div ref={(el) => (props.viewer.overlay = el)} class="pointer-events-none absolute inset-0 z-0" />
      </div>
    </FileRoot>
  )
}

// ---------------------------------------------------------------------------
// TextViewer
// ---------------------------------------------------------------------------

type SourceProps<T> = TextFileProps<T> & {
  head?: JSX.Element
}

function SourceViewer<T>(props: SourceProps<T>) {
  let instance: PierreFile<T> | VirtualizedFile<T> | undefined
  let viewer!: Viewer

  const [local, others] = splitProps(props, [...textKeys, "head"] as const)

  const text = () => fileText(local.file)
  const md = () => markdownFile(local.file.name)

  const lines = createMemo(() => {
    const value = text()
    const total = value.split("\n").length - (value.endsWith("\n") ? 1 : 0)
    return Math.max(1, total)
  })

  const bytes = createMemo(() => fileBytes(local.file))

  const virtual = createMemo(() => {
    if (bytes() > VIRTUALIZE_BYTES) return true
    if (!md()) return false
    return bytes() > MARKDOWN_VIRTUALIZE_BYTES || lines() > MARKDOWN_VIRTUALIZE_LINES
  })

  const virtuals = createLocalVirtualStrategy(() => viewer.wrapper, virtual)

  const lineFromMouseEvent = (event: MouseEvent): MouseHit => mouseHit(event, parseLine)

  const applySelection = (range: SelectedLineRange | null) => {
    const current = instance
    if (!current) return false

    if (virtual()) {
      current.setSelectedLines(range)
      return true
    }

    const root = viewer.getRoot()
    if (!root) return false

    const total = lines()
    if (root.querySelectorAll("[data-line]").length < total) return false

    if (!range) {
      current.setSelectedLines(null)
      return true
    }

    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    if (start < 1 || end > total) {
      current.setSelectedLines(null)
      return true
    }

    if (!root.querySelector(`[data-line="${start}"]`) || !root.querySelector(`[data-line="${end}"]`)) {
      current.setSelectedLines(null)
      return true
    }

    const normalized = (() => {
      if (range.endSide != null) return { start: range.start, end: range.end }
      if (range.side !== "deletions") return range
      if (root.querySelector("[data-deletions]") != null) return range
      return { start: range.start, end: range.end }
    })()

    current.setSelectedLines(normalized)
    return true
  }

  const setSelectedLines = (range: SelectedLineRange | null) => {
    viewer.lastSelection = range
    applySelection(range)
  }

  const adapter: ModeAdapter = {
    lineFromMouseEvent,
    setSelectedLines,
    updateSelection: (preserveTextSelection) => {
      const root = viewer.getRoot()
      if (!root) return

      const selected = readShadowLineSelection({
        root,
        lineForNode: findFileLineNumber,
        sideForNode: findCodeSelectionSide,
        preserveTextSelection,
      })
      if (!selected) return

      setSelectedLines(selected.range)
      if (!preserveTextSelection || !selected.text) return
      restoreShadowTextSelection(root, selected.text)
    },
    buildDragSelection: () => {
      if (viewer.dragStart === undefined || viewer.dragEnd === undefined) return
      return { start: Math.min(viewer.dragStart, viewer.dragEnd), end: Math.max(viewer.dragStart, viewer.dragEnd) }
    },
    buildClickSelection: () => {
      if (viewer.dragStart === undefined) return
      return { start: viewer.dragStart, end: viewer.dragStart }
    },
    onDragStart: () => {},
    onDragMove: () => {},
    onDragReset: () => {},
    markCommented: markCommentedFileLines,
  }

  viewer = useModeViewer(
    {
      enableLineSelection: () => props.enableLineSelection === true,
      selectedLines: () => local.selectedLines,
      commentedLines: () => local.commentedLines,
      onLineSelectionEnd: (range) => local.onLineSelectionEnd?.(range),
    },
    adapter,
  )

  const lineCallbacks = createLineCallbacks({
    viewer,
    onLineSelected: (range) => local.onLineSelected?.(range),
    onLineSelectionEnd: (range) => local.onLineSelectionEnd?.(range),
    onLineNumberSelectionEnd: (range) => local.onLineNumberSelectionEnd?.(range),
  })

  const options = createMemo(() => ({
    ...createDefaultOptions<T>("unified"),
    ...others,
    ...lineCallbacks,
  }))

  const notify = () => {
    notifyRendered({
      viewer,
      isReady: (root) => {
        if (virtual()) return root.querySelector("[data-line]") != null
        return root.querySelectorAll("[data-line]").length >= lines()
      },
      onReady: () => {
        applySelection(viewer.lastSelection)
        viewer.find.refresh({ reset: true })
        local.onRendered?.()
      },
    })
  }

  useSearchHandle({
    search: () => local.search,
    find: viewer.find,
  })

  // -- render instance --

  createEffect(() => {
    const opts = options()
    const workerPool = getWorkerPool("unified")
    const isVirtual = virtual()

    const virtualizer = virtuals.get()

    renderViewer({
      viewer,
      current: instance,
      create: () =>
        isVirtual && virtualizer
          ? new VirtualizedFile<T>(opts, virtualizer, codeMetrics, workerPool)
          : new PierreFile<T>(opts, workerPool),
      assign: (value) => {
        instance = value
      },
      draw: (value) => {
        const contents = text()
        value.render({
          file: typeof local.file.contents === "string" ? local.file : { ...local.file, contents },
          lineAnnotations: [],
          containerWrapper: viewer.container,
        })
      },
      onReady: notify,
    })
  })

  useAnnotationRerender<LineAnnotation<T>>({
    viewer,
    current: () => instance,
    annotations: () => (local.annotations as LineAnnotation<T>[] | undefined) ?? [],
  })

  // -- cleanup --

  onCleanup(() => {
    instance?.cleanUp()
    instance = undefined
    virtuals.cleanup()
  })

  return <ViewerShell mode="text" viewer={viewer} class={local.class} classList={local.classList} head={local.head} />
}

function TextViewer<T>(props: TextFileProps<T>) {
  const i18n = useI18n()
  const md = () => markdownFile(props.file.name)
  const svg = () => mediaKindFromPath(props.file.name) === "svg"
  const Source = SourceViewer as (props: SourceProps<T>) => JSX.Element
  const text = createMemo(() => fileText(props.file))
  const lines = createMemo(() => fileLines(text()))
  const bytes = createMemo(() => fileBytes(props.file))
  const large = createMemo(() => md() && (bytes() > MARKDOWN_PREVIEW_BYTES || lines() > MARKDOWN_PREVIEW_LINES))
  const meta = createMemo(() => `${Intl.NumberFormat().format(lines())} lines, ${Intl.NumberFormat().format(bytes())} chars`)
  const preview = createMemo(() => (large() ? previewText(text()) : ""))
  const linked = () => md() && props.selectedLines?.start != null && props.selectedLines?.end != null
  const svgSrc = createMemo(() => {
    if (!svg()) return
    return dataUrlFromMediaValue(props.media?.current ?? props.file.contents, "svg")
  })

  if (!md() && !svg()) return SourceViewer<T>(props)

  const [mode, setMode] = createSignal<"preview" | "source">(linked() ? "source" : "preview")
  const [full, setFull] = createSignal(false)
  const bar = (
    <div
      data-slot="file-markdown-actions"
      class="flex items-center justify-end gap-2"
      data-prevent-autofocus=""
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div data-slot="file-markdown-actions-inner" class="flex items-center gap-2">
        <Show when={props.copyPath}>
          {(copyPath) => (
            <Tooltip value={i18n.t("ui.file.copyPath")} placement="bottom">
              <IconButton
                icon="copy"
                variant="ghost"
                class="h-8 w-8 rounded-md"
                onClick={copyPath()}
                aria-label={i18n.t("ui.file.copyPath")}
              />
            </Tooltip>
          )}
        </Show>
        <Show when={props.openFolder}>
          {(openFolder) => (
            <Tooltip value={i18n.t("ui.file.openFolder")} placement="bottom">
              <IconButton
                icon="folder"
                variant="ghost"
                class="h-8 w-8 rounded-md"
                onClick={openFolder()}
                aria-label={i18n.t("ui.file.openFolder")}
              />
            </Tooltip>
          )}
        </Show>
        <RadioGroup
          options={["preview", "source"] as const}
          current={mode()}
          size="small"
          value={(value) => value}
          label={(value) => i18n.t(value === "preview" ? "ui.file.preview" : "ui.file.source")}
          onSelect={(value) => value && setMode(value)}
        />
      </div>
    </div>
  )

  createEffect(
    on(
      () => props.file.cacheKey ?? props.file.name,
      () => {
        setFull(false)
        if (md()) setMode(linked() ? "source" : "preview")
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [props.file.cacheKey ?? props.file.name, props.selectedLines?.start, props.selectedLines?.end],
      ([, start, end]) => {
        if (!md()) return
        if (start == null || end == null) return
        setMode("source")
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [mode(), props.file.cacheKey, text()],
      ([next]) => {
        if (next !== "preview") return
        requestAnimationFrame(() => props.onRendered?.())
      },
      { defer: true },
    ),
  )

  return (
    <Show
      when={mode() === "source"}
      fallback={
        <FileRoot mode="markdown" class={props.class} classList={props.classList}>
          <div class="relative flex min-h-0 flex-col overflow-hidden">
            {bar}
            <div data-slot="file-markdown-preview" class="overflow-auto px-4 py-4">
              <Show
                when={md()}
                fallback={
                  <Show
                    when={svgSrc()}
                    fallback={<div class="px-2 py-6 text-center text-text-weak">{props.file.name}</div>}
                  >
                    {(value) => (
                      <div class="flex justify-center">
                        <img
                          src={value()}
                          alt={props.file.name}
                          class="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
                          onLoad={() => props.media?.onLoad?.()}
                        />
                      </div>
                    )}
                  </Show>
                }
              >
                <Show
                  when={!large() || full()}
                  fallback={
                    <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
                      <div class="rounded-lg border border-border-weak-base bg-background-stronger p-4">
                        <div class="text-14-medium text-text-base">{i18n.t("ui.file.largePreview.title")}</div>
                        <div class="mt-2 text-13-regular text-text-weak">
                          {i18n.t("ui.file.largePreview.meta", { size: meta() })}
                        </div>
                        <div class="mt-4 flex flex-wrap gap-2">
                          <Button size="small" variant="secondary" onClick={() => setMode("source")}>
                            {i18n.t("ui.file.source")}
                          </Button>
                          <Button size="small" variant="primary" onClick={() => setFull(true)}>
                            {i18n.t("ui.file.largePreview.render")}
                          </Button>
                        </div>
                      </div>
                      <pre class="overflow-auto rounded-lg border border-border-weak-base bg-background-stronger p-4 text-12-regular leading-6 text-text-muted">
                        {preview()}
                      </pre>
                    </div>
                  }
                >
                  {/* Large markdown preview upgrades blocks incrementally after the initial HTML mount. */}
                  <Markdown text={text()} cacheKey={props.file.name} highlight="defer" chunked={large()} />
                </Show>
              </Show>
            </div>
          </div>
        </FileRoot>
      }
    >
      <Source {...props} head={bar} />
    </Show>
  )
}

// ---------------------------------------------------------------------------
// DiffViewer
// ---------------------------------------------------------------------------

function DiffViewer<T>(props: DiffFileProps<T>) {
  let instance: FileDiff<T> | undefined
  let dragSide: DiffSelectionSide | undefined
  let dragEndSide: DiffSelectionSide | undefined
  let viewer!: Viewer

  const [local, others] = splitProps(props, diffKeys)

  const mobile = createMediaQuery("(max-width: 640px)")

  const lineFromMouseEvent = (event: MouseEvent): MouseHit => mouseHit(event, findDiffLineNumber, diffMouseSide)

  const setSelectedLines = (range: SelectedLineRange | null, preserve?: { root: ShadowRoot; text: Range }) => {
    const active = instance
    if (!active) return

    const fixed = fixDiffSelection(viewer.getRoot(), range)
    if (fixed === undefined) {
      viewer.lastSelection = range
      return
    }

    viewer.lastSelection = fixed
    active.setSelectedLines(fixed)
    restoreShadowTextSelection(preserve?.root, preserve?.text)
  }

  const adapter: ModeAdapter = {
    lineFromMouseEvent,
    setSelectedLines,
    updateSelection: (preserveTextSelection) => {
      const root = viewer.getRoot()
      if (!root) return

      const selected = readShadowLineSelection({
        root,
        lineForNode: findDiffLineNumber,
        sideForNode: diffSelectionSide,
        preserveTextSelection,
      })
      if (!selected) return

      if (selected.text) {
        setSelectedLines(selected.range, { root, text: selected.text })
        return
      }

      setSelectedLines(selected.range)
    },
    buildDragSelection: () => {
      if (viewer.dragStart === undefined || viewer.dragEnd === undefined) return
      const selected: SelectedLineRange = { start: viewer.dragStart, end: viewer.dragEnd }
      if (dragSide) selected.side = dragSide
      if (dragEndSide && dragSide && dragEndSide !== dragSide) selected.endSide = dragEndSide
      return selected
    },
    buildClickSelection: () => {
      if (viewer.dragStart === undefined) return
      const selected: SelectedLineRange = { start: viewer.dragStart, end: viewer.dragStart }
      if (dragSide) selected.side = dragSide
      return selected
    },
    onDragStart: (hit) => {
      dragSide = hit.side
      dragEndSide = hit.side
    },
    onDragMove: (hit) => {
      dragEndSide = hit.side
    },
    onDragReset: () => {
      dragSide = undefined
      dragEndSide = undefined
    },
    markCommented: markCommentedDiffLines,
  }

  viewer = useModeViewer(
    {
      enableLineSelection: () => props.enableLineSelection === true,
      selectedLines: () => local.selectedLines,
      commentedLines: () => local.commentedLines,
      onLineSelectionEnd: (range) => local.onLineSelectionEnd?.(range),
    },
    adapter,
  )

  const virtuals = createSharedVirtualStrategy(() => viewer.container)

  const large = createMemo(() => {
    const before = typeof local.before?.contents === "string" ? local.before.contents : ""
    const after = typeof local.after?.contents === "string" ? local.after.contents : ""
    return Math.max(before.length, after.length) > 500_000
  })

  const largeOptions = {
    lineDiffType: "none",
    maxLineDiffLength: 0,
    tokenizeMaxLineLength: 1,
  } satisfies Pick<FileDiffOptions<T>, "lineDiffType" | "maxLineDiffLength" | "tokenizeMaxLineLength">

  const lineCallbacks = createLineCallbacks({
    viewer,
    normalize: (range) => fixDiffSelection(viewer.getRoot(), range),
    onLineSelected: (range) => local.onLineSelected?.(range),
    onLineSelectionEnd: (range) => local.onLineSelectionEnd?.(range),
    onLineNumberSelectionEnd: (range) => local.onLineNumberSelectionEnd?.(range),
  })

  const options = createMemo<FileDiffOptions<T>>(() => {
    const base = {
      ...createDefaultOptions(props.diffStyle),
      ...others,
      ...lineCallbacks,
    }

    const perf = large() ? { ...base, ...largeOptions } : base
    if (!mobile()) return perf
    return { ...perf, disableLineNumbers: true }
  })

  const notify = (done?: VoidFunction) => {
    notifyRendered({
      viewer,
      isReady: (root) => root.querySelector("[data-line]") != null,
      settleFrames: 1,
      onReady: () => {
        done?.()
        setSelectedLines(viewer.lastSelection)
        viewer.find.refresh({ reset: true })
        local.onRendered?.()
      },
    })
  }

  useSearchHandle({
    search: () => local.search,
    find: viewer.find,
  })

  // -- render instance --

  createEffect(() => {
    const opts = options()
    const workerPool = large() ? getWorkerPool("unified") : getWorkerPool(props.diffStyle)
    const virtualizer = virtuals.get()
    const beforeContents = typeof local.before?.contents === "string" ? local.before.contents : ""
    const afterContents = typeof local.after?.contents === "string" ? local.after.contents : ""
    const done = preserve(viewer)

    onCleanup(done)

    const cacheKey = (contents: string) => {
      if (!large()) return sampledChecksum(contents, contents.length)
      return sampledChecksum(contents)
    }

    renderViewer({
      viewer,
      current: instance,
      create: () =>
        virtualizer
          ? new VirtualizedFileDiff<T>(opts, virtualizer, virtualMetrics, workerPool)
          : new FileDiff<T>(opts, workerPool),
      assign: (value) => {
        instance = value
      },
      draw: (value) => {
        value.render({
          oldFile: { ...local.before, contents: beforeContents, cacheKey: cacheKey(beforeContents) },
          newFile: { ...local.after, contents: afterContents, cacheKey: cacheKey(afterContents) },
          lineAnnotations: [],
          containerWrapper: viewer.container,
        })
      },
      onReady: () => notify(done),
    })
  })

  useAnnotationRerender<DiffLineAnnotation<T>>({
    viewer,
    current: () => instance,
    annotations: () => (local.annotations as DiffLineAnnotation<T>[] | undefined) ?? [],
  })

  // -- cleanup --

  onCleanup(() => {
    instance?.cleanUp()
    instance = undefined
    virtuals.cleanup()
    dragSide = undefined
    dragEndSide = undefined
  })

  return <ViewerShell mode="diff" viewer={viewer} class={local.class} classList={local.classList} />
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function File<T>(props: FileProps<T>) {
  if (props.mode === "text") {
    if (mediaKindFromPath(props.file.name) === "svg") {
      return TextViewer(props)
    }
    return <FileMedia media={props.media} fallback={() => TextViewer(props)} />
  }

  return <FileMedia media={props.media} fallback={() => DiffViewer(props)} />
}
