import { type FileContents, File, FileOptions, LineAnnotation, type SelectedLineRange } from "@pierre/diffs"
import { ComponentProps, createEffect, createMemo, createSignal, onCleanup, onMount, Show, splitProps } from "solid-js"
import { createDefaultOptions, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"
import { Icon } from "./icon"

type SelectionSide = "additions" | "deletions"

export type CodeProps<T = {}> = FileOptions<T> & {
  file: FileContents
  annotations?: LineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  onRendered?: () => void
  onLineSelectionEnd?: (selection: SelectedLineRange | null) => void
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

type FindHost = {
  element: () => HTMLElement | undefined
  open: () => void
  close: () => void
  next: (dir: 1 | -1) => void
  isOpen: () => boolean
}

const findHosts = new Set<FindHost>()
let findTarget: FindHost | undefined
let findCurrent: FindHost | undefined
let findInstalled = false

function isEditable(node: unknown): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node.closest("[data-prevent-autofocus]")) return true
  if (node.isContentEditable) return true
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(node.tagName)
}

function hostForNode(node: unknown): FindHost | undefined {
  if (!(node instanceof Node)) return
  for (const host of findHosts) {
    const el = host.element()
    if (el && el.isConnected && el.contains(node)) return host
  }
}

function installFindShortcuts() {
  if (findInstalled) return
  if (typeof window === "undefined") return
  findInstalled = true

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented) return

      const mod = event.metaKey || event.ctrlKey
      if (!mod) return

      const key = event.key.toLowerCase()

      if (key === "g") {
        const host = findCurrent
        if (!host || !host.isOpen()) return
        event.preventDefault()
        event.stopPropagation()
        host.next(event.shiftKey ? -1 : 1)
        return
      }

      if (key !== "f") return

      const current = findCurrent
      if (current && current.isOpen()) {
        event.preventDefault()
        event.stopPropagation()
        current.open()
        return
      }

      const host =
        hostForNode(document.activeElement) ?? hostForNode(event.target) ?? findTarget ?? Array.from(findHosts)[0]
      if (!host) return

      event.preventDefault()
      event.stopPropagation()
      host.open()
    },
    { capture: true },
  )
}

