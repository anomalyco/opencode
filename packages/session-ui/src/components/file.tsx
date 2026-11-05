import { sampledChecksum } from "@opencode/util/encode"
import {
  areFilesEqual,
  areOptionsEqual,
  DEFAULT_VIRTUAL_FILE_METRICS,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
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
import { type PreloadFileDiffResult, type PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { createMediaQuery } from "@solid-primitives/media"
import { makeEventListener } from "@solid-primitives/event-listener"
import {
  ComponentProps,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
  untrack,
} from "solid-js"
import { createDefaultOptions, styleVariables } from "../pierre"
import { markCommentedDiffLines, markCommentedFileLines } from "../pierre/commented-lines"
import { fixDiffSelection, findDiffSide, type DiffSelectionSide } from "../pierre/diff-selection"
import { createFileFind } from "../pierre/file-find"
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
import { restoreShadowTextSelection } from "../pierre/selection-bridge"
import {
  createFileSelectionState,
  selectPointerTracking,
  selectSelectedRange,
  selectTextSelectionTracking,
  transitionFileSelection,
  type FileSelectionEffect,
  type FileSelectionEvent,
  type FileSelectionMode,
} from "../pierre/selection-machine"
import { acquireVirtualizer, virtualizeLineThreshold, virtualMetrics } from "../pierre/virtualizer"
import { getWorkerPool } from "../pierre/worker"
import { FileMedia, type FileMediaOptions } from "./file-media"
import { FileSearchBar } from "./file-search"

const codeMetrics = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  lineHeight: 24,
  spacing: 0,
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
}

export type FileSearchHandle = {
  focus: () => void
}

export type FileSearchControl = {
  register: (handle: FileSearchHandle | null) => void
}

export type TextFileProps<T = {}> = FileOptions<T, undefined> &
  SharedProps<T> & {
    mode: "text"
    file: FileContents
    annotations?: LineAnnotation<T>[]
    preloadedDiff?: PreloadMultiFileDiffResult<T, undefined>
  }

type DiffPreload<T> = PreloadMultiFileDiffResult<T, undefined> | PreloadFileDiffResult<T, undefined>

type DiffBaseProps<T> = FileDiffOptions<T, undefined> &
  SharedProps<T> & {
    mode: "diff"
    annotations?: DiffLineAnnotation<T>[]
    preloadedDiff?: DiffPreload<T>
    virtualize?: boolean
  }

type DiffPairProps<T> = DiffBaseProps<T> & {
  before: FileContents
  after: FileContents
  fileDiff?: undefined
}

type DiffPatchProps<T> = DiffBaseProps<T> & {
  fileDiff: FileDiffMetadata
  before?: undefined
  after?: undefined
}

export type DiffFileProps<T = {}> = DiffPairProps<T> | DiffPatchProps<T>

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
  "onLineSelected",
  "onLineSelectionEnd",
  "onLineNumberSelectionEnd",
  "onRendered",
  "preloadedDiff",
] as const

const textKeys = ["file", ...sharedKeys] as const

const diffKeys = ["fileDiff", "before", "after", "virtualize", ...sharedKeys] as const

// ---------------------------------------------------------------------------
// Shared viewer hook
// ---------------------------------------------------------------------------

type MouseHit = {
  line: number | undefined
  numberColumn: boolean
  side: DiffSelectionSide | undefined
}

type SelectionCallbacks = {
  onLineSelected?: (range: SelectedLineRange | null) => void
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void
  onLineNumberSelectionEnd?: (range: SelectedLineRange | null) => void
}

