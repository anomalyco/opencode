import { sampledChecksum } from "@opencode/util/encode"
import {
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
import { applyViewerScheme, getViewerHost, getViewerRoot, observeViewerScheme } from "../pierre/file-runtime"
import {
  findCodeSelectionSide,
  findDiffLineNumber,
  findElement,
  findFileLineNumber,
  readShadowLineSelection,
} from "../pierre/file-selection"
import {
  diffExpectsRows,
  INITIAL_VIEWER_RENDER_STATE,
  POOL_INIT_TIMEOUT_MS,
  readPoolState,
  ROWS_READY_TIMEOUT_MS,
  selectMountedSpec,
  selectRevision,
  transitionViewerRender,
  type ViewerInstanceSpec,
  type ViewerRenderEffect,
  type ViewerRenderEvent,
  type ViewerRenderRequest,
  type ViewerTarget,
} from "../pierre/render-machine"
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

  onCleanup(() => dispatch({ type: "disposed" }))

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

type ViewerRenderConfig<I extends RenderTarget, O> = {
  viewer: Viewer
  /** Pierre options; a change redraws, and a draw always uses the latest ones. */
  options: () => O
  /** Reads every other input a draw depends on; a change requests a new draw. */
  request: () => ViewerRenderRequest
  create: (spec: ViewerInstanceSpec, options: O) => I
  /** Applies options to a kept instance and returns whether its rows must render again. */
  update: (instance: I, options: O) => boolean
  draw: (instance: I, spec: ViewerInstanceSpec, forceRender: boolean) => void
  isReady: (root: ShadowRoot) => boolean
  annotations: () => unknown[]
  applyAnnotations: (instance: I) => void
  commentedLines: () => SelectedLineRange[]
  markCommented: (root: ShadowRoot, ranges: SelectedLineRange[]) => void
  /** Scrolls a range into a virtualized window; returns false while rows cannot be measured yet. */
  reveal?: (instance: I, spec: ViewerInstanceSpec, range: SelectedLineRange) => boolean
  onRendered: () => void
}

type ViewerRender<I> = {
  instance: () => I | undefined
  requestReveal: (range: SelectedLineRange | undefined) => void
}

function useViewerRender<I extends RenderTarget, O>(config: ViewerRenderConfig<I, O>): ViewerRender<I> {
  const viewer = config.viewer
  let state = INITIAL_VIEWER_RENDER_STATE
  let instance: I | undefined
  let observer: MutationObserver | undefined
  let poolTimer: ReturnType<typeof setTimeout> | undefined
  let rowsTimer: ReturnType<typeof setTimeout> | undefined
  let settleFrame: number | undefined
  let findFrame: number | undefined
  let releaseHeight: VoidFunction | undefined
  const [revision, setRevision] = createSignal(selectRevision(state))

  const cancelAsync = () => {
    observer?.disconnect()
    observer = undefined
    clearTimeout(poolTimer)
    clearTimeout(rowsTimer)
    poolTimer = undefined
    rowsTimer = undefined

    if (settleFrame !== undefined) cancelAnimationFrame(settleFrame)
    settleFrame = undefined
  }

  const watchRows = (attempt: number) => {
    const done = () => {
      observer?.disconnect()
      observer = undefined
      clearTimeout(rowsTimer)
      rowsTimer = undefined
      dispatch({ type: "rows.ready", attempt })
    }

    const watchRoot = (root: ShadowRoot) => {
      observer?.disconnect()
      observer = new MutationObserver(() => {
        if (config.isReady(root)) done()
      })
      observer.observe(root, { childList: true, subtree: true })
    }

    const root = viewer.getRoot()

    if (root && config.isReady(root)) return done()

    rowsTimer = setTimeout(() => {
      rowsTimer = undefined
      dispatch({ type: "rows.timed-out", attempt })
    }, ROWS_READY_TIMEOUT_MS)

    if (root) return watchRoot(root)

    observer = new MutationObserver(() => {
      const next = viewer.getRoot()

      if (!next) return

      if (config.isReady(next)) return done()
      watchRoot(next)
    })
    observer.observe(viewer.container, { childList: true, subtree: true })
  }

  const run = (effect: ViewerRenderEffect) => {
    if (effect.type === "cancel-async") return cancelAsync()

    if (effect.type === "await-pool") {
      poolTimer = setTimeout(() => {
        poolTimer = undefined
        dispatch({ type: "pool.timed-out", attempt: effect.attempt })
      }, POOL_INIT_TIMEOUT_MS)
      void effect.pool.initialize().then(
        () => dispatch({ type: "pool.settled", attempt: effect.attempt, ok: true }),
        () => dispatch({ type: "pool.settled", attempt: effect.attempt, ok: false }),
      )

      return
    }

    if (effect.type === "preserve-height") {
      releaseHeight ??= preserve(viewer)

      return
    }

    if (effect.type === "release-height") {
      releaseHeight?.()
      releaseHeight = undefined

      return
    }

    if (effect.type === "draw") {
      if (effect.action === "reset") {
        instance?.cleanUp()
        instance = undefined
      }

      const options = config.options()
      const forceRender = instance ? config.update(instance, options) : false

      if (!instance) {
        viewer.container.innerHTML = ""
        instance = config.create(effect.spec, options)
      }

      config.draw(instance, effect.spec, forceRender)
      applyViewerScheme(viewer.getHost())

      return
    }

    if (effect.type === "sync-annotations")
      return dispatch({ type: "annotations.synced", count: config.annotations().length })

    if (effect.type === "apply-annotations") {
      if (!instance) return
      config.applyAnnotations(instance)

      if (findFrame !== undefined) cancelAnimationFrame(findFrame)
      findFrame = requestAnimationFrame(() => {
        findFrame = undefined
        viewer.find.refresh({ reset: true })
      })

      return
    }

    if (effect.type === "watch-rows") return watchRows(effect.attempt)

    if (effect.type === "schedule-settle-frame") {
      settleFrame = requestAnimationFrame(() => {
        settleFrame = undefined
        dispatch({ type: "settle.frame", attempt: effect.attempt })
      })

      return
    }

    if (effect.type === "reapply-selection") return viewer.reapplySelection()

    if (effect.type === "try-reveal") {
      const spec = selectMountedSpec(state)

      if (!instance || !spec) return

      if (!config.reveal || config.reveal(instance, spec, effect.range)) dispatch({ type: "reveal.completed" })

      return
    }

    if (effect.type === "refresh-find") return viewer.find.refresh({ reset: true })

    if (effect.type === "notify-rendered") return config.onRendered()

    instance?.cleanUp()
    instance = undefined

    if (findFrame !== undefined) cancelAnimationFrame(findFrame)
  }

  // Effects can dispatch again synchronously (rows already drawn, annotations synced after a draw).
  const dispatch = (event: ViewerRenderEvent) => {
    const step = transitionViewerRender(state, event)
    const changed = selectRevision(step.state) !== selectRevision(state)
    state = step.state
    step.effects.forEach(run)

    if (changed && state.status !== "disposed") setRevision(selectRevision(state))
  }

  createEffect(() => {
    config.options()
    const request = config.request()
    untrack(() => dispatch({ type: "render.requested", request }))
  })

  // Each draw syncs annotations itself, so only later changes dispatch here.
  createEffect(
    on(config.annotations, (annotations) => dispatch({ type: "annotations.synced", count: annotations.length }), {
      defer: true,
    }),
  )

  createEffect(() => {
    revision()
    const ranges = config.commentedLines()
    const root = viewer.getRoot()

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

    const watch = new MutationObserver(mark)

    watch.observe(root, { childList: true, subtree: true })
    mark()

    onCleanup(() => {
      watch.disconnect()

      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    instance: () => instance,
    requestReveal: (range) => dispatch({ type: "reveal.requested", range }),
  }
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
  let viewer!: Viewer
  let render!: ViewerRender<PierreFile<T> | VirtualizedFile<T>>

  const [local, others] = splitProps(props, textKeys)

  const lineCount = () => {
    const value = local.file.contents
    const total = value.split("\n").length - (value.endsWith("\n") ? 1 : 0)

    return Math.max(1, total)
  }

  const virtual = createMemo(() => lineCount() > virtualizeLineThreshold)

  const virtuals = createLocalVirtualStrategy(() => viewer.wrapper, virtual)

  // Rows that are not drawn yet cannot show a range; the machine keeps it and the ready callback applies it again.
  const applySelection = (range: SelectedLineRange | null) => {
    const current = render.instance()

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
    callbacks: local,
    lineForElement: parseLine,
    lineForNode: findFileLineNumber,
    sideForNode: findCodeSelectionSide,
    applySelection,
  })

  const options = createMemo(() => ({
    ...createDefaultOptions<T>("unified"),
    ...others,
    ...viewer.lineCallbacks,
  }))

  useSearchHandle({
    search: () => local.search,
    find: viewer.find,
  })

  // Cleanups run in reverse, so the instance is cleaned up before the virtualizer it uses.
  onCleanup(() => virtuals.cleanup())

  // An instance keeps the virtualizer and pool it was built with; options and contents update in place.
  render = useViewerRender({
    viewer,
    options,
    request: () => {
      const workerPool = getWorkerPool()

      return {
        spec: {
          virtualizer: virtuals.get(),
          workerPool,
          hunkSeparators: undefined,
          target: { kind: "text", file: local.file },
        },
        pool: readPoolState(workerPool),
        settleFrames: 0,
        preserveHeight: false,
        expectsRows: true,
      }
    },
    create: (spec, opts) =>
      spec.virtualizer
        ? new VirtualizedFile<T>(opts, spec.virtualizer, codeMetrics, spec.workerPool)
        : new PierreFile<T>(opts, spec.workerPool),
    update: (instance, opts) => {
      const forceRender = !areOptionsEqual(instance.options, opts)
      instance.setOptions(opts)

      return forceRender
    },
    draw: (instance, spec, forceRender) => {
      if (spec.target.kind !== "text") return
      instance.render({ file: spec.target.file, forceRender, lineAnnotations: [], containerWrapper: viewer.container })
    },
    isReady: (root) => {
      if (virtual()) return root.querySelector("[data-line]") != null

      return root.querySelectorAll("[data-line]").length >= lineCount()
    },
    annotations: () => local.annotations ?? [],
    applyAnnotations: (instance) => {
      instance.setLineAnnotations(local.annotations ?? [])
      instance.rerender()
    },
    commentedLines: () => local.commentedLines ?? [],
    markCommented: markCommentedFileLines,
    onRendered: () => local.onRendered?.(),
  })

  return <ViewerShell mode="text" viewer={viewer} class={local.class} classList={local.classList} />
}

// ---------------------------------------------------------------------------
// DiffViewer
// ---------------------------------------------------------------------------

function DiffViewer<T>(props: DiffFileProps<T>) {
  let viewer!: Viewer
  let render!: ViewerRender<FileDiff<T>>

  const [local, others] = splitProps(props, diffKeys)

  const mobile = createMediaQuery("(max-width: 640px)")

  // Rows outside a virtualized window are not in the DOM yet; keep the range so Pierre applies it when they render.
  const fixSelection = (range: SelectedLineRange | null) => {
    const fixed = fixDiffSelection(viewer.getRoot(), range)

    return fixed === null && render.instance() instanceof VirtualizedFileDiff ? range : fixed
  }

  const applySelection = (range: SelectedLineRange | null) => {
    const active = render.instance()

    if (!active) return
    const fixed = fixSelection(range)

    if (fixed !== undefined) active.setSelectedLines(fixed)
  }

  viewer = useFileViewer({
    mode: "diff",
    enableLineSelection: () => props.enableLineSelection === true,
    selectedLines: () => local.selectedLines,
    callbacks: local,
    lineForElement: findDiffLineNumber,
    sideForElement: diffMouseSide,
    lineForNode: findDiffLineNumber,
    sideForNode: diffSelectionSide,
    applySelection,
    normalize: fixSelection,
  })

  const virtuals = createSharedVirtualStrategy(
    () => viewer.container,
    () => local.virtualize !== false,
  )

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

  useSearchHandle({
    search: () => local.search,
    find: viewer.find,
  })

  const cacheKey = (contents: string) =>
    large() ? sampledChecksum(contents) : sampledChecksum(contents, contents.length)

  const target = (): ViewerTarget => {
    if (local.fileDiff) return { kind: "diff-patch", fileDiff: local.fileDiff }

    if (!local.before || !local.after) return { kind: "diff-empty" }

    return {
      kind: "diff-files",
      before: { ...local.before, cacheKey: cacheKey(local.before.contents) },
      after: { ...local.after, cacheKey: cacheKey(local.after.contents) },
    }
  }

  // Cleanups run in reverse, so the instance is cleaned up before it releases the shared virtualizer.
  onCleanup(() => virtuals.cleanup())

  // Pierre beta virtualized instances retain their first diff target and resolve separator metrics at construction.
  // Plain timeline diffs keep the instance as content streams; virtualized viewers reset only when that is unsafe.
  render = useViewerRender({
    viewer,
    options,
    request: () => {
      // Worker render options override per-viewer options, including the large-file fallback.
      const workerPool = getWorkerPool(large() ? "none" : "word-line")
      const virtualizer = virtuals.get()
      const next = target()

      return {
        spec: {
          virtualizer,
          workerPool,
          hunkSeparators: virtualizer ? options().hunkSeparators : undefined,
          target: next,
        },
        pool: readPoolState(workerPool),
        settleFrames: 1,
        preserveHeight: true,
        expectsRows: diffExpectsRows(next, options().expandUnchanged),
      }
    },
    create: (spec, opts) =>
      spec.virtualizer
        ? new VirtualizedFileDiff<T>(opts, spec.virtualizer, virtualMetrics, spec.workerPool)
        : new FileDiff<T>(opts, spec.workerPool),
    update: (instance, opts) => {
      const forceRender = !areOptionsEqual(instance.options, opts)
      instance.setOptions(opts)

      return forceRender
    },
    draw: (instance, spec, forceRender) => {
      if (spec.target.kind === "diff-patch") {
        instance.render({
          fileDiff: spec.target.fileDiff,
          forceRender,
          lineAnnotations: [],
          containerWrapper: viewer.container,
        })

        return
      }

      if (spec.target.kind !== "diff-files") return

      instance.render({
        oldFile: spec.target.before,
        newFile: spec.target.after,
        forceRender,
        lineAnnotations: [],
        containerWrapper: viewer.container,
      })
    },
    isReady: (root) => root.querySelector("[data-line]") != null,
    annotations: () => local.annotations ?? [],
    applyAnnotations: (instance) => {
      instance.setLineAnnotations(local.annotations ?? [])
      instance.rerender()
    },
    commentedLines: () => local.commentedLines ?? [],
    markCommented: markCommentedDiffLines,
    // A virtualized diff only renders rows near the viewport, so jumping to a selection must scroll it into range.
    reveal: (instance, spec, range) => {
      const virtualizer = spec.virtualizer

      if (!(instance instanceof VirtualizedFileDiff) || !virtualizer) return true

      const position = instance.getLinePosition(Math.min(range.start, range.end), range.side)
      const root = virtualizer.getRoot()

      // Keep the request until the diff has a layout to measure; the next ready draw retries it.
      if (!position || !root) return false

      const top = virtualizer.getOffsetInScrollContainer(viewer.container) + position.top
      const scrollTop = virtualizer.getScrollTop()
      const height = root instanceof Document ? window.innerHeight : root.clientHeight

      if (top < scrollTop || top + position.height > scrollTop + height) virtualizer.scrollTo({ top: top - height / 2 })

      return true
    },
    onRendered: () => local.onRendered?.(),
  })

  createEffect(
    on(
      () => local.selectedLines,
      (range) => render.requestReveal(range ?? undefined),
    ),
  )

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
