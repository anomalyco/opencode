import { type FileContents, File, FileOptions, LineAnnotation, type SelectedLineRange } from "@pierre/diffs"
import { ComponentProps, createEffect, createMemo, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"

type SelectionSide = "additions" | "deletions"

export type CodeProps<T = {}> = FileOptions<T> & {
  file: FileContents
  annotations?: LineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  onRendered?: () => void
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

function findElement(node: Node | null): HTMLElement | undefined {
  if (!node) return
  if (node instanceof HTMLElement) return node
  return node.parentElement ?? undefined
}

function findLineNumber(node: Node | null): number | undefined {
  const element = findElement(node)
  if (!element) return

  const line = element.closest("[data-line]")
  if (!(line instanceof HTMLElement)) return

  const value = parseInt(line.dataset.line ?? "", 10)
  if (Number.isNaN(value)) return

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

export function Code<T>(props: CodeProps<T>) {
  let container!: HTMLDivElement
  let observer: MutationObserver | undefined
  let renderToken = 0
  let selectionFrame: number | undefined
  let dragFrame: number | undefined
  let dragStart: number | undefined
  let dragEnd: number | undefined
  let dragMoved = false

  const [local, others] = splitProps(props, [
    "file",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "onRendered",
  ])

  const handleLineClick: FileOptions<T>["onLineClick"] = (info) => {
    props.onLineClick?.(info)

    if (props.enableLineSelection !== true) return
    if (info.numberColumn) return
    if (!local.selectedLines) return

    file().setSelectedLines(null)
  }

  const file = createMemo(
    () =>
      new File<T>(
        {
          ...createDefaultOptions<T>("unified"),
          ...others,
          onLineClick: props.enableLineSelection === true || props.onLineClick ? handleLineClick : undefined,
        },
        getWorkerPool("unified"),
      ),
  )

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

    const lines = (() => {
      const text = local.file.contents
      const total = text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
      return Math.max(1, total)
    })()

    const isReady = (root: ShadowRoot) => root.querySelectorAll("[data-line]").length >= lines

    const notify = () => {
      if (token !== renderToken) return

      observer?.disconnect()
      observer = undefined
      requestAnimationFrame(() => {
        if (token !== renderToken) return
        local.onRendered?.()
      })
    }

    const root = getRoot()
    if (root && isReady(root)) {
      notify()
      return
    }

    if (typeof MutationObserver === "undefined") return

    const observeRoot = (root: ShadowRoot) => {
      if (isReady(root)) {
        notify()
        return
      }

      observer?.disconnect()
      observer = new MutationObserver(() => {
        if (token !== renderToken) return
        if (!isReady(root)) return

        notify()
      })

      observer.observe(root, { childList: true, subtree: true })
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

    file().setSelectedLines(selected)
  }

  const scheduleSelectionUpdate = () => {
    if (selectionFrame !== undefined) return

    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = undefined
      updateSelection()
    })
  }

  const updateDragSelection = () => {
    if (dragStart === undefined || dragEnd === undefined) return

    const start = Math.min(dragStart, dragEnd)
    const end = Math.max(dragStart, dragEnd)

    file().setSelectedLines({ start, end })
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
    if (numberColumn) return
    if (line === undefined) return

    dragStart = line
    dragEnd = line
    dragMoved = false
  }

  const handleMouseMove = (event: MouseEvent) => {
    if (props.enableLineSelection !== true) return
    if (dragStart === undefined) return

    if ((event.buttons & 1) === 0) {
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
      return
    }

    const { line } = lineFromMouseEvent(event)
    if (line === undefined) return

    dragEnd = line
    dragMoved = true
    scheduleDragUpdate()
  }

  const handleMouseUp = () => {
    if (props.enableLineSelection !== true) return

    if (dragStart !== undefined) {
      if (dragMoved) scheduleDragUpdate()
      dragStart = undefined
      dragEnd = undefined
      dragMoved = false
    }

    scheduleSelectionUpdate()
  }

  const handleSelectionChange = () => {
    if (props.enableLineSelection !== true) return

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    scheduleSelectionUpdate()
  }

  createEffect(() => {
    const current = file()

    onCleanup(() => {
      current.cleanUp()
    })
  })

  createEffect(() => {
    observer?.disconnect()
    observer = undefined

    container.innerHTML = ""
    file().render({
      file: local.file,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })

    notifyRendered()
  })

  createEffect(() => {
    file().setSelectedLines(local.selectedLines ?? null)
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
    dragMoved = false
  })

  return (
    <div
      data-component="code"
      style={styleVariables}
      classList={{
        ...(local.classList || {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={container}
    />
  )
}
