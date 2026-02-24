import { sampledChecksum } from "@opencode-ai/util/encode"
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
import { ComponentProps, createEffect, createMemo, createSignal, onCleanup, onMount, Show, splitProps } from "solid-js"
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
import { createLineNumberSelectionBridge, restoreShadowTextSelection } from "../pierre/selection-bridge"
import { acquireVirtualizer, virtualMetrics } from "../pierre/virtualizer"
import { getWorkerPool } from "../pierre/worker"
import { FileMedia, type FileMediaOptions } from "./file-media"
import { FileSearchBar } from "./file-search"

const VIRTUALIZE_BYTES = 500_000

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

function TextViewer<T>(props: TextFileProps<T>) {
  let wrapper!: HTMLDivElement
  let container!: HTMLDivElement
  let overlay!: HTMLDivElement
  let instance: PierreFile<T> | VirtualizedFile<T> | undefined
  let virtualizer: Virtualizer | undefined
  let virtualRoot: Document | HTMLElement | undefined
  let selectionFrame: number | undefined
  let dragFrame: number | undefined
  let dragStart: number | undefined
  let dragEnd: number | undefined
  let dragMoved = false
  let lastSelection: SelectedLineRange | null = null
  let pendingSelectionEnd = false

  const ready = createReadyWatcher()
  const bridge = createLineNumberSelectionBridge()

  const [local, others] = splitProps(props, [
    "mode",
    "media",
    "file",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "commentedLines",
    "onLineSelected",
    "onLineSelectionEnd",
    "onLineNumberSelectionEnd",
    "onRendered",
    "preloadedDiff",
  ])

  const [rendered, setRendered] = createSignal(0)

  const getRoot = () => getViewerRoot(container)
  const getHost = () => getViewerHost(container)

  const find = createFileFind({
    wrapper: () => wrapper,
    overlay: () => overlay,
    getRoot,
  })

  const bytes = createMemo(() => {
    const value = local.file.contents as unknown
    if (typeof value === "string") return value.length
    if (Array.isArray(value)) {
      return value.reduce(
        (sum, part) => sum + (typeof part === "string" ? part.length + 1 : String(part).length + 1),
        0,
      )
    }
    if (value == null) return 0
    return String(value).length
  })

  const virtual = createMemo(() => bytes() > VIRTUALIZE_BYTES)

  const options = createMemo(() => ({
    ...createDefaultOptions<T>("unified"),
    ...others,
    onLineSelected: (range: SelectedLineRange | null) => {
      lastSelection = range
      local.onLineSelected?.(range)
    },
    onLineSelectionEnd: (range: SelectedLineRange | null) => {
      lastSelection = range
      local.onLineSelectionEnd?.(range)
      if (!bridge.consume(range)) return
      requestAnimationFrame(() => local.onLineNumberSelectionEnd?.(range))
    },
  }))

  const text = () => {
    const value = local.file.contents as unknown
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.join("\n")
    if (value == null) return ""
    return String(value)
  }

  const lineCount = () => {
    const value = text()
    const total = value.split("\n").length - (value.endsWith("\n") ? 1 : 0)
    return Math.max(1, total)
  }

  const getScrollParent = (el: HTMLElement): HTMLElement | undefined => {
    let parent = el.parentElement
    while (parent) {
      const style = getComputedStyle(parent)
      if (style.overflowY === "auto" || style.overflowY === "scroll") return parent
      parent = parent.parentElement
    }
  }

  const applySelection = (range: SelectedLineRange | null) => {
    const current = instance
    if (!current) return false

    if (virtual()) {
      current.setSelectedLines(range)
      return true
    }

    const root = getRoot()
    if (!root) return false

    const total = lineCount()
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
    lastSelection = range
    applySelection(range)
  }

  const notifyRendered = () => {
    notifyShadowReady({
      state: ready,
      container,
      getRoot,
      isReady: (root) => {
        if (virtual()) return root.querySelector("[data-line]") != null
        return root.querySelectorAll("[data-line]").length >= lineCount()
      },
      onReady: () => {
        applySelection(lastSelection)
        find.refresh({ reset: true })
        local.onRendered?.()
      },
    })
  }

  const updateSelection = (preserveTextSelection = false) => {
    const root = getRoot()
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
  }

  const scheduleSelectionUpdate = () => {
    if (selectionFrame !== undefined) return
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = undefined
      const finishing = pendingSelectionEnd
      updateSelection(finishing)
      if (!pendingSelectionEnd) return
      pendingSelectionEnd = false
      local.onLineSelectionEnd?.(lastSelection)
    })
  }

  const updateDragSelection = () => {
    if (dragStart === undefined || dragEnd === undefined) return
    const start = Math.min(dragStart, dragEnd)
    const end = Math.max(dragStart, dragEnd)
    setSelectedLines({ start, end })
  }

  const scheduleDragUpdate = () => {
    if (dragFrame !== undefined) return
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined
      updateDragSelection()
    })
  }

  const lineFromMouseEvent = (event: MouseEvent) => {
    const path = event.composedPath()
    let numberColumn = false
    let line: number | undefined

    for (const item of path) {
      if (!(item instanceof HTMLElement)) continue
      numberColumn = numberColumn || item.dataset.columnNumber != null
      if (line === undefined && item.dataset.line) {
        const parsed = parseInt(item.dataset.line, 10)
        if (!Number.isNaN(parsed)) line = parsed
      }
      if (numberColumn && line !== undefined) break
    }

    return { line, numberColumn }
  }

  const handleMouseDown = (event: MouseEvent) => {
    if (props.enableLineSelection !== true) return
    if (event.button !== 0) return

    const { line, numberColumn } = lineFromMouseEvent(event)
    if (numberColumn) {
      bridge.begin(true, line)
      return
    }
    if (line === undefined) return

    bridge.begin(false, line)
    dragStart = line
    dragEnd = line
    dragMoved = false
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (props.enableLineSelection !== true) return

    const next = lineFromMouseEvent(event)
    if (bridge.track(event.buttons, next.line)) return
    if (dragStart === undefined) return

    if ((event.buttons & 1) === 0) {
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
      bridge.finish()
      return
    }

    if (next.line === undefined) return
    dragEnd = next.line
    dragMoved = true
    scheduleDragUpdate()
  }

  const handleMouseUp = () => {
    if (props.enableLineSelection !== true) return
    if (bridge.finish() === "numbers") return
    if (dragStart === undefined) return

    if (!dragMoved) {
      pendingSelectionEnd = false
      setSelectedLines({ start: dragStart, end: dragStart })
      local.onLineSelectionEnd?.(lastSelection)
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
      return
    }

    pendingSelectionEnd = true
    scheduleDragUpdate()
    scheduleSelectionUpdate()

    dragStart = undefined
    dragEnd = undefined
    dragMoved = false
  }

  const handleSelectionChange = () => {
    if (props.enableLineSelection !== true) return
    if (dragStart === undefined) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    scheduleSelectionUpdate()
  }

  onMount(() => {
    onCleanup(observeViewerScheme(getHost))
  })

  createEffect(() => {
    const opts = options()
    const workerPool = getWorkerPool("unified")
    const isVirtual = virtual()

    clearReadyWatcher(ready)
    instance?.cleanUp()
    instance = undefined

    if (!isVirtual && virtualizer) {
      virtualizer.cleanUp()
      virtualizer = undefined
      virtualRoot = undefined
    }

    const v = (() => {
      if (!isVirtual) return
      if (typeof document === "undefined") return

      const root = getScrollParent(wrapper) ?? document
      if (virtualizer && virtualRoot === root) return virtualizer

      virtualizer?.cleanUp()
      virtualizer = new Virtualizer()
      virtualRoot = root
      virtualizer.setup(root, root instanceof Document ? undefined : wrapper)
      return virtualizer
    })()

    instance =
      isVirtual && v ? new VirtualizedFile<T>(opts, v, codeMetrics, workerPool) : new PierreFile<T>(opts, workerPool)

    container.innerHTML = ""
    const value = text()
    instance.render({
      file: typeof local.file.contents === "string" ? local.file : { ...local.file, contents: value },
      lineAnnotations: [],
      containerWrapper: container,
    })

    applyViewerScheme(getHost())
    setRendered((value) => value + 1)
    notifyRendered()
  })

  createEffect(() => {
    rendered()
    const active = instance
    if (!active) return
    active.setLineAnnotations((local.annotations as LineAnnotation<T>[] | undefined) ?? [])
    active.rerender()
    requestAnimationFrame(() => find.refresh({ reset: true }))
  })

  createEffect(() => {
    rendered()
    const ranges = local.commentedLines ?? []
    requestAnimationFrame(() => {
      const root = getRoot()
      if (!root) return
      markCommentedFileLines(root, ranges)
    })
  })

  createEffect(() => {
    setSelectedLines(local.selectedLines ?? null)
  })

  createEffect(() => {
    if (props.enableLineSelection !== true) return

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

    instance?.cleanUp()
    instance = undefined

    virtualizer?.cleanUp()
    virtualizer = undefined
    virtualRoot = undefined

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

  return (
    <div
      data-component="file"
      data-mode="text"
      style={styleVariables}
      class="relative outline-none"
      classList={{
        ...(local.classList || {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={wrapper}
      tabIndex={0}
      onPointerDown={find.onPointerDown}
      onFocus={find.onFocus}
    >
      <Show when={find.open()}>
        <FileSearchBar
          pos={find.pos}
          query={find.query}
          count={find.count}
          index={find.index}
          setInput={find.setInput}
          onInput={find.setQuery}
          onKeyDown={find.onInputKeyDown}
          onClose={find.close}
          onPrev={() => find.next(-1)}
          onNext={() => find.next(1)}
        />
      </Show>
      <div ref={container} />
      <div ref={overlay} class="pointer-events-none absolute inset-0 z-0" />
    </div>
  )
}

function DiffViewer<T>(props: DiffFileProps<T>) {
  let wrapper!: HTMLDivElement
  let container!: HTMLDivElement
  let overlay!: HTMLDivElement
  let instance: FileDiff<T> | undefined
  let selectionFrame: number | undefined
  let dragFrame: number | undefined
  let dragStart: number | undefined
  let dragEnd: number | undefined
  let dragSide: DiffSelectionSide | undefined
  let dragEndSide: DiffSelectionSide | undefined
  let dragMoved = false
  let lastSelection: SelectedLineRange | null = null
  let pendingSelectionEnd = false
  let sharedVirtualizer: NonNullable<ReturnType<typeof acquireVirtualizer>> | undefined

  const ready = createReadyWatcher()
  const bridge = createLineNumberSelectionBridge()

  const [local, others] = splitProps(props, [
    "mode",
    "media",
    "before",
    "after",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "commentedLines",
    "onLineSelected",
    "onLineSelectionEnd",
    "onLineNumberSelectionEnd",
    "onRendered",
    "preloadedDiff",
  ])

  const mobile = createMediaQuery("(max-width: 640px)")
  const [current, setCurrent] = createSignal<FileDiff<T> | undefined>(undefined)
  const [rendered, setRendered] = createSignal(0)

  const getRoot = () => getViewerRoot(container)
  const getHost = () => getViewerHost(container)

  const find = createFileFind({
    wrapper: () => wrapper,
    overlay: () => overlay,
    getRoot,
  })

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

  const options = createMemo<FileDiffOptions<T>>(() => {
    const base = {
      ...createDefaultOptions(props.diffStyle),
      ...others,
      onLineSelected: (range: SelectedLineRange | null) => {
        const fixed = fixDiffSelection(getRoot(), range)
        const next = fixed === undefined ? range : fixed
        lastSelection = next
        local.onLineSelected?.(next)
      },
      onLineSelectionEnd: (range: SelectedLineRange | null) => {
        const fixed = fixDiffSelection(getRoot(), range)
        const next = fixed === undefined ? range : fixed
        lastSelection = next
        local.onLineSelectionEnd?.(next)
        if (!bridge.consume(next)) return
        requestAnimationFrame(() => local.onLineNumberSelectionEnd?.(next))
      },
    }

    const perf = large() ? { ...base, ...largeOptions } : base
    if (!mobile()) return perf
    return { ...perf, disableLineNumbers: true }
  })

  const getVirtualizer = () => {
    if (sharedVirtualizer) return sharedVirtualizer.virtualizer
    const result = acquireVirtualizer(container)
    if (!result) return
    sharedVirtualizer = result
    return result.virtualizer
  }

  const setSelectedLines = (range: SelectedLineRange | null, preserve?: { root: ShadowRoot; text: Range }) => {
    const active = current()
    if (!active) return

    const fixed = fixDiffSelection(getRoot(), range)
    if (fixed === undefined) {
      lastSelection = range
      return
    }

    lastSelection = fixed
    active.setSelectedLines(fixed)
    restoreShadowTextSelection(preserve?.root, preserve?.text)
  }

  const notifyRendered = () => {
    notifyShadowReady({
      state: ready,
      container,
      getRoot,
      isReady: (root) => root.querySelector("[data-line]") != null,
      settleFrames: 1,
      onReady: () => {
        setSelectedLines(lastSelection)
        find.refresh({ reset: true })
        local.onRendered?.()
      },
    })
  }

  const updateSelection = (preserveTextSelection = false) => {
    const root = getRoot()
    if (!root) return

    const selected = readShadowLineSelection({
      root,
      lineForNode: findDiffLineNumber,
      sideForNode: (node) => {
        const el = findElement(node)
        if (!el) return
        return findDiffSide(el)
      },
      preserveTextSelection,
    })
    if (!selected) return

    if (selected.text) {
      setSelectedLines(selected.range, { root, text: selected.text })
      return
    }

    setSelectedLines(selected.range)
  }

  const scheduleSelectionUpdate = () => {
    if (selectionFrame !== undefined) return
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = undefined
      const finishing = pendingSelectionEnd
      updateSelection(finishing)
      if (!pendingSelectionEnd) return
      pendingSelectionEnd = false
      local.onLineSelectionEnd?.(lastSelection)
    })
  }

  const updateDragSelection = () => {
    if (dragStart === undefined || dragEnd === undefined) return

    const selected: SelectedLineRange = {
      start: dragStart,
      end: dragEnd,
    }
    if (dragSide) selected.side = dragSide
    if (dragEndSide && dragSide && dragEndSide !== dragSide) selected.endSide = dragEndSide
    setSelectedLines(selected)
  }

  const scheduleDragUpdate = () => {
    if (dragFrame !== undefined) return
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined
      updateDragSelection()
    })
  }

  const lineFromMouseEvent = (event: MouseEvent) => {
    const path = event.composedPath()

    let numberColumn = false
    let line: number | undefined
    let side: DiffSelectionSide | undefined

    for (const item of path) {
      if (!(item instanceof HTMLElement)) continue

      numberColumn = numberColumn || item.dataset.columnNumber != null

      if (side === undefined) {
        const type = item.dataset.lineType
        if (type === "change-deletion") side = "deletions"
        if (type === "change-addition" || type === "change-additions") side = "additions"
      }

      if (side === undefined && item.dataset.code != null) {
        side = item.hasAttribute("data-deletions") ? "deletions" : "additions"
      }

      if (line === undefined) line = findDiffLineNumber(item)
      if (numberColumn && line !== undefined && side !== undefined) break
    }

    return { line, numberColumn, side }
  }

  const handleMouseDown = (event: MouseEvent) => {
    if (props.enableLineSelection !== true) return
    if (event.button !== 0) return

    const next = lineFromMouseEvent(event)
    if (next.numberColumn) {
      bridge.begin(true, next.line)
      return
    }
    if (next.line === undefined) return

    bridge.begin(false, next.line)
    dragStart = next.line
    dragEnd = next.line
    dragSide = next.side
    dragEndSide = next.side
    dragMoved = false
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (props.enableLineSelection !== true) return

    const next = lineFromMouseEvent(event)
    if (bridge.track(event.buttons, next.line)) return
    if (dragStart === undefined) return

    if ((event.buttons & 1) === 0) {
      dragStart = undefined
      dragEnd = undefined
      dragSide = undefined
      dragEndSide = undefined
      dragMoved = false
      bridge.finish()
      return
    }

    if (next.line === undefined) return

    dragEnd = next.line
    dragEndSide = next.side
    dragMoved = true
    scheduleDragUpdate()
  }

  const handleMouseUp = () => {
    if (props.enableLineSelection !== true) return
    if (bridge.finish() === "numbers") return
    if (dragStart === undefined) return

    if (!dragMoved) {
      pendingSelectionEnd = false
      const selected: SelectedLineRange = { start: dragStart, end: dragStart }
      if (dragSide) selected.side = dragSide
      setSelectedLines(selected)
      local.onLineSelectionEnd?.(lastSelection)
      dragStart = undefined
      dragEnd = undefined
      dragSide = undefined
      dragEndSide = undefined
      dragMoved = false
      return
    }

    pendingSelectionEnd = true
    scheduleDragUpdate()
    scheduleSelectionUpdate()

    dragStart = undefined
    dragEnd = undefined
    dragSide = undefined
    dragEndSide = undefined
    dragMoved = false
  }

  const handleSelectionChange = () => {
    if (props.enableLineSelection !== true) return
    if (dragStart === undefined) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    scheduleSelectionUpdate()
  }

  onMount(() => {
    onCleanup(observeViewerScheme(getHost))
  })

  createEffect(() => {
    const opts = options()
    const workerPool = large() ? getWorkerPool("unified") : getWorkerPool(props.diffStyle)
    const virtualizer = getVirtualizer()
    const beforeContents = typeof local.before?.contents === "string" ? local.before.contents : ""
    const afterContents = typeof local.after?.contents === "string" ? local.after.contents : ""

    const cacheKey = (contents: string) => {
      if (!large()) return sampledChecksum(contents, contents.length)
      return sampledChecksum(contents)
    }

    clearReadyWatcher(ready)
    instance?.cleanUp()
    instance = virtualizer
      ? new VirtualizedFileDiff<T>(opts, virtualizer, virtualMetrics, workerPool)
      : new FileDiff<T>(opts, workerPool)
    setCurrent(instance)

    container.innerHTML = ""
    instance.render({
      oldFile: { ...local.before, contents: beforeContents, cacheKey: cacheKey(beforeContents) },
      newFile: { ...local.after, contents: afterContents, cacheKey: cacheKey(afterContents) },
      lineAnnotations: [],
      containerWrapper: container,
    })

    applyViewerScheme(getHost())
    setRendered((value) => value + 1)
    notifyRendered()
  })

  createEffect(() => {
    rendered()
    const active = current()
    if (!active) return
    active.setLineAnnotations((local.annotations as DiffLineAnnotation<T>[] | undefined) ?? [])
    active.rerender()
    requestAnimationFrame(() => find.refresh({ reset: true }))
  })

  createEffect(() => {
    rendered()
    const ranges = local.commentedLines ?? []
    requestAnimationFrame(() => {
      const root = getRoot()
      if (!root) return
      markCommentedDiffLines(root, ranges)
    })
  })

  createEffect(() => {
    setSelectedLines(local.selectedLines ?? null)
  })

  createEffect(() => {
    if (props.enableLineSelection !== true) return

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
    dragSide = undefined
    dragEndSide = undefined
    dragMoved = false
    bridge.reset()
    lastSelection = null
    pendingSelectionEnd = false

    instance?.cleanUp()
    setCurrent(undefined)
    sharedVirtualizer?.release()
    sharedVirtualizer = undefined
  })

  return (
    <div
      data-component="file"
      data-mode="diff"
      style={styleVariables}
      class="relative outline-none"
      classList={{
        ...(local.classList || {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={wrapper}
      tabIndex={0}
      onPointerDown={find.onPointerDown}
      onFocus={find.onFocus}
    >
      <Show when={find.open()}>
        <FileSearchBar
          pos={find.pos}
          query={find.query}
          count={find.count}
          index={find.index}
          setInput={find.setInput}
          onInput={find.setQuery}
          onKeyDown={find.onInputKeyDown}
          onClose={find.close}
          onPrev={() => find.next(-1)}
          onNext={() => find.next(1)}
        />
      </Show>
      <div ref={container} />
      <div ref={overlay} class="pointer-events-none absolute inset-0 z-0" />
    </div>
  )
}

export function File<T>(props: FileProps<T>) {
  if (props.mode === "text") {
    return <FileMedia media={props.media} fallback={() => TextViewer(props)} />
  }

  return <FileMedia media={props.media} fallback={() => DiffViewer(props)} />
}