type ViewerConfig = {
  mode: FileSelectionMode
  enableLineSelection: () => boolean
  selectedLines: () => SelectedLineRange | null | undefined
  commentedLines: () => SelectedLineRange[]
  callbacks: SelectionCallbacks

  // mode-specific callbacks
  lineForElement: (node: HTMLElement) => number | undefined
  sideForElement?: (node: HTMLElement) => DiffSelectionSide | undefined
  lineForNode: (node: Node | null) => number | undefined
  sideForNode: (node: Node | null) => SelectedLineRange["side"]
  /** Shows a range in Pierre, adjusted to the rows it has drawn. */
  applySelection: (range: SelectedLineRange | null) => void
  /** Adjusts a range Pierre reports before the machine stores it. */
  normalize?: (range: SelectedLineRange | null) => SelectedLineRange | null | undefined
  markCommented: (root: ShadowRoot, ranges: SelectedLineRange[]) => void
}

type PointerMove = {
  type: "pointer.move"
  buttons: number
  line: number | undefined
  side: DiffSelectionSide | undefined
}

const POINTER_UP: FileSelectionEvent = Object.freeze({ type: "pointer.up" })

const SELECTION_CHANGED: FileSelectionEvent = Object.freeze({ type: "selection.changed" })

function useFileViewer(config: ViewerConfig) {
  let wrapper!: HTMLDivElement
  let container!: HTMLDivElement
  let overlay!: HTMLDivElement
  let selection = createFileSelectionState(config.mode)
  let dragFrame: number | undefined
  let selectionFrame: number | undefined
  let finishFrame: number | undefined
  let shadowText: { root: ShadowRoot; text: Range } | undefined
  // Pointer moves reuse one hit and one event so hovering and dragging allocate nothing per move.
  const hit: MouseHit = { line: undefined, numberColumn: false, side: undefined }
  const moveEvent: PointerMove = { type: "pointer.move", buttons: 0, line: undefined, side: undefined }

  const ready = createReadyWatcher()
  const [rendered, setRendered] = createSignal(0)

  const getRoot = () => getViewerRoot(container)
  const getHost = () => getViewerHost(container)

  const find = createFileFind({
    wrapper: () => wrapper,
    overlay: () => overlay,
    getRoot,
  })

  // -- selection machine --

  const readSelection = (preserveTextSelection: boolean) => {
    const root = getRoot()

    if (!root) return

    const selected = readShadowLineSelection({
      root,
      lineForNode: config.lineForNode,
      sideForNode: config.sideForNode,
      preserveTextSelection,
    })

    if (!selected) return

    return { root, range: selected.range, text: selected.text }
  }

  const cancelFrames = () => {
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame)

    if (selectionFrame !== undefined) cancelAnimationFrame(selectionFrame)

    if (finishFrame !== undefined) cancelAnimationFrame(finishFrame)
    dragFrame = undefined
    selectionFrame = undefined
    finishFrame = undefined
    shadowText = undefined
  }

  const run = (effect: FileSelectionEffect) => {
    if (effect.type === "cancel-frames") return cancelFrames()

    if (effect.type === "schedule-drag") {
      if (dragFrame !== undefined) return
      dragFrame = requestAnimationFrame(() => {
        dragFrame = undefined
        dispatch({ type: "drag.frame", attempt: effect.attempt })
      })

      return
    }

    if (effect.type === "schedule-selection") {
      if (selectionFrame !== undefined) return
      selectionFrame = requestAnimationFrame(() => {
        selectionFrame = undefined
        const selected = readSelection(false)

        if (selected) dispatch({ type: "selection.frame", attempt: effect.attempt, range: selected.range })
      })

      return
    }

    if (effect.type === "schedule-finish") {
      finishFrame = requestAnimationFrame(() => {
        finishFrame = undefined
        const selected = readSelection(true)
        shadowText = selected?.text ? { root: selected.root, text: selected.text } : undefined
        dispatch({ type: "finish.frame", attempt: effect.attempt, range: selected?.range })
      })

      return
    }

    if (effect.type === "apply-selection") {
      const text = effect.preserveText ? shadowText : undefined
      shadowText = undefined
      config.applySelection(effect.range)
      restoreShadowTextSelection(text?.root, text?.text)

      return
    }

    if (effect.type === "notify-line-selected") return config.callbacks.onLineSelected?.(effect.range)

    // Report the range as Pierre shows it: a diff drag that ends above its start is stored top to bottom.
    const range = normalize(effect.range)

    if (config.callbacks.onLineSelectionEnd) return config.callbacks.onLineSelectionEnd(range)

    if (effect.fromNumberDrag) config.callbacks.onLineNumberSelectionEnd?.(range)
  }

  // Applying a range makes Pierre report it back through `onLineSelected`, which dispatches again from inside `run`.
  const dispatch = (event: FileSelectionEvent) => {
    const step = transitionFileSelection(selection, event)
    selection = step.state
    step.effects.forEach(run)
  }

  const normalize = (range: SelectedLineRange | null) => {
    const next = config.normalize?.(range)

    return next === undefined ? range : next
  }

  // -- mouse handlers --

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    fillMouseHit(hit, event, config.lineForElement, config.sideForElement)
    dispatch({
      type: "pointer.down",
      button: event.button,
      column: hit.numberColumn ? "numbers" : "text",
      line: hit.line,
      side: hit.side,
    })
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (!selectPointerTracking(selection)) return
    moveEvent.buttons = event.buttons
    moveEvent.line = undefined
    moveEvent.side = undefined

    if ((event.buttons & 1) !== 0) {
      fillMouseHit(hit, event, config.lineForElement, config.sideForElement)
      moveEvent.line = hit.line
      moveEvent.side = hit.side
    }

    dispatch(moveEvent)
  }

  const handleMouseUp = () => {
    if (!selectPointerTracking(selection)) return
    dispatch(POINTER_UP)
  }

  const handleSelectionChange = () => {
    if (!selectTextSelectionTracking(selection)) return
    const current = window.getSelection()

    if (!current || current.isCollapsed) return
    dispatch(SELECTION_CHANGED)
  }

  // -- shared effects --

  onMount(() => {
    onCleanup(observeViewerScheme(getHost))
  })

  createEffect(() => {
    rendered()
    const ranges = config.commentedLines()
    const root = getRoot()

    if (!root) return

    if (ranges.length === 0) {
      config.markCommented(root, ranges)

      return
    }

    let frame: number | undefined

    const mark = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = undefined
        config.markCommented(root, ranges)
      })
    }

    const observer = new MutationObserver(mark)

    observer.observe(root, { childList: true, subtree: true })
    mark()

    onCleanup(() => {
      observer.disconnect()

      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })

  createEffect(() => {
    const range = config.selectedLines() ?? null
    untrack(() => dispatch({ type: "selection.controlled", range }))
  })

  createEffect(() => {
    if (!config.enableLineSelection()) {
      dispatch({ type: "selection.disabled" })

      return
    }

    makeEventListener(container, "mousedown", handleMouseDown)
    makeEventListener(container, "mousemove", handleMouseMove)
    makeEventListener(window, "mouseup", handleMouseUp)
    makeEventListener(document, "selectionchange", handleSelectionChange)
  })

  onCleanup(() => {
    clearReadyWatcher(ready)
    dispatch({ type: "disposed" })
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
    ready,
    rendered,
    setRendered,
    getRoot,
    getHost,
    find,
    /** Shows the current range again once Pierre has drawn fresh rows. */
    reapplySelection: () => config.applySelection(selectSelectedRange(selection)),
    /** Pierre's own line-number selection, passed in its options. */
    lineCallbacks: {
      onLineSelected: (range: SelectedLineRange | null) =>
        dispatch({ type: "pierre.line-selected", range: normalize(range) }),
      onLineSelectionEnd: (range: SelectedLineRange | null) =>
        dispatch({ type: "pierre.selection-ended", range: normalize(range) }),
    },
  }
}

