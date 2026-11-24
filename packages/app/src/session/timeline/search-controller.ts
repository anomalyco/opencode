import type { SessionMessageInfo } from "@opencode/client/promise"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { readMarkdownText } from "@opencode/session-ui/markdown-worker"
import { scrollPort } from "@opencode/ui/scroll-port"
import { batch, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { unwrap } from "solid-js/store"
import {
  createMatchFinder,
  createTimelineSearchState,
  normalizeSearchQuery,
  sameTimelineSearchView,
  searchableSources,
  timelineSearchView,
  transitionTimelineSearch,
  type SearchablePart,
  type SearchableSource,
  type TimelineSearchEffect,
  type TimelineSearchEvent,
} from "./search-machine"
import { createSearchText } from "./search-text"

const NO_PARTS: readonly SearchablePart[] = Object.freeze([])

const NO_SOURCES: readonly SearchableSource[] = Object.freeze([])

const CLOSED_CORPUS = Object.freeze({ sessionID: undefined, parts: NO_PARTS, readings: 0 })

const HIGHLIGHT_HIT = "timeline-search-hit"

const HIGHLIGHT_ACTIVE = "timeline-search-hit-active"

const TEXT_SELECTORS = '[data-slot="text-part-body"], [data-slot="user-message-text"]'

const FOLD_TOGGLE = '[data-slot="user-message-fold-toggle"]'

// Matches the fold's mask in session-ui's message-part.css.
const FOLD_FADE = 40

// Text inside a part that Find does not read: the label of a control, such as a folded message's Read more button,
// a formula, whose glyphs are not its source, and what a closed disclosure hides.
const UNSEEN = `button, ${FOLD_TOGGLE}, math, .katex, details:not([open]) > :not(summary)`

const PENDING_MARKDOWN = '[data-component="markdown"]:not([data-markdown-ready])'

// Elements that end a line of text. A match runs across the inline elements of one block, such as bold, a link's
// label or the tokens of a code block, and never from one block into the next.
const BLOCKS = new Set(
  "p li td th h1 h2 h3 h4 h5 h6 pre blockquote summary dt dd figcaption div section details table tr ul ol".split(" "),
)

function supportsHighlights() {
  return !!globalThis.CSS?.highlights
}

function clearHighlights() {
  if (!supportsHighlights()) return
  CSS.highlights.delete(HIGHLIGHT_HIT)
  CSS.highlights.delete(HIGHLIGHT_ACTIVE)
}

function blockOf(node: Text, body: HTMLElement) {
  for (let element = node.parentElement; element && element !== body; element = element.parentElement) {
    if (BLOCKS.has(element.localName)) return element
  }

  return body
}

/**
 * The query's hits in the text the mounted parts show. `rendered` is given that text for each part whose Markdown
 * has rendered: it is what Find counts in, so the count is the number of hits the reader can see.
 */
function collectRanges(
  root: HTMLElement,
  query: string,
  activePartID: string | undefined,
  activeOccurrence: number | undefined,
  rendered?: (partID: string, lower: string) => void,
) {
  const hits: Range[] = []
  const active: Range[] = []
  const lower = query.toLowerCase()
  const parts = new Map<string, { occurrence: number; lines: string[]; pending: boolean }>()

  for (const body of root.querySelectorAll<HTMLElement>(TEXT_SELECTORS)) {
    const partID = body.closest("[data-timeline-part-id]")?.getAttribute("data-timeline-part-id") ?? undefined
    const part = partID === undefined ? undefined : (parts.get(partID) ?? { occurrence: 0, lines: [], pending: false })

    if (part && partID !== undefined) {
      parts.set(partID, part)
      part.pending ||= !!body.querySelector(PENDING_MARKDOWN)
    }

    const line = { nodes: [] as Text[], starts: [] as number[], text: "", block: undefined as Element | undefined }
    let broken = false

    // One line of a block is complete: its hits become ranges, which can run across several text nodes.
    const end = () => {
      if (line.nodes.length === 0) return
      const value = line.text.toLowerCase()
      part?.lines.push(value)
      let first = 0

      for (let at = value.indexOf(lower); at !== -1; at = value.indexOf(lower, at + lower.length)) {
        while (first + 1 < line.nodes.length && line.starts[first + 1] <= at) first += 1
        let last = first

        while (last + 1 < line.nodes.length && line.starts[last + 1] < at + lower.length) last += 1
        const range = document.createRange()
        range.setStart(line.nodes[first], at - line.starts[first])
        range.setEnd(line.nodes[last], at + lower.length - line.starts[last])

        if (part && partID === activePartID && activeOccurrence === part.occurrence) active.push(range)
        else hits.push(range)

        if (part) part.occurrence += 1
      }

      line.nodes = []
      line.starts = []
      line.text = ""
    }

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT

        if (node.localName === "br") broken = true

        return node.matches(UNSEEN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
      },
    })

    // SAFETY: the filter accepts Text nodes only.
    let node = walker.nextNode() as Text | null

    while (node) {
      const block = blockOf(node, body)

      if (broken || block !== line.block) end()
      broken = false
      line.block = block
      line.starts.push(line.text.length)
      line.nodes.push(node)
      line.text += node.nodeValue ?? ""

      // SAFETY: the filter accepts Text nodes only.
      node = walker.nextNode() as Text | null
    }

    end()
  }

  if (rendered) parts.forEach((part, partID) => !part.pending && rendered(partID, part.lines.join("\n")))

  return { hits, active }
}

