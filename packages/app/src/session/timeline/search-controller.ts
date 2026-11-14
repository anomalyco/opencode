import type { SessionMessageInfo } from "@opencode/client/promise"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import {
  createTimelineSearchState,
  extractSearchableParts,
  findMatchesInParts,
  normalizeSearchQuery,
  timelineSearchView,
  transitionTimelineSearch,
  type SearchablePart,
  type TimelineSearchEffect,
  type TimelineSearchEvent,
} from "./search-machine"

const NO_PARTS: readonly SearchablePart[] = Object.freeze([])

const CLOSED_CORPUS = Object.freeze({ sessionID: undefined, parts: NO_PARTS })

const HIGHLIGHT_HIT = "timeline-search-hit"

const HIGHLIGHT_ACTIVE = "timeline-search-hit-active"

const TEXT_SELECTORS = '[data-slot="text-part-body"], [data-slot="user-message-text"]'

const FOLD_TOGGLE = '[data-slot="user-message-fold-toggle"]'

// Matches the fold's mask in session-ui's message-part.css.
const FOLD_FADE = 40

function supportsHighlights() {
  return !!globalThis.CSS?.highlights
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

    // A folded user message's Read more button sits inside its text.
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(FOLD_TOGGLE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    })

    // SAFETY: SHOW_TEXT restricts this walker to Text nodes.
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

      // SAFETY: SHOW_TEXT restricts this walker to Text nodes.
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

type TimelineSearchInput = {
  sessionID: () => string | undefined
  scrollRef: () => HTMLDivElement | undefined
  revealMessage: (id: string, partID?: string) => void
  pauseAutoScroll: () => void
}

export function createTimelineSearchController(input: TimelineSearchInput) {
  const command = useCommand()
  const data = useData()

  const controller = createTranscriptSearch({ ...input, messages: (id) => data.session.message.list(id) })

  command.register("session.search", () => [
    {
      id: "session.search",
      title: controller.query.placeholder(),
      keybind: "mod+f",
      hidden: true,
      onSelect: controller.query.open,
    },
  ])

  return controller
}