type Viewer = ReturnType<typeof useFileViewer>

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

function useAnnotationRerender<A>(opts: {
  viewer: Viewer
  current: () => AnnotationTarget<A> | undefined
  annotations: () => A[]
}) {
  const applied = new WeakSet<AnnotationTarget<A>>()
  createEffect(() => {
    opts.viewer.rendered()
    const active = opts.current()

    if (!active) return
    const annotations = opts.annotations()

    // renderViewer always draws with empty annotations, so skip the extra rerender
    // when this instance has nothing applied and nothing to apply.
    if (annotations.length === 0 && !applied.has(active)) return

    if (annotations.length === 0) applied.delete(active)
    else applied.add(active)
    active.setLineAnnotations(annotations)
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
  reset?: boolean
  create: () => I
  update?: (value: I) => void
  assign: (value: I) => void
  draw: (value: I) => void
  onReady: () => void
}) {
  clearReadyWatcher(opts.viewer.ready)
  const reset = opts.reset === true && opts.current !== undefined

  if (reset) opts.current?.cleanUp()
  const next = reset || !opts.current ? opts.create() : opts.current

  if (reset || !opts.current) {
    opts.viewer.container.innerHTML = ""
    opts.assign(next)
  } else {
    opts.update?.(next)
  }

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

function createSharedVirtualStrategy(host: () => HTMLDivElement | undefined, enabled: () => boolean): VirtualStrategy {
  let shared: NonNullable<ReturnType<typeof acquireVirtualizer>> | undefined

  const release = () => {
    shared?.release()
    shared = undefined
  }

  return {
    get: () => {
      if (!enabled()) {
        release()

        return
      }

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

// Pierre draws nothing until its worker pool initializes, and a virtualizer that first sees an empty file at the top
// of its scroller anchors the file's bottom edge, then scrolls to the end once the rows arrive.
function createPoolReady() {
  const [settled, setSettled] = createSignal(false)

  return (pool: ReturnType<typeof getWorkerPool>) => {
    if (!pool || pool.isInitialized() || settled()) return true
    void pool
      .initialize()
      .catch(() => undefined)
      .then(() => setSettled(true))

    return false
  }
}

function parseLine(node: HTMLElement) {
  if (!node.dataset.line) return
  const value = parseInt(node.dataset.line, 10)

  if (Number.isNaN(value)) return

  return value
}

function parseColumnLine(node: HTMLElement) {
  if (!node.dataset.columnNumber) return
  const value = parseInt(node.dataset.columnNumber, 10)

  if (Number.isNaN(value)) return

  return value
}

function fillMouseHit(
  hit: MouseHit,
  event: MouseEvent,
  line: (node: HTMLElement) => number | undefined,
  side?: (node: HTMLElement) => DiffSelectionSide | undefined,
) {
  hit.line = undefined
  hit.numberColumn = false
  hit.side = undefined

  for (const item of event.composedPath()) {
    if (!(item instanceof HTMLElement)) continue

    hit.numberColumn = hit.numberColumn || item.dataset.columnNumber != null

    // Gutter cells carry the line number only in `data-column-number`.
    if (hit.line === undefined) hit.line = line(item) ?? parseColumnLine(item)

    if (hit.side === undefined && side) hit.side = side(item)

    if (hit.numberColumn && hit.line !== undefined && (side == null || hit.side !== undefined)) break
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

function ViewerShell(props: {
  mode: "text" | "diff"
  viewer: ReturnType<typeof useFileViewer>
  class: string | undefined
  classList: ComponentProps<"div">["classList"] | undefined
}) {
  return (
    <div
      data-component="file"
      data-mode={props.mode}
      dir="ltr"
      style={styleVariables}
      class="relative select-text outline-none"
      classList={{
        ...props.classList,
        [props.class ?? ""]: !!props.class,
      }}
      ref={(el) => (props.viewer.wrapper = el)}
      tabIndex={0}
      onPointerDown={props.viewer.find.onPointerDown}
      onFocus={props.viewer.find.onFocus}
    >
      <Show when={props.viewer.find.open()}>
        <FileSearchBar
          pos={props.viewer.find.pos()}
          query={props.viewer.find.query()}
          count={props.viewer.find.count()}
          index={props.viewer.find.index()}
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
  )
}

// ---------------------------------------------------------------------------
// TextViewer
// ---------------------------------------------------------------------------

function TextViewer<T>(props: TextFileProps<T>) {
  let instance: PierreFile<T> | VirtualizedFile<T> | undefined
  let instanceVirtualizer: Virtualizer | undefined
  let viewer!: Viewer

  const [local, others] = splitProps(props, textKeys)

  const lineCount = () => {
    const value = local.file.contents
    const total = value.split("\n").length - (value.endsWith("\n") ? 1 : 0)

    return Math.max(1, total)
  }

  const virtual = createMemo(() => lineCount() > virtualizeLineThreshold)

  const virtuals = createLocalVirtualStrategy(() => viewer.wrapper, virtual)
  const poolReady = createPoolReady()

  // Rows that are not drawn yet cannot show a range; the machine keeps it and the ready callback applies it again.
  const applySelection = (range: SelectedLineRange | null) => {
    const current = instance

    if (!current) return

    if (virtual()) return current.setSelectedLines(range)

    const root = viewer.getRoot()

    if (!root) return

    const total = lineCount()

    if (root.querySelectorAll("[data-line]").length < total) return

    if (!range) return current.setSelectedLines(null)

    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)

    if (start < 1 || end > total) return current.setSelectedLines(null)

    if (!root.querySelector(`[data-line="${start}"]`) || !root.querySelector(`[data-line="${end}"]`))
      return current.setSelectedLines(null)

    const normalized = (() => {
      if (range.endSide != null) return { start: range.start, end: range.end }

      if (range.side !== "deletions") return range

      if (root.querySelector("[data-deletions]") != null) return range

      return { start: range.start, end: range.end }
    })()

    current.setSelectedLines(normalized)
  }

  viewer = useFileViewer({
    mode: "text",
    enableLineSelection: () => props.enableLineSelection === true,
    selectedLines: () => local.selectedLines,
    commentedLines: () => local.commentedLines ?? [],
    callbacks: local,
    lineForElement: parseLine,
    lineForNode: findFileLineNumber,
    sideForNode: findCodeSelectionSide,
    applySelection,
    markCommented: markCommentedFileLines,
  })

  const options = createMemo(() => ({
    ...createDefaultOptions<T>("unified"),
    ...others,
    ...viewer.lineCallbacks,
  }))

  const notify = () => {
    notifyRendered({
      viewer,
      isReady: (root) => {
        if (virtual()) return root.querySelector("[data-line]") != null

        return root.querySelectorAll("[data-line]").length >= lineCount()
      },
      onReady: () => {
        viewer.reapplySelection()
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
    const workerPool = getWorkerPool()
    const virtualizer = virtuals.get()

    if (virtualizer && !poolReady(workerPool)) return
    // An instance keeps the virtualizer it was built with; options and contents update in place.
    const reset = instance !== undefined && instanceVirtualizer !== virtualizer
    const forceRender = !reset && instance !== undefined && !areOptionsEqual(instance.options, opts)

    renderViewer({
      viewer,
      current: instance,
      reset,
      create: () =>
        virtualizer
          ? new VirtualizedFile<T>(opts, virtualizer, codeMetrics, workerPool)
          : new PierreFile<T>(opts, workerPool),
      update: (value) => value.setOptions(opts),
      assign: (value) => {
        instance = value
        instanceVirtualizer = virtualizer
      },
      draw: (value) => {
        value.render({
          file: local.file,
          forceRender,
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
    annotations: () => local.annotations ?? [],
  })

  // -- cleanup --

  onCleanup(() => {
    instance?.cleanUp()
    instance = undefined
    instanceVirtualizer = undefined
    virtuals.cleanup()
  })

  return <ViewerShell mode="text" viewer={viewer} class={local.class} classList={local.classList} />
}

// ---------------------------------------------------------------------------
// DiffViewer
// ---------------------------------------------------------------------------

function DiffViewer<T>(props: DiffFileProps<T>) {
  let instance: FileDiff<T> | undefined
  let instanceVirtualizer: Virtualizer | undefined
  let instanceWorkerPool: ReturnType<typeof getWorkerPool>
  let instanceVirtualHunkSeparators: FileDiffOptions<T, undefined>["hunkSeparators"] | undefined
  let instanceFileDiff: FileDiffMetadata | undefined
  let instanceBefore: FileContents | undefined
  let instanceAfter: FileContents | undefined
  let viewer!: Viewer

  const [local, others] = splitProps(props, diffKeys)

  const mobile = createMediaQuery("(max-width: 640px)")

  // Rows outside a virtualized window are not in the DOM yet; keep the range so Pierre applies it when they render.
  const fixSelection = (range: SelectedLineRange | null) => {
    const fixed = fixDiffSelection(viewer.getRoot(), range)

    return fixed === null && instance instanceof VirtualizedFileDiff ? range : fixed
  }

  const applySelection = (range: SelectedLineRange | null) => {
    const active = instance

    if (!active) return
    const fixed = fixSelection(range)

    if (fixed !== undefined) active.setSelectedLines(fixed)
  }

  viewer = useFileViewer({
    mode: "diff",
    enableLineSelection: () => props.enableLineSelection === true,
    selectedLines: () => local.selectedLines,
    commentedLines: () => local.commentedLines ?? [],
    callbacks: local,
    lineForElement: findDiffLineNumber,
    sideForElement: diffMouseSide,
    lineForNode: findDiffLineNumber,
    sideForNode: diffSelectionSide,
    applySelection,
    normalize: fixSelection,
    markCommented: markCommentedDiffLines,
  })

  const virtuals = createSharedVirtualStrategy(
    () => viewer.container,
    () => local.virtualize !== false,
  )

  const poolReady = createPoolReady()

  const large = createMemo(() => {
    if (local.fileDiff) {
      const before = local.fileDiff.deletionLines.join("")
      const after = local.fileDiff.additionLines.join("")

      return Math.max(before.length, after.length) > 500_000
    }

    const before = local.before?.contents ?? ""
    const after = local.after?.contents ?? ""

    return Math.max(before.length, after.length) > 500_000
  })

  const largeOptions = {
    lineDiffType: "none",
    maxLineDiffLength: 0,
    tokenizeMaxLineLength: 1,
  } satisfies Pick<FileDiffOptions<T, undefined>, "lineDiffType" | "maxLineDiffLength" | "tokenizeMaxLineLength">

  const options = createMemo<FileDiffOptions<T, undefined>>(() => {
    const base = {
      ...createDefaultOptions(props.diffStyle),
      ...others,
      ...viewer.lineCallbacks,
    }

    const perf = large() ? { ...base, ...largeOptions } : base

    if (!mobile()) return perf

    return { ...perf, disableLineNumbers: props.disableLineNumbers ?? true }
  })

  // A virtualized diff only renders rows near the viewport, so jumping to a selection must scroll it into range first.
  let pendingReveal: SelectedLineRange | undefined

  const revealSelection = () => {
    const active = instance
    const range = pendingReveal

    if (!active || !range) return

    if (!(active instanceof VirtualizedFileDiff) || !instanceVirtualizer) {
      pendingReveal = undefined

      return
    }

    const position = active.getLinePosition(Math.min(range.start, range.end), range.side)
    const root = instanceVirtualizer.getRoot()

    // Keep the request until the diff has a layout to measure; the next render retries it.
    if (!position || !root) return
    pendingReveal = undefined
    const top = instanceVirtualizer.getOffsetInScrollContainer(viewer.container) + position.top
    const scrollTop = instanceVirtualizer.getScrollTop()
    const height = root instanceof Document ? window.innerHeight : root.clientHeight

    if (top >= scrollTop && top + position.height <= scrollTop + height) return
    instanceVirtualizer.scrollTo({ top: top - height / 2 })
  }

  createEffect(
    on(
      () => local.selectedLines,
      (range) => {
        pendingReveal = range ?? undefined
        revealSelection()
      },
    ),
  )

  const notify = (done?: VoidFunction) => {
    notifyRendered({
      viewer,
      isReady: (root) => root.querySelector("[data-line]") != null,
      settleFrames: 1,
      onReady: () => {
        done?.()
        viewer.reapplySelection()
        revealSelection()
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
    // Worker render options override per-viewer options, including the large-file fallback.
    const workerPool = getWorkerPool(large() ? "none" : "word-line")
    const virtualizer = virtuals.get()

    if (virtualizer && !poolReady(workerPool)) return
    const beforeContents = local.before?.contents ?? ""
    const afterContents = local.after?.contents ?? ""
    const done = preserve(viewer)

    onCleanup(done)

    const cacheKey = (contents: string) => {
      if (!large()) return sampledChecksum(contents, contents.length)

      return sampledChecksum(contents)
    }

    const before = local.before
      ? { ...local.before, contents: beforeContents, cacheKey: cacheKey(beforeContents) }
      : undefined

    const after = local.after
      ? { ...local.after, contents: afterContents, cacheKey: cacheKey(afterContents) }
      : undefined

    const targetChanged =
      local.fileDiff !== undefined
        ? instanceFileDiff !== local.fileDiff
        : instanceFileDiff !== undefined ||
          before === undefined ||
          after === undefined ||
          instanceBefore === undefined ||
          instanceAfter === undefined ||
          !areFilesEqual(instanceBefore, before) ||
          !areFilesEqual(instanceAfter, after)

    // Pierre beta virtualized instances retain their first diff target and resolve separator metrics at construction.
    // Plain timeline diffs can retain the instance as content streams; virtualized viewers reset only when that is unsafe.
    const reset =
      instance !== undefined &&
      (instanceVirtualizer !== virtualizer ||
        instanceWorkerPool !== workerPool ||
        (virtualizer !== undefined && (instanceVirtualHunkSeparators !== opts.hunkSeparators || targetChanged)))

    const forceRender = !reset && instance !== undefined && !areOptionsEqual(instance.options, opts)

    renderViewer({
      viewer,
      current: instance,
      reset,
      create: () =>
        virtualizer
          ? new VirtualizedFileDiff<T>(opts, virtualizer, virtualMetrics, workerPool)
          : new FileDiff<T>(opts, workerPool),
      update: (value) => value.setOptions(opts),
      assign: (value) => {
        instance = value
        instanceVirtualizer = virtualizer
        instanceWorkerPool = workerPool
        instanceVirtualHunkSeparators = virtualizer ? opts.hunkSeparators : undefined
        instanceFileDiff = local.fileDiff
        instanceBefore = before
        instanceAfter = after
      },
      draw: (value) => {
        if (local.fileDiff) {
          value.render({
            fileDiff: local.fileDiff,
            forceRender,
            lineAnnotations: [],
            containerWrapper: viewer.container,
          })

          return
        }

        if (!before || !after) return

        value.render({
          oldFile: before,
          newFile: after,
          forceRender,
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
    annotations: () => local.annotations ?? [],
  })

  // -- cleanup --

  onCleanup(() => {
    instance?.cleanUp()
    instance = undefined
    instanceVirtualizer = undefined
    instanceWorkerPool = undefined
    instanceVirtualHunkSeparators = undefined
    instanceFileDiff = undefined
    instanceBefore = undefined
    instanceAfter = undefined
    virtuals.cleanup()
  })

  return <ViewerShell mode="diff" viewer={viewer} class={local.class} classList={local.classList} />
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function File<T>(props: FileProps<T>) {
  if (props.mode === "text") {
    return <FileMedia media={props.media} fallback={() => TextViewer(props)} />
  }

  return <FileMedia media={props.media} fallback={() => DiffViewer(props)} />
}
