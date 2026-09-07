import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { Timeline } from "@opencode-ai/session-ui/timeline/projection"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

export type TimelineSearchMatch = {
  messageID: string
  role: "user" | "assistant"
  revealID: string
  partID: string
  occurrence: number
  text: string
}

const HIGHLIGHT_HIT = "timeline-search-hit"
const HIGHLIGHT_ACTIVE = "timeline-search-hit-active"
const TEXT_SELECTORS = '[data-slot="text-part-body"], [data-slot="user-message-text"]'

function supportsHighlights() {
  return typeof CSS !== "undefined" && typeof CSS.highlights === "object" && CSS.highlights !== null
}

function clearHighlights() {
  if (!supportsHighlights()) return
  CSS.highlights.delete(HIGHLIGHT_HIT)
  CSS.highlights.delete(HIGHLIGHT_ACTIVE)
}

function collectRanges(
  root: HTMLElement,
  query: string,
  activePartID: string | undefined,
  activeOccurrence: number | undefined,
) {
  const hits: Range[] = []
  const active: Range[] = []
  const lower = query.toLowerCase()
  const bodies = root.querySelectorAll<HTMLElement>(TEXT_SELECTORS)
  for (const body of bodies) {
    const part = body.closest("[data-timeline-part-id]")
    const partID = part?.getAttribute("data-timeline-part-id")
    const isActivePart = activePartID !== undefined && partID === activePartID
    let occurrenceInPart = 0
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
      const value = node.nodeValue ?? ""
      const lowerValue = value.toLowerCase()
      let from = 0
      let at = lowerValue.indexOf(lower, from)
      while (at !== -1) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + query.length)
        if (isActivePart && activeOccurrence === occurrenceInPart) active.push(range)
        else hits.push(range)
        occurrenceInPart += 1
        from = at + query.length
        at = lowerValue.indexOf(lower, from)
      }
      node = walker.nextNode() as Text | null
    }
  }
  return { hits, active }
}

function applyHighlights(
  root: HTMLElement,
  query: string,
  activePartID: string | undefined,
  activeOccurrence: number | undefined,
) {
  if (!supportsHighlights()) return
  const { hits, active } = collectRanges(root, query, activePartID, activeOccurrence)
  CSS.highlights.set(HIGHLIGHT_HIT, new Highlight(...hits))
  CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(...active))
}

export function createTimelineSearchController(input: {
  sessionID: () => string | undefined
  scrollRef: () => HTMLDivElement | undefined
  revealMessage: (id: string, partID?: string) => void
  pauseAutoScroll: () => void
}) {
  const command = useCommand()
  const language = useLanguage()
  const data = useData()
  const [state, setState] = createStore({ value: "", active: 0, visible: false })
  const [focusTick, setFocusTick] = createSignal(0)
  let inputEl: HTMLInputElement | undefined

  const query = createMemo(() => state.value.trim().toLowerCase())

  const matches = createMemo<TimelineSearchMatch[]>(() => {
    const value = query()
    if (!value) return []
    const sessionID = input.sessionID()
    if (!sessionID) return []
    const messages = data.session.message.list(sessionID)
    const result: TimelineSearchMatch[] = []
    let revealID = ""
    for (const message of messages) {
      if (message.type === "user" || message.type === "shell") revealID = message.id
      if (message.type !== "user" && message.type !== "assistant") continue
      const visibleParts =
        message.type === "user"
          ? [{ id: `${message.id}:text:0`, content: { type: "text" as const, text: message.text } }]
          : Timeline.contentEntries(message)
      for (const textPart of visibleParts) {
        if (textPart.content.type !== "text") continue
        const text = textPart.content.text
        if (!text) continue
        const lower = text.toLowerCase()
        let from = 0
        let occurrence = 0
        let at = lower.indexOf(value, from)
        while (at !== -1) {
          result.push({
            messageID: message.id,
            role: message.type,
            revealID,
            partID: textPart.id,
            occurrence,
            text,
          })
          occurrence += 1
          from = at + value.length
          at = lower.indexOf(value, from)
        }
      }
    }
    return result
  })

  const activeIndex = createMemo(() => {
    const list = matches()
    if (list.length === 0) return 0
    if (state.active >= list.length) return 0
    if (state.active < 0) return 0
    return state.active
  })

  const activePartID = createMemo(() => matches()[activeIndex()]?.partID)
  const activeOccurrence = createMemo(() => matches()[activeIndex()]?.occurrence)

  createEffect(() => {
    const root = input.scrollRef()
    const q = query()
    if (!root || !state.visible || !q) {
      clearHighlights()
      return
    }
    applyHighlights(root, q, activePartID(), activeOccurrence())
    let frame: number | undefined
    const scheduleApply = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        if (!state.visible) return
        applyHighlights(root, query(), activePartID(), activeOccurrence())
      })
    }
    const observer = new MutationObserver(scheduleApply)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    onCleanup(() => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      clearHighlights()
    })
  })

  createEffect(
    on(focusTick, () => {
      if (!state.visible) return
      requestAnimationFrame(() => {
        inputEl?.focus()
        inputEl?.select()
      })
    }),
  )

  command.register("session.search", () => [
    {
      id: "session.search",
      title: language.t("session.search.placeholder"),
      keybind: "mod+f",
      hidden: true,
      onSelect: () => open(),
    },
  ])
  const onOpenRequest = () => open()
  document.addEventListener("opencode:timeline-search-open", onOpenRequest)
  onCleanup(() => document.removeEventListener("opencode:timeline-search-open", onOpenRequest))

  function open() {
    setState("visible", true)
    setFocusTick((t) => t + 1)
  }

  function close() {
    setState({ value: "", active: 0, visible: false })
    inputEl?.blur()
  }

  function setValue(value: string) {
    setState("value", value)
    const list = matches()
    const match = list[0]
    if (!value.trim() || !match) {
      setState("active", 0)
      return
    }
    setState("active", 0)
    input.pauseAutoScroll()
    input.revealMessage(match.revealID, match.partID)
    scrollToMatch(match)
  }

  function scrollToMatch(match: TimelineSearchMatch) {
    let attempts = 0
    const seek = () => {
      if (!state.visible) return
      const root = input.scrollRef()
      if (!root) return
      const { active } = collectRanges(root, query(), match.partID, match.occurrence)
      if (active.length === 0) {
        if (attempts++ < 12) requestAnimationFrame(seek)
        return
      }
      const rect = active[0].getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      const sticky = root.querySelector("[data-session-title]")
      const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
      const top = rect.top - rootRect.top + root.scrollTop - inset - (rootRect.height - rect.height) / 2
      root.scrollTo({ top: Math.max(0, top), behavior: "auto" })
    }
    requestAnimationFrame(seek)
  }

  function move(delta: number) {
    const list = matches()
    if (list.length === 0) return
    const next = (activeIndex() + delta + list.length) % list.length
    setState("active", next)
    const match = list[next]
    if (!match) return
    input.pauseAutoScroll()
    input.revealMessage(match.revealID, match.partID)
    scrollToMatch(match)
  }

  return {
    visible: () => state.visible,
    query: {
      value: () => state.value,
      placeholder: () => language.t("session.search.placeholder"),
      noResults: () => language.t("session.search.noResults"),
      open,
      close,
      setValue,
    },
    result: {
      activeIndex,
      count: () => matches().length,
      move,
    },
    element: {
      setInput: (element: HTMLInputElement) => (inputEl = element),
    },
  }
}

export type TimelineSearchController = ReturnType<typeof createTimelineSearchController>