export function createTranscriptSearch(
  input: TimelineSearchInput & { messages: (id: string) => readonly SessionMessageInfo[] },
) {
  const language = useLanguage()
  const [searchState, setSearchState] = createSignal(createTimelineSearchState())
  const view = createMemo(() => timelineSearchView(searchState()))
  const visible = createMemo(() => view().visible)
  const query = createMemo(() => view().query)
  const searching = createMemo(() => query() !== "")
  const activePartID = createMemo(() => view().activePartID)
  const activeOccurrence = createMemo(() => view().activeOccurrence)
  let inputEl: HTMLInputElement | undefined
  let focusFrame: number | undefined
  let seekFrame: number | undefined

  const searchableParts = (sessionID: string | undefined) =>
    sessionID ? extractSearchableParts(input.messages(sessionID)) : NO_PARTS

  // Reads the transcript only while a query exists, so a closed or empty Find bar costs nothing while a reply
  // streams, and typing reuses the lowercased parts.
  const corpus = createMemo(() => {
    if (!visible()) return CLOSED_CORPUS
    const sessionID = input.sessionID()

    return { sessionID, parts: searching() ? searchableParts(sessionID) : NO_PARTS }
  })

  createEffect(
    on(
      corpus,
      (next) => {
        const current = searchState()

        if (current.status === "closed") return
        const matches = findMatchesInParts(next.parts, current.query)
        dispatch({
          type: next.sessionID === current.sessionID ? "matches.synced" : "session.changed",
          sessionID: next.sessionID,
          matches,
        })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const root = input.scrollRef()
    const q = query()

    if (!root || !q) {
      clearHighlights()

      return
    }

    applyHighlights(root, q, activePartID(), activeOccurrence())
    let frame: number | undefined

    const scheduleApply = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
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

  onCleanup(() => dispatch({ type: "disposed" }))

  function open() {
    dispatch({ type: "open", sessionID: untrack(input.sessionID) })
  }

  function dispatch(event: TimelineSearchEvent) {
    const current = untrack(searchState)
    const next = transitionTimelineSearch(current, event)

    if (next.state !== current) setSearchState(next.state)
    next.effects.forEach(run)
  }

  function run(effect: TimelineSearchEffect) {
    if (effect.type === "focus-input") {
      cancelFocusFrame()
      focusFrame = requestAnimationFrame(() => {
        focusFrame = undefined

        if (!inputEl?.isConnected) return
        inputEl.focus()
        inputEl.select()
      })

      return
    }

    if (effect.type === "blur-input") {
      cancelFocusFrame()
      inputEl?.blur()

      return
    }

    if (effect.type === "reveal") {
      input.pauseAutoScroll()
      input.revealMessage(effect.revealID, effect.partID)

      return
    }

    if (effect.type === "seek.schedule") {
      cancelSeekFrame()
      seekFrame = requestAnimationFrame(() => {
        seekFrame = undefined
        dispatch(probeSeek(effect))
      })

      return
    }

    if (effect.type === "unfold") {
      input
        .scrollRef()
        ?.querySelector<HTMLElement>(`${FOLD_TOGGLE}[aria-controls="${CSS.escape(effect.foldID)}"]`)
        ?.click()

      return
    }

    if (effect.type === "scroll") {
      input.scrollRef()?.scrollTo({ top: effect.top, behavior: "auto" })

      return
    }

    if (effect.type === "cancel-frames") cancelFocusFrame()

    // `seek.cancel` and `cancel-frames`.
    cancelSeekFrame()
  }

  // Reads the DOM only; the machine decides whether the result is still current before anything is clicked or scrolled.
  function probeSeek(effect: Extract<TimelineSearchEffect, { type: "seek.schedule" }>): TimelineSearchEvent {
    const root = input.scrollRef()

    if (!root) return { type: "seek.missing", attempt: effect.attempt }
    const range = collectRanges(root, effect.query, effect.partID, effect.occurrence).active[0]

    if (!range) return { type: "seek.missing", attempt: effect.attempt }
    const rect = range.getBoundingClientRect()

    // A match in or past a folded message's fading last lines opens the message, then scrolls to it.
    const fold = effect.allowUnfold
      ? range.startContainer.parentElement?.closest<HTMLElement>('[data-slot="user-message-fold"][data-folded]')
      : undefined

    if (
      fold?.id &&
      rect.bottom > fold.getBoundingClientRect().bottom - FOLD_FADE &&
      root.querySelector(`${FOLD_TOGGLE}[aria-controls="${CSS.escape(fold.id)}"]`)
    ) {
      return { type: "seek.folded", attempt: effect.attempt, foldID: fold.id }
    }

    const rootRect = root.getBoundingClientRect()
    const sticky = root.querySelector("[data-session-title]")
    const inset = sticky instanceof HTMLElement ? sticky.offsetHeight : 0
    const top = rect.top - rootRect.top + root.scrollTop - inset - (rootRect.height - rect.height) / 2

    return { type: "seek.ready", attempt: effect.attempt, top: Math.max(0, top) }
  }

  function cancelFocusFrame() {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = undefined
  }

  function cancelSeekFrame() {
    if (seekFrame !== undefined) cancelAnimationFrame(seekFrame)
    seekFrame = undefined
  }

  function setValue(value: string) {
    const current = untrack(searchState)

    if (current.status === "closed") return
    const next = normalizeSearchQuery(value)

    if (next === current.query) {
      dispatch({ type: "query.changed", value, matches: current.matches })

      return
    }

    // The corpus holds parts only once a query exists, so the first character reads the transcript directly.
    const parts = current.query ? untrack(corpus).parts : untrack(() => searchableParts(current.sessionID))
    dispatch({ type: "query.changed", value, matches: findMatchesInParts(parts, next) })
  }

  return {
    visible,
    query: {
      value: () => view().value,
      placeholder: () => language.t("session.search.placeholder"),
      noResults: () => language.t("session.search.noResults"),
      open,
      close: () => dispatch({ type: "close" }),
      setValue,
    },
    result: {
      showCount: () => view().showCount,
      activeDisplay: () => view().activeDisplay,
      count: () => view().count,
      move: (delta: number) => dispatch({ type: "move", delta }),
    },
    element: {
      setInput: (element: HTMLInputElement) => (inputEl = element),
    },
  }
}

export type TimelineSearchController = ReturnType<typeof createTimelineSearchController>
