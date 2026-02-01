import { checksum } from "@opencode-ai/util/encode"
import { FileDiff, type SelectedLineRange } from "@pierre/diffs"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createMemo, createSignal, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, type DiffProps, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"

type SelectionSide = "additions" | "deletions"

function findElement(node: Node | null): HTMLElement | undefined {
  if (!node) return
  if (node instanceof HTMLElement) return node
  return node.parentElement ?? undefined
}

function findLineNumber(node: Node | null): number | undefined {
  const element = findElement(node)
  if (!element) return

  const line = element.closest("[data-line], [data-alt-line]")
  if (!(line instanceof HTMLElement)) return

  const value = (() => {
    const primary = parseInt(line.dataset.line ?? "", 10)
    if (!Number.isNaN(primary)) return primary

    const alt = parseInt(line.dataset.altLine ?? "", 10)
    if (!Number.isNaN(alt)) return alt
  })()

  return value
}

function findSide(node: Node | null): SelectionSide | undefined {
  const element = findElement(node)
  if (!element) return

  const line = element.closest("[data-line], [data-alt-line]")
  if (line instanceof HTMLElement) {
    const type = line.dataset.lineType
    if (type === "change-deletion") return "deletions"
    if (type === "change-addition" || type === "change-additions") return "additions"
  }

  const code = element.closest("[data-code]")
  if (!(code instanceof HTMLElement)) return

  if (code.hasAttribute("data-deletions")) return "deletions"
  return "additions"
}

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  let observer: MutationObserver | undefined
  let renderToken = 0
  let selectionFrame: number | undefined
  let dragFrame: number | undefined
  let dragStart: number | undefined
  let dragEnd: number | undefined
  let dragSide: SelectionSide | undefined
  let dragEndSide: SelectionSide | undefined
  let dragMoved = false
  let lastSelection: SelectedLineRange | null = null
  let pendingSelectionEnd = false

  const [local, others] = splitProps(props, [
    "before",
    "after",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "commentedLines",
    "onRendered",
  ])

  const mobile = createMediaQuery("(max-width: 640px)")

  const options = createMemo(() => {
    const opts = {
      ...createDefaultOptions(props.diffStyle),
      ...others,
    }
    if (!mobile()) return opts
    return {
      ...opts,
      disableLineNumbers: true,
    }
  })

  let instance: FileDiff<T> | undefined
  const [current, setCurrent] = createSignal<FileDiff<T> | undefined>(undefined)
  const [rendered, setRendered] = createSignal(0)

  const getRoot = () => {
    const host = container.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return

    const root = host.shadowRoot
    if (!root) return

    return root
  }

  const applyScheme = () => {
    const host = container.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return

    const scheme = document.documentElement.dataset.colorScheme
    if (scheme === "dark" || scheme === "light") {
      host.dataset.colorScheme = scheme
      return
    }

    host.removeAttribute("data-color-scheme")
  }

  const lineIndex = (split: boolean, element: HTMLElement) => {
    const raw = element.dataset.lineIndex
    if (!raw) return
    const values = raw
      .split(",")
      .map((value) => parseInt(value, 10))
      .filter((value) => !Number.isNaN(value))
    if (values.length === 0) return
    if (!split) return values[0]
    if (values.length === 2) return values[1]
    return values[0]
  }

  const rowIndex = (root: ShadowRoot, split: boolean, line: number, side: SelectionSide | undefined) => {
    const nodes = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-alt-line="${line}"]`)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    if (nodes.length === 0) return

    const targetSide = side ?? "additions"

    for (const node of nodes) {
      if (findSide(node) === targetSide) return lineIndex(split, node)
      if (parseInt(node.dataset.altLine ?? "", 10) === line) return lineIndex(split, node)
    }
  }

  const fixSelection = (range: SelectedLineRange | null) => {
    if (!range) return range
    const root = getRoot()
    if (!root) return

    const diffs = root.querySelector("[data-diffs]")
    if (!(diffs instanceof HTMLElement)) return

    const split = diffs.dataset.type === "split"

    const start = rowIndex(root, split, range.start, range.side)
    const end = rowIndex(root, split, range.end, range.endSide ?? range.side)
    if (start === undefined || end === undefined) {
      if (root.querySelector("[data-line], [data-alt-line]") == null) return
      return null
    }
    if (start <= end) return range

    const side = range.endSide ?? range.side
    const swapped: SelectedLineRange = {
      start: range.end,
      end: range.start,
    }

    if (side) swapped.side = side
    if (range.endSide && range.side) swapped.endSide = range.side

    return swapped
  }

  const notifyRendered = () => {
    observer?.disconnect()
    observer = undefined
    renderToken++

    const token = renderToken
    let settle = 0

    const isReady = (root: ShadowRoot) => root.querySelector("[data-line]") != null

    const notify = () => {
      if (token !== renderToken) return

      observer?.disconnect()
      observer = undefined
      requestAnimationFrame(() => {
        if (token !== renderToken) return
        setSelectedLines(lastSelection)
        local.onRendered?.()
      })
    }

    const schedule = () => {
      settle++
      const current = settle

      requestAnimationFrame(() => {
        if (token !== renderToken) return
        if (current !== settle) return

        requestAnimationFrame(() => {
          if (token !== renderToken) return
          if (current !== settle) return

          notify()
        })
      })
    }

    const observeRoot = (root: ShadowRoot) => {
      observer?.disconnect()
      observer = new MutationObserver(() => {
        if (token !== renderToken) return
        if (!isReady(root)) return

        schedule()
      })

      observer.observe(root, { childList: true, subtree: true })

      if (!isReady(root)) return
      schedule()
    }

    const root = getRoot()
    if (typeof MutationObserver === "undefined") {
      if (!root || !isReady(root)) return
      setSelectedLines(lastSelection)
      local.onRendered?.()
      return
    }

    if (root) {
      observeRoot(root)
      return
    }

    observer = new MutationObserver(() => {
      if (token !== renderToken) return

      const root = getRoot()
      if (!root) return

      observeRoot(root)
    })

    observer.observe(container, { childList: true, subtree: true })
  }

  const applyCommentedLines = (ranges: SelectedLineRange[]) => {
    const root = getRoot()
    if (!root) return

    const existing = Array.from(root.querySelectorAll("[data-comment-selected]"))
    for (const node of existing) {
      if (!(node instanceof HTMLElement)) continue
      node.removeAttribute("data-comment-selected")
    }

    const diffs = root.querySelector("[data-diffs]")
    if (!(diffs instanceof HTMLElement)) return

    const split = diffs.dataset.type === "split"

    const code = Array.from(diffs.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    if (code.length === 0) return

    for (const range of ranges) {
      const start = rowIndex(root, split, range.start, range.side)
      if (start === undefined) continue

      const end = (() => {
        const same = range.end === range.start && (range.endSide == null || range.endSide === range.side)
        if (same) return start
        return rowIndex(root, split, range.end, range.endSide ?? range.side)
      })()
      if (end === undefined) continue

      const first = Math.min(start, end)
      const last = Math.max(start, end)

      for (const block of code) {
        for (const element of Array.from(block.children)) {
          if (!(element instanceof HTMLElement)) continue
          const idx = lineIndex(split, element)
          if (idx === undefined) continue
          if (idx > last) break
          if (idx < first) continue
          element.setAttribute("data-comment-selected", "")
          const next = element.nextSibling
          if (next instanceof HTMLElement && next.hasAttribute("data-line-annotation")) {
            next.setAttribute("data-comment-selected", "")
          }
        }
      }
    }
  }

  const setSelectedLines = (range: SelectedLineRange | null) => {
    const active = current()
    if (!active) return

    const fixed = fixSelection(range)
    if (fixed === undefined) {
      lastSelection = range
      return
    }

    lastSelection = fixed
    active.setSelectedLines(fixed)
  }

  const updateSelection = () => {
    const root = getRoot()
    if (!root) return

    const selection =
      (root as unknown as { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection()
    if (!selection || selection.isCollapsed) return

    const domRange =
      (
        selection as unknown as {
          getComposedRanges?: (options?: { shadowRoots?: ShadowRoot[] }) => Range[]
        }
      ).getComposedRanges?.({ shadowRoots: [root] })?.[0] ??
      (selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined)

    const startNode = domRange?.startContainer ?? selection.anchorNode
    const endNode = domRange?.endContainer ?? selection.focusNode
    if (!startNode || !endNode) return

    if (!root.contains(startNode) || !root.contains(endNode)) return

    const start = findLineNumber(startNode)
    const end = findLineNumber(endNode)
    if (start === undefined || end === undefined) return

    const startSide = findSide(startNode)
    const endSide = findSide(endNode)
    const side = startSide ?? endSide

    const selected: SelectedLineRange = {
      start,
      end,
    }

    if (side) selected.side = side
    if (endSide && side && endSide !== side) selected.endSide = endSide

    setSelectedLines(selected)
  }

  const scheduleSelectionUpdate = () => {
    if (selectionFrame !== undefined) return

    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = undefined
      updateSelection()

      if (!pendingSelectionEnd) return
      pendingSelectionEnd = false
      props.onLineSelectionEnd?.(lastSelection)
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
    let side: SelectionSide | undefined

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

      if (line === undefined) {
        const primary = item.dataset.line ? parseInt(item.dataset.line, 10) : Number.NaN
        if (!Number.isNaN(primary)) {
          line = primary
        } else {
          const alt = item.dataset.altLine ? parseInt(item.dataset.altLine, 10) : Number.NaN
          if (!Number.isNaN(alt)) line = alt
        }
      }

      if (numberColumn && line !== undefined && side !== undefined) break
    }

    return { line, numberColumn, side }
  }

  const handleMouseDown = (event: MouseEvent) => {
    if (props.enableLineSelection !== true) return
    if (event.button !== 0) return

    const { line, numberColumn, side } = lineFromMouseEvent(event)
    if (numberColumn) return
    if (line === undefined) return

    dragStart = line
    dragEnd = line
    dragSide = side
    dragEndSide = side
    dragMoved = false
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (props.enableLineSelection !== true) return
    if (dragStart === undefined) return

    if ((event.buttons & 1) === 0) {
      dragStart = undefined
      dragEnd = undefined
      dragSide = undefined
      dragEndSide = undefined
      dragMoved = false
      return
    }

    const { line, side } = lineFromMouseEvent(event)
    if (line === undefined) return

    dragEnd = line
    dragEndSide = side
    dragMoved = true
    scheduleDragUpdate()
  }

  const handleMouseUp = () => {
    if (props.enableLineSelection !== true) return
    if (dragStart === undefined) return

    if (!dragMoved) {
      pendingSelectionEnd = false
      const line = dragStart
      const selected: SelectedLineRange = {
        start: line,
        end: line,
      }
      if (dragSide) selected.side = dragSide
      setSelectedLines(selected)
      props.onLineSelectionEnd?.(lastSelection)
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

  createEffect(() => {
    const opts = options()
    const workerPool = getWorkerPool(props.diffStyle)
    const annotations = local.annotations
    const beforeContents = typeof local.before?.contents === "string" ? local.before.contents : ""
    const afterContents = typeof local.after?.contents === "string" ? local.after.contents : ""

    instance?.cleanUp()
    instance = new FileDiff<T>(opts, workerPool)
    setCurrent(instance)

    container.innerHTML = ""
    instance.render({
      oldFile: {
        ...local.before,
        contents: beforeContents,
        cacheKey: checksum(beforeContents),
      },
      newFile: {
        ...local.after,
        contents: afterContents,
        cacheKey: checksum(afterContents),
      },
      lineAnnotations: annotations,
      containerWrapper: container,
    })

    applyScheme()

    setRendered((value) => value + 1)
    notifyRendered()
  })

  createEffect(() => {
    if (typeof document === "undefined") return
    if (typeof MutationObserver === "undefined") return

    const root = document.documentElement
    const monitor = new MutationObserver(() => applyScheme())
    monitor.observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] })
    applyScheme()

    onCleanup(() => monitor.disconnect())
  })

  createEffect(() => {
    rendered()
    const ranges = local.commentedLines ?? []
    requestAnimationFrame(() => applyCommentedLines(ranges))
  })

  createEffect(() => {
    const selected = local.selectedLines ?? null
    setSelectedLines(selected)
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
    observer?.disconnect()

    if (selectionFrame !== undefined) {
      cancelAnimationFrame(selectionFrame)
      selectionFrame = undefined
    }

    if (dragFrame !== undefined) {
      cancelAnimationFrame(dragFrame)
      dragFrame = undefined
    }

    dragStart = undefined
    dragEnd = undefined
    dragSide = undefined
    dragEndSide = undefined
    dragMoved = false
    lastSelection = null
    pendingSelectionEnd = false

    instance?.cleanUp()
    setCurrent(undefined)
  })

  return <div data-component="diff" style={styleVariables} ref={container} />
}
