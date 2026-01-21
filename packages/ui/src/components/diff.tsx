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

  const getRoot = () => {
    const host = container.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return

    const root = host.shadowRoot
    if (!root) return

    return root
  }

  const notifyRendered = () => {
    if (!local.onRendered) return

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
      local.onRendered()
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

  const setSelectedLines = (range: SelectedLineRange | null) => {
    const active = current()
    if (!active) return
    lastSelection = range
    active.setSelectedLines(range)
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

    if (dragMoved) {
      pendingSelectionEnd = true
      scheduleDragUpdate()
      scheduleSelectionUpdate()
    }

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

    notifyRendered()
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
