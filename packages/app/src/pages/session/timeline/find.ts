import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import {
  activateFindHost,
  registerFindHost,
  targetFindHost,
  type FindHost,
} from "@opencode-ai/session-ui/pierre/file-find"
import type { Part } from "@opencode-ai/sdk/v2"
import { TimelineRow } from "./timeline-row"

type GetParts = (messageID: string) => Part[]
type GetPart = (messageID: string, partID: string) => Part | undefined

// Searchable text mirrors what the row renders: user/assistant text and
// reasoning parts, plus tool call input values shown in tool triggers.
// Tool outputs stay collapsed, so their content is excluded.
export function rowSearchText(row: TimelineRow.TimelineRow, getParts: GetParts, getPart: GetPart): string {
  switch (row._tag) {
    case "UserMessage":
      return getParts(row.userMessageID)
        .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.synthetic)
        .map((part) => part.text)
        .join("\n")
    case "AssistantPart": {
      if (row.group.type !== "part") return ""
      const part = getPart(row.group.ref.messageID, row.group.ref.partID)
      if (!part) return ""
      if (part.type === "text" || part.type === "reasoning") return part.text
      if (part.type === "tool") return toolInputText(part.state)
      return ""
    }
    case "Error":
      return row.text
    default:
      return ""
  }
}

function toolInputText(state: unknown): string {
  if (!state || typeof state !== "object" || !("input" in state)) return ""
  return stringLeaves(state.input).join("\n")
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves)
  return []
}

export function matchRowKeys(
  rows: TimelineRow.TimelineRow[],
  query: string,
  getParts: GetParts,
  getPart: GetPart,
): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return rows.flatMap((row) => {
    const text = rowSearchText(row, getParts, getPart)
    if (!text.toLowerCase().includes(needle)) return []
    return [TimelineRow.key(row)]
  })
}

function supportsHighlights() {
  const g = globalThis as unknown as { CSS?: { highlights?: unknown }; Highlight?: unknown }
  return typeof g.Highlight === "function" && g.CSS?.highlights != null
}

function clearHighlights() {
  const api = (globalThis as { CSS?: { highlights?: { delete: (name: string) => void } } }).CSS?.highlights
  if (!api) return
  api.delete("opencode-find")
  api.delete("opencode-find-current")
}

function textRanges(root: HTMLElement, needle: string): Range[] {
  const ranges: Range[] = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node instanceof Text) {
      const hay = node.data.toLowerCase()
      let at = hay.indexOf(needle)
      while (at !== -1) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        ranges.push(range)
        at = hay.indexOf(needle, at + needle.length)
      }
    }
    node = walker.nextNode()
  }
  return ranges
}