// The active match alone. A seek probes on every one of its frames, so the probe reads the match's own part and not
// the text of every mounted row.
function activeRange(root: HTMLElement, query: string, partID: string, occurrence: number) {
  const part = root.querySelector<HTMLElement>(`[data-timeline-part-id="${CSS.escape(partID)}"]`)

  return part ? collectRanges(part, query, partID, occurrence).active[0] : undefined
}

function applyHighlights(
  root: HTMLElement,
  query: string,
  activePartID: string | undefined,
  activeOccurrence: number | undefined,
  rendered: (partID: string, lower: string) => void,
) {
  if (!supportsHighlights()) return
  const { hits, active } = collectRanges(root, query, activePartID, activeOccurrence, rendered)
  CSS.highlights.set(HIGHLIGHT_HIT, new Highlight(...hits))
  CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(...active))
}

type TimelineSearchInput = {
  sessionID: () => string | undefined
  scrollRef: () => HTMLDivElement | undefined
  revealMessage: (id: string, partID?: string) => void
  /** Ends the scroll `revealMessage` started. */
  stopReveal: () => void
  /** Scrolls the timeline as one of its own writes, so the scroll does not count as the reader's. */
  scrollTo: (top: number, behavior: ScrollBehavior) => void
  pauseAutoScroll: () => void
  /** Hands the timeline Find's seek, which the reader's scroll ends: it calls `stop` while a seek is `active`. */
  registerSeek: (seek: { readonly active: () => boolean; readonly stop: () => void }) => void
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
  // Not a signal: a seek advances the state on every one of its frames, and each write would have every reader of
  // Find check itself again. Readers follow the view, which those frames leave as it is.
  let state = createTimelineSearchState()
  const [view, setView] = createSignal(timelineSearchView(state), { equals: sameTimelineSearchView })
  const visible = createMemo(() => view().visible)
  const query = createMemo(() => view().query)
  const searching = createMemo(() => query() !== "")
  const activePartID = createMemo(() => view().activePartID)
  const activeOccurrence = createMemo(() => view().activeOccurrence)
  let inputEl: HTMLInputElement | undefined
  let focusFrame: number | undefined
  let seekFrame: number | undefined
  // Advances when a part is read after Find gave its text out, so that the matches are counted again.
  const [readings, setReadings] = createSignal(0)
  // Find counts in the text a part shows. The worker reads it from the Markdown a slice at a time, and a mounted
  // part is read where it is rendered.
  const text = createSearchText({ read: readMarkdownText, changed: () => setReadings((count) => count + 1) })
  const findMatches = createMatchFinder()

  const sourcesOf = (sessionID: string | undefined) =>
    sessionID ? searchableSources(input.messages(sessionID)) : NO_SOURCES

  // Reads the transcript only while a query exists, so a closed or empty Find bar costs nothing while a reply
  // streams. On its own, so that a reading, which changes a part's text and not the transcript, does not read the
  // transcript again: that takes tens of milliseconds for a session of 6,468 messages.
  const sources = createMemo(() => (visible() && searching() ? sourcesOf(input.sessionID()) : NO_SOURCES))

  // Typing reuses the lowercased parts.
  const corpus = createMemo(() => {
    if (!visible()) return CLOSED_CORPUS
    const sessionID = input.sessionID()

    if (!searching()) return { sessionID, parts: NO_PARTS, readings: untrack(readings) }

    return { sessionID, parts: text.parts(sources()), readings: readings() }
  })

  createEffect(
    on(
      corpus,
      (next, previous) => {
        if (state.status === "closed") return
        const matches = findMatches(next.parts, state.query)
        // A reading tells Find what a part shows. The transcript is the same, so a seek goes on from a hit that
        // turns out not to be there instead of ending.
        const read = previous !== undefined && next.readings !== previous.readings
        dispatch({
          type: next.sessionID !== state.sessionID ? "session.changed" : read ? "matches.read" : "matches.synced",
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

    // One count for all the parts a pass reads, not one for each.
    batch(() => applyHighlights(root, q, activePartID(), activeOccurrence(), text.rendered))
    let frame: number | undefined

    const scheduleApply = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        batch(() => applyHighlights(root, query(), activePartID(), activeOccurrence(), text.rendered))
      })
    }

    const observer = new MutationObserver(scheduleApply)
    // The two attributes change what a part shows without changing its nodes: Markdown that has rendered, and a
    // disclosure the reader opens.
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-markdown-ready", "open"],
    })
    onCleanup(() => {
      observer.disconnect()

      if (frame !== undefined) cancelAnimationFrame(frame)
      clearHighlights()
    })
  })

  input.registerSeek({
    active: () => state.status === "seeking",
    stop: () => dispatch({ type: "reader.scrolled" }),
  })
  onCleanup(() => dispatch({ type: "disposed" }))

  function open() {
    const sessionID = untrack(input.sessionID)
    dispatch({ type: "open", sessionID })

    // The worker starts on the transcript now, so that it is read by the time a query needs it. Read from the plain
    // messages: the store makes a proxy for each message it hands out for the first time, 50 ms for 6,468 of them.
    if (sessionID) text.prime(searchableSources(unwrap(untrack(() => input.messages(sessionID)))))
  }

  function dispatch(event: TimelineSearchEvent) {
    const next = transitionTimelineSearch(state, event)

    if (next.state !== state) {
      state = next.state
      setView(timelineSearchView(state))
    }

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

    if (effect.type === "reveal.stop") {
      input.stopReveal()

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
      // The reveal scrolls to the middle of the match's row and keeps at it for up to five seconds. Find goes to the
      // match itself, so that scroll would only move the view away again.
      input.stopReveal()
      input.scrollTo(effect.top, "auto")

      return
    }

    if (effect.type === "cancel-frames") cancelFocusFrame()

    // `seek.cancel` and `cancel-frames`.
    cancelSeekFrame()
  }

  // Reads the DOM only; the machine decides whether the result is still current before anything is clicked or scrolled.
  function probeSeek(effect: Extract<TimelineSearchEffect, { type: "seek.schedule" }>): TimelineSearchEvent {
    const root = input.scrollRef()

    if (!root) return { type: "seek.missing", attempt: effect.attempt, at: undefined }
    const range = activeRange(root, effect.query, effect.partID, effect.occurrence)

    if (!range) return { type: "seek.missing", attempt: effect.attempt, at: root.scrollTop }
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

    // Centred between the header and the composer region, not in the viewport that runs on under both.
    const port = scrollPort(root)
    const at = root.scrollTop
    const top = at + rect.top - port.top - (port.bottom - port.top - rect.height) / 2

    // Kept inside the scroll range, so the offset Find scrolls to is the offset the next probe finds the view at.
    return {
      type: "seek.ready",
      attempt: effect.attempt,
      top: Math.min(Math.max(0, top), root.scrollHeight - root.clientHeight),
      at,
    }
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
    if (state.status === "closed") return
    const next = normalizeSearchQuery(value)

    if (next === state.query) {
      dispatch({ type: "query.changed", value, matches: state.matches })

      return
    }

    // The corpus holds parts only once a query exists, so the first character reads the transcript directly.
    const sessionID = state.sessionID
    const parts = state.query ? untrack(corpus).parts : text.parts(untrack(() => sourcesOf(sessionID)))
    dispatch({ type: "query.changed", value, matches: findMatches(parts, next) })
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
      previousLabel: () => language.t("ui.fileSearch.previousMatch"),
      nextLabel: () => language.t("ui.fileSearch.nextMatch"),
    },
    element: {
      setInput: (element: HTMLInputElement) => (inputEl = element),
    },
  }
}

export type TimelineSearchController = ReturnType<typeof createTimelineSearchController>