export function Code<T>(props: CodeProps<T>) {
  let wrapper!: HTMLDivElement
  let container!: HTMLDivElement
  let findInput: HTMLInputElement | undefined
  let findBar: HTMLDivElement | undefined
  let findOverlay!: HTMLDivElement
  let findOverlayFrame: number | undefined
  let findOverlayScroll: HTMLElement[] = []
  let findScroll: HTMLElement | undefined
  let observer: MutationObserver | undefined
  let renderToken = 0
  let selectionFrame: number | undefined
  let dragFrame: number | undefined
  let dragStart: number | undefined
  let dragEnd: number | undefined
  let dragMoved = false
  let lastSelection: SelectedLineRange | null = null
  let pendingSelectionEnd = false

  const [local, others] = splitProps(props, [
    "file",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "commentedLines",
    "onRendered",
  ])

  const [rendered, setRendered] = createSignal(0)

  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal("")
  const [findIndex, setFindIndex] = createSignal(0)
  const [findCount, setFindCount] = createSignal(0)
  let findMode: "highlights" | "overlay" = "overlay"
  let findHits: Range[] = []

  const file = createMemo(
    () =>
      new File<T>(
        {
          ...createDefaultOptions<T>("unified"),
          ...others,
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

  const supportsHighlights = () => {
    const g = globalThis as unknown as { CSS?: { highlights?: unknown }; Highlight?: unknown }
    return typeof g.Highlight === "function" && g.CSS?.highlights != null
  }

  const clearHighlightFind = () => {
    const api = (globalThis as { CSS?: { highlights?: { delete: (name: string) => void } } }).CSS?.highlights
    if (!api) return
    api.delete("opencode-find")
    api.delete("opencode-find-current")
  }

  const clearOverlayScroll = () => {
    for (const el of findOverlayScroll) el.removeEventListener("scroll", scheduleOverlay)
    findOverlayScroll = []
  }

  const clearOverlay = () => {
    if (findOverlayFrame !== undefined) {
      cancelAnimationFrame(findOverlayFrame)
      findOverlayFrame = undefined
    }
    findOverlay.innerHTML = ""
  }

  const renderOverlay = () => {
    if (findMode !== "overlay") {
      clearOverlay()
      return
    }

    clearOverlay()
    if (findHits.length === 0) return

    const base = wrapper.getBoundingClientRect()
    const current = findIndex()

    const frag = document.createDocumentFragment()
    for (let i = 0; i < findHits.length; i++) {
      const range = findHits[i]
      const active = i === current

      for (const rect of Array.from(range.getClientRects())) {
        if (!rect.width || !rect.height) continue

        const el = document.createElement("div")
        el.style.position = "absolute"
        el.style.left = `${Math.round(rect.left - base.left)}px`
        el.style.top = `${Math.round(rect.top - base.top)}px`
        el.style.width = `${Math.round(rect.width)}px`
        el.style.height = `${Math.round(rect.height)}px`
        el.style.borderRadius = "2px"
        el.style.backgroundColor = active ? "var(--surface-warning-strong)" : "var(--surface-warning-base)"
        el.style.opacity = active ? "0.55" : "0.35"
        if (active) el.style.boxShadow = "inset 0 0 0 1px var(--border-warning-base)"
        frag.appendChild(el)
      }
    }

    findOverlay.appendChild(frag)
  }

  function scheduleOverlay() {
    if (findMode !== "overlay") return
    if (!findOpen()) return
    if (findOverlayFrame !== undefined) return

    findOverlayFrame = requestAnimationFrame(() => {
      findOverlayFrame = undefined
      renderOverlay()
    })
  }

  const syncOverlayScroll = () => {
    if (findMode !== "overlay") return
    const root = getRoot()

    const next = root
      ? Array.from(root.querySelectorAll("[data-code]")).filter(
          (node): node is HTMLElement => node instanceof HTMLElement,
        )
      : []
    if (next.length === findOverlayScroll.length && next.every((el, i) => el === findOverlayScroll[i])) return

    clearOverlayScroll()
    findOverlayScroll = next
    for (const el of findOverlayScroll) el.addEventListener("scroll", scheduleOverlay, { passive: true })
  }

  const clearFind = () => {
    clearHighlightFind()
    clearOverlay()
    clearOverlayScroll()
    findHits = []
    setFindCount(0)
    setFindIndex(0)
  }

  const getScrollParent = (el: HTMLElement): HTMLElement | null => {
    let parent = el.parentElement
    while (parent) {
      const style = getComputedStyle(parent)
      if (style.overflowY === "auto" || style.overflowY === "scroll") return parent
      parent = parent.parentElement
    }
    return null
  }

  const positionFindBar = () => {
    if (!findBar || !wrapper) return
    const scrollTop = findScroll ? findScroll.scrollTop : window.scrollY
    findBar.style.position = "absolute"
    findBar.style.top = `${scrollTop + 8}px`
    findBar.style.right = "8px"
    findBar.style.left = ""
  }

  const scanFind = (root: ShadowRoot, query: string) => {
    const needle = query.toLowerCase()
    const out: Range[] = []

    const cols = Array.from(root.querySelectorAll("[data-column-content]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )

    for (const col of cols) {
      const text = col.textContent
      if (!text) continue

      const hay = text.toLowerCase()
      let idx = hay.indexOf(needle)
      if (idx === -1) continue

      const nodes: Text[] = []
      const ends: number[] = []
      const walker = document.createTreeWalker(col, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      let pos = 0

      while (node) {
        if (node instanceof Text) {
          pos += node.data.length
          nodes.push(node)
          ends.push(pos)
        }
        node = walker.nextNode()
      }

      if (nodes.length === 0) continue

      const locate = (at: number) => {
        let lo = 0
        let hi = ends.length - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (ends[mid] >= at) hi = mid
          else lo = mid + 1
        }
        const prev = lo === 0 ? 0 : ends[lo - 1]
        return { node: nodes[lo], offset: at - prev }
      }

      while (idx !== -1) {
        const start = locate(idx)
        const end = locate(idx + query.length)
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        out.push(range)
        idx = hay.indexOf(needle, idx + query.length)
      }
    }

    return out
  }

  const scrollToRange = (range: Range) => {
    const start = range.startContainer
    const el = start instanceof Element ? start : start.parentElement
    el?.scrollIntoView({ block: "center", inline: "center" })
  }

  const setHighlights = (ranges: Range[], index: number) => {
    const api = (globalThis as unknown as { CSS?: { highlights?: any }; Highlight?: any }).CSS?.highlights
    const Highlight = (globalThis as unknown as { Highlight?: any }).Highlight
    if (!api || typeof Highlight !== "function") return false

    api.delete("opencode-find")
    api.delete("opencode-find-current")

    const active = ranges[index]
    if (active) api.set("opencode-find-current", new Highlight(active))

    const rest = ranges.filter((_, i) => i !== index)
    if (rest.length > 0) api.set("opencode-find", new Highlight(...rest))
    return true
  }

  const applyFind = (opts?: { reset?: boolean; scroll?: boolean }) => {
    if (!findOpen()) return

    const query = findQuery().trim()
    if (!query) {
      clearFind()
      return
    }

    const root = getRoot()
    if (!root) return

    findMode = supportsHighlights() ? "highlights" : "overlay"

    const ranges = scanFind(root, query)
    const total = ranges.length
    const desired = opts?.reset ? 0 : findIndex()
    const index = total ? Math.min(desired, total - 1) : 0

    findHits = ranges
    setFindCount(total)
    setFindIndex(index)

    const active = ranges[index]
    if (findMode === "highlights") {
      clearOverlay()
      clearOverlayScroll()
      if (!setHighlights(ranges, index)) {
        findMode = "overlay"
        clearHighlightFind()
        syncOverlayScroll()
        scheduleOverlay()
      }
      if (opts?.scroll && active) {
        scrollToRange(active)
        positionFindBar()
      }
      return
    }

    clearHighlightFind()
    syncOverlayScroll()
    if (opts?.scroll && active) {
      scrollToRange(active)
      positionFindBar()
    }
    scheduleOverlay()
  }

  const closeFind = () => {
    setFindOpen(false)
    clearFind()
    if (findCurrent === host) findCurrent = undefined
  }

  const stepFind = (dir: 1 | -1) => {
    if (!findOpen()) return
    const total = findCount()
    if (total <= 0) return

    const index = (findIndex() + dir + total) % total
    setFindIndex(index)

    const active = findHits[index]
    if (!active) return

    if (findMode === "highlights") {
      if (!setHighlights(findHits, index)) {
        findMode = "overlay"
        applyFind({ reset: true, scroll: true })
        return
      }
      scrollToRange(active)
      positionFindBar()
      return
    }

    clearHighlightFind()
    syncOverlayScroll()
    scrollToRange(active)
    positionFindBar()
    scheduleOverlay()
  }

  const host: FindHost = {
    element: () => wrapper,
    isOpen: () => findOpen(),
    next: stepFind,
    open: () => {
      if (findCurrent && findCurrent !== host) findCurrent.close()
      findCurrent = host
      findTarget = host

      findScroll = getScrollParent(wrapper) ?? undefined
      if (!findOpen()) setFindOpen(true)
      requestAnimationFrame(() => {
        applyFind({ scroll: true })
        positionFindBar()
        findInput?.focus()
        findInput?.select()
      })
    },
    close: closeFind,
  }

  onMount(() => {
    findMode = supportsHighlights() ? "highlights" : "overlay"
    installFindShortcuts()
    findHosts.add(host)
    if (!findTarget) findTarget = host

    onCleanup(() => {
      findHosts.delete(host)
      if (findCurrent === host) {
        findCurrent = undefined
        clearHighlightFind()
      }
      if (findTarget === host) findTarget = undefined
    })
  })

  createEffect(() => {
    if (!findOpen()) return
    findScroll = getScrollParent(wrapper) ?? undefined
    const target = findScroll ?? window

    const handler = () => positionFindBar()
    target.addEventListener("scroll", handler, { passive: true })
    window.addEventListener("resize", handler, { passive: true })
    handler()

    onCleanup(() => {
      target.removeEventListener("scroll", handler)
      window.removeEventListener("resize", handler)
      findScroll = undefined
    })
  })

  const applyCommentedLines = (ranges: SelectedLineRange[]) => {
    const root = getRoot()
    if (!root) return

    const existing = Array.from(root.querySelectorAll("[data-comment-selected]"))
    for (const node of existing) {
      if (!(node instanceof HTMLElement)) continue
      node.removeAttribute("data-comment-selected")
    }

    for (const range of ranges) {
      const start = Math.max(1, Math.min(range.start, range.end))
      const end = Math.max(range.start, range.end)

      for (let line = start; line <= end; line++) {
        const nodes = Array.from(root.querySelectorAll(`[data-line="${line}"]`))
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue
          node.setAttribute("data-comment-selected", "")
        }
      }
    }
  }

  const lineCount = () => {
    const text = local.file.contents
    const total = text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
    return Math.max(1, total)
  }

  const applySelection = (range: SelectedLineRange | null) => {
    const root = getRoot()
    if (!root) return false

    const lines = lineCount()
    if (root.querySelectorAll("[data-line]").length < lines) return false

    if (!range) {
      file().setSelectedLines(null)
      return true
    }

    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)

    if (start < 1 || end > lines) {
      file().setSelectedLines(null)
      return true
    }

    if (!root.querySelector(`[data-line="${start}"]`) || !root.querySelector(`[data-line="${end}"]`)) {
      file().setSelectedLines(null)
      return true
    }

    const normalized = (() => {
      if (range.endSide != null) return { start: range.start, end: range.end }
      if (range.side !== "deletions") return range
      if (root.querySelector("[data-deletions]") != null) return range
      return { start: range.start, end: range.end }
    })()

    file().setSelectedLines(normalized)
    return true
  }

  const notifyRendered = () => {
    observer?.disconnect()
    observer = undefined
    renderToken++

    const token = renderToken

    const lines = lineCount()

    const isReady = (root: ShadowRoot) => root.querySelectorAll("[data-line]").length >= lines

    const notify = () => {
      if (token !== renderToken) return

      observer?.disconnect()
      observer = undefined
      requestAnimationFrame(() => {
        if (token !== renderToken) return
        applySelection(lastSelection)
        applyFind({ reset: true })
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

    setSelectedLines(selected)
  }

  const setSelectedLines = (range: SelectedLineRange | null) => {
    lastSelection = range
    applySelection(range)
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
    if (dragStart === undefined) return

    if (!dragMoved) {
      pendingSelectionEnd = false
      const line = dragStart
      setSelectedLines({ start: line, end: line })
      props.onLineSelectionEnd?.(lastSelection)
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
    observer?.disconnect()

    clearOverlayScroll()
    clearOverlay()
    if (findCurrent === host) {
      findCurrent = undefined
      clearHighlightFind()
    }

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
    lastSelection = null
    pendingSelectionEnd = false
  })

  return (
    <div
      data-component="code"
      style={styleVariables}
      class="relative outline-none"
      classList={{
        ...(local.classList || {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={wrapper}
      tabIndex={0}
      onPointerDown={() => {
        findTarget = host
        wrapper.focus({ preventScroll: true })
      }}
      onFocus={() => {
        findTarget = host
      }}
    >
      <Show when={findOpen()}>
        <div
          ref={findBar}
          class="z-50 flex h-8 items-center gap-2 rounded-md border border-border-base bg-background-base px-3 shadow-md"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Icon name="magnifying-glass" size="small" class="text-text-weak shrink-0" />
          <input
            ref={findInput}
            placeholder="Find"
            value={findQuery()}
            class="w-40 bg-transparent outline-none text-14-regular text-text-strong placeholder:text-text-weak"
            onInput={(e) => {
              setFindQuery(e.currentTarget.value)
              setFindIndex(0)
              applyFind({ reset: true, scroll: true })
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                closeFind()
                return
              }
              if (e.key !== "Enter") return
              e.preventDefault()
              stepFind(e.shiftKey ? -1 : 1)
            }}
          />
          <div class="shrink-0 text-12-regular text-text-weak tabular-nums text-right" style={{ width: "10ch" }}>
            {findCount() ? `${findIndex() + 1}/${findCount()}` : "0/0"}
          </div>
          <div class="flex items-center">
            <button
              type="button"
              class="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong disabled:opacity-40 disabled:pointer-events-none"
              disabled={findCount() === 0}
              aria-label="Previous match"
              onClick={() => stepFind(-1)}
            >
              <Icon name="chevron-down" size="small" class="rotate-180" />
            </button>
            <button
              type="button"
              class="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong disabled:opacity-40 disabled:pointer-events-none"
              disabled={findCount() === 0}
              aria-label="Next match"
              onClick={() => stepFind(1)}
            >
              <Icon name="chevron-down" size="small" />
            </button>
          </div>
          <button
            type="button"
            class="size-6 grid place-items-center rounded text-text-weak hover:bg-surface-base-hover hover:text-text-strong"
            aria-label="Close search"
            onClick={closeFind}
          >
            <Icon name="close-small" size="small" />
          </button>
        </div>
      </Show>
      <div ref={container} />
      <div ref={findOverlay} class="pointer-events-none absolute inset-0 z-0" />
    </div>
  )
}