export function createTimelineFind(input: {
  rows: () => TimelineRow.TimelineRow[]
  renderedKeys: () => string[]
  scrollElement: () => HTMLElement | undefined
  content: () => HTMLElement | undefined
  getParts: GetParts
  getPart: GetPart
  headerOffset: () => number
  scrollToIndex: (index: number) => void
  onNavigate?: () => void
}) {
  let inputEl: HTMLInputElement | undefined
  let frame: number | undefined
  let pendingScroll = false

  const [state, setState] = createStore({
    open: false,
    query: "",
    index: 0,
    pos: { top: 8, right: 8 },
  })

  const matches = createMemo(() => {
    if (!state.open) return []
    return matchRowKeys(input.rows(), state.query, input.getParts, input.getPart)
  })

  // Keep the active match valid while messages stream in.
  createEffect(() => {
    const total = matches().length
    if (state.index >= total) setState("index", Math.max(0, total - 1))
  })

  const position = () => {
    if (typeof window === "undefined") return
    const el = input.scrollElement()
    if (!el) return
    const rect = el.getBoundingClientRect()
    setState("pos", {
      top: Math.round(rect.top) + input.headerOffset() + 8,
      right: Math.round(window.innerWidth - rect.right) + 8,
    })
  }

  const apply = () => {
    frame = undefined
    if (!state.open) return
    const value = state.query.trim().toLowerCase()
    if (!value) {
      clearHighlights()
      return
    }
    const root = input.content()
    if (!root || !supportsHighlights()) {
      clearHighlights()
      return
    }
    const keys = new Set(matches())
    const currentKey = matches()[state.index]
    // Mid-scroll the active row can be unmounted; leave previous highlights
    // in place and retry on the next scroll/render pass.
    if (currentKey && !root.querySelector(`[data-timeline-key="${CSS.escape(currentKey)}"]`)) return
    const current: Range[] = []
    const rest: Range[] = []
    for (const el of root.querySelectorAll<HTMLElement>("[data-timeline-key]")) {
      const key = el.dataset.timelineKey
      if (!key || !keys.has(key)) continue
      const ranges = textRanges(el, value)
      if (key === currentKey) current.push(...ranges)
      else rest.push(...ranges)
    }
    const g = globalThis as unknown as {
      CSS: { highlights: { set: (name: string, value: unknown) => void; delete: (name: string) => void } }
      Highlight: new (...ranges: Range[]) => unknown
    }
    g.CSS.highlights.delete("opencode-find")
    g.CSS.highlights.delete("opencode-find-current")
    if (current.length) g.CSS.highlights.set("opencode-find-current", new g.Highlight(...current))
    if (rest.length) g.CSS.highlights.set("opencode-find", new g.Highlight(...rest))

    // The target row may only render after scrollToIndex, so consume the
    // pending precision scroll on the first apply that sees its ranges.
    if (pendingScroll && current.length) {
      pendingScroll = false
      const start = current[0].startContainer
      const el = start instanceof Element ? start : start.parentElement
      el?.scrollIntoView({ block: "center", inline: "center" })
    }
  }

  const schedule = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(apply)
  }

  // Re-highlight when the query, active match, or rendered rows change.
  createEffect(() => {
    if (!state.open) return
    state.query
    state.index
    matches()
    input.renderedKeys()
    schedule()
  })

  const navigate = () => {
    const key = matches()[state.index]
    if (!key) return
    const rowIndex = input.rows().findIndex((row) => TimelineRow.key(row) === key)
    if (rowIndex < 0) return
    pendingScroll = true
    input.onNavigate?.()
    input.scrollToIndex(rowIndex)
    schedule()
  }

  const next = (dir: 1 | -1) => {
    const total = matches().length
    if (!state.open || total <= 0) return
    setState("index", (state.index + dir + total) % total)
    navigate()
  }

  const close = () => {
    setState("open", false)
    setState("query", "")
    setState("index", 0)
    pendingScroll = false
    clearHighlights()
  }

  const focus = () => {
    activateFindHost(host)
    if (!state.open) setState("open", true)
    position()
    if (matches().length > 0) navigate()
    requestAnimationFrame(() => {
      inputEl?.focus()
      inputEl?.select()
    })
  }

  const host: FindHost = {
    element: input.scrollElement,
    isOpen: () => state.open,
    next,
    open: focus,
    close,
  }

  const unregister = registerFindHost(host)

  createEffect(() => {
    if (!state.open) return
    position()
    makeEventListener(window, "resize", position, { passive: true })
  })

  createEffect(() => {
    const el = input.scrollElement()
    if (!el) return
    makeEventListener(el, "pointerdown", () => targetFindHost(host), { passive: true, capture: true })
  })

  // Virtualized rows mount and unmount while scrolling, so highlights must be
  // rebuilt as the viewport moves.
  createEffect(() => {
    const el = input.scrollElement()
    if (!el || !state.open) return
    makeEventListener(el, "scroll", schedule, { passive: true })
  })

  onCleanup(() => {
    unregister()
    if (frame !== undefined) cancelAnimationFrame(frame)
    clearHighlights()
  })

  return {
    open: () => state.open,
    query: () => state.query,
    index: () => state.index,
    count: () => matches().length,
    pos: () => state.pos,
    focus,
    close,
    next,
    setInput: (el: HTMLInputElement) => {
      inputEl = el
    },
    setQuery: (value: string) => {
      setState("query", value)
      setState("index", 0)
      if (state.open && matches().length > 0) navigate()
      else schedule()
    },
    onInputKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== "Enter") return
      event.preventDefault()
      next(event.shiftKey ? -1 : 1)
    },
  }
}
