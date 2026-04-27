import { For, createEffect, createMemo, on, Show, Index, type JSX, createSignal, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { Accordion } from "@opencode-ai/ui/accordion"
import { Button } from "@opencode-ai/ui/button"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Dialog } from "@opencode-ai/ui/dialog"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { List } from "@opencode-ai/ui/list"
import { Popover } from "@opencode-ai/ui/popover"
import { Spinner } from "@opencode-ai/ui/spinner"
import { SessionRetry } from "@opencode-ai/ui/session-retry"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { AssistantMessage, Message as MessageType, Part, TextPart, UserMessage } from "@opencode-ai/sdk/v2"
import { showToast } from "@opencode-ai/ui/toast"
import { Binary } from "@opencode-ai/core/util/binary"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { normalize } from "@opencode-ai/ui/session-diff"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSessionKey, useSessionLayout } from "@/pages/session/session-layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { itemStyle } from "@/pages/session/message-timeline-utils"
import { resolveLinkedPath } from "@/pages/session/message-link-path"
import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import { messageAgentColor } from "@/utils/agent"
import { makeTimer } from "@solid-primitives/timer"
import { Persist, persisted } from "@/utils/persist"
import { apps, editor, getOpenPlan, manager, type OpenApp, type OS } from "@/components/session/open-app"
import { active, working } from "./session-working"

type MessageComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

const emptyMessages: MessageType[] = []
const emptyParts: PartType[] = []
const emptyTools: ToolPart[] = []
const emptyAssistantMessages: AssistantMessage[] = []
const idle = { type: "idle" as const }
const estimatedTurnHeight = 680
const windowOverscan = 1600
const windowThreshold = 24

type MathMode = "turn" | "markdown"

function mathMode(): MathMode {
  if (typeof window === "undefined") return "markdown"
  const value = window.localStorage.getItem("opencode.desktop.session.math")
  return value === "turn" ? "turn" : "markdown"
}

const sameMessages = (a: MessageType[], b: MessageType[]) => {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((item, index) => item === b[index])
}

function snap(node: HTMLDivElement) {
  const max = Math.max(0, node.scrollHeight - node.clientHeight)
  return {
    top: Math.round(node.scrollTop),
    height: Math.round(node.scrollHeight),
    client: Math.round(node.clientHeight),
    max: Math.round(max),
    gap: Math.round(max - node.scrollTop),
  }
}

const turnMessages = (messages: MessageType[], id: string) => {
  const result = Binary.search(messages, id, (message) => message.id)
  const start = result.found ? result.index : messages.findIndex((message) => message.id === id)
  if (start < 0) return emptyMessages
  const message = messages[start]
  if (!message || message.role !== "user") return emptyMessages

  let end = messages.length
  for (let i = start + 1; i < messages.length; i++) {
    if (messages[i]?.role === "user") {
      end = i
      break
    }
  }

  return messages.slice(start, end)
}

type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, { _tag: "BottomSpacer" }>
type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>

function sameKeys(a: readonly string[] | undefined, b: readonly string[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((key, index) => key === b[index])
}

const timelineCacheLimit = 16
const timelineFallbackItemSize = 60
const timelineCache = new Map<string, { keys: readonly string[]; cache: VirtualizerHandle["cache"] }>()

function readTimelineCache(id: string, keys: readonly string[]) {
  const entry = timelineCache.get(id)
  if (!entry) return
  if (sameKeys(entry.keys, keys)) return entry.cache
  timelineCache.delete(id)
}

function writeTimelineCache(id: string, keys: readonly string[], handle: VirtualizerHandle | undefined) {
  if (!handle || keys.length === 0) return
  timelineCache.delete(id)
  timelineCache.set(id, { keys: keys.slice(), cache: handle.cache })
  while (timelineCache.size > timelineCacheLimit) timelineCache.delete(timelineCache.keys().next().value!)
}

function reuseTimelineRows(previous: TimelineRow.TimelineRow[] | undefined, rows: TimelineRow.TimelineRow[]) {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [TimelineRow.key(row), row] as const))
  return rows.map((row) => {
    const existing = byKey.get(TimelineRow.key(row))
    if (!existing) return row
    return TimelineRow.equals(existing, row) ? existing : row
  })
}

const taskDescription = (part: PartType, sessionID: string) => {
  if (part.type !== "tool" || part.tool !== "task") return
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
}

const pace = (width: number) => Math.round(Math.max(1200, Math.min(3200, (Math.max(width, 360) * 2000) / 900)))

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

function os(platform: ReturnType<typeof usePlatform>): OS {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

function dir(path: string) {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  if (idx < 0) return ""
  return path.slice(0, idx)
}

function absolute(root: string, path: string) {
  if (!path) return root
  if (/^(?:[A-Za-z]:[\\/]|\/|\\\\|~[\\/])/.test(path)) return path
  const sep = root.includes("\\") ? "\\" : "/"
  const base = root.replace(/[\\/]+$/, "")
  const child = path.replace(/^[\\/]+/, "").replace(/[\\/]/g, sep)
  return `${base}${sep}${child}`
}

function label(message: UserMessage, parts: Part[]) {
  const title = message.summary?.title?.trim()
  if (title) return title
  const text = parts
    .filter((part): part is TextPart => part.type === "text" && !(part as TextPart).synthetic)
    .map((part) => part.text.trim())
    .find(Boolean)
  if (!text) return
  return text.replace(/\s+/g, " ").slice(0, 120)
}

export function MessageTimeline(props: {
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean }
  live: boolean
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  shouldAnchorBottom: () => boolean
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  renderedUserMessages: UserMessage[]
  currentMessageId?: string
  onJumpToMessage: (message: UserMessage) => void
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
}) {
  let touchGesture: number | undefined

  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const dialog = useDialog()
  const layout = useLayout()
  const language = useLanguage()
  const { params, sessionKey } = useSessionKey()
  const { tabs, view } = useSessionLayout()
  const platform = usePlatform()
  const file = useFile()
  let viewport: HTMLDivElement | undefined
  let windowFrame: number | undefined
  let bottomFrame: number | undefined
  let windowAdjustVersion = 0
  const turnHeights = new Map<string, number>()

  const rendered = createMemo(() => props.renderedUserMessages.map((message) => message.id))
  const renderedIndex = createMemo(() => new Map(rendered().map((id, index) => [id, index])))
  const averageTurnHeight = () => {
    if (turnHeights.size === 0) return estimatedTurnHeight
    let total = 0
    for (const value of turnHeights.values()) total += value
    return Math.max(estimatedTurnHeight / 2, total / turnHeights.size)
  }
  const estimateTurnHeight = (id: string) => turnHeights.get(id) ?? averageTurnHeight()
  const totalHeight = createMemo(() => rendered().reduce((sum, id) => sum + estimateTurnHeight(id), 0))
  const [windowed, setWindowed] = createStore({
    start: 0,
    end: Infinity,
    top: 0,
    bottom: 0,
  })
  const sessionID = createMemo(() => params.id)
  const sessionMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const pendingMessage = createMemo(() => active(sessionMessages()))
  const [jump, setJump] = createSignal(false)
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })
  const isWorking = createMemo(() => working(sessionStatus(), sessionMessages()))
  const tint = createMemo(() => messageAgentColor(sessionMessages(), sync.data.agent))
  const [prefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const openApps = createMemo(() => apps(os(platform)))
  // Windowing is only disabled while the active reply is still growing. Static
  // sessions may stay pinned to the bottom and still use history windowing;
  // otherwise long math-heavy conversations would remount the full timeline
  // and make the whole page feel sluggish.

  // Track session switches to temporarily disable windowing
  // This prevents blank pages when switching sessions due to inaccurate height estimates
  const [sessionSwitching, setSessionSwitching] = createSignal(false)

  createEffect(
    on(sessionID, (newID, prevID) => {
      if (prevID !== undefined && newID !== prevID) {
        setSessionSwitching(true)
        // Re-enable windowing after a delay to allow messages to render and collect height data
        makeTimer(
          () => {
            setSessionSwitching(false)
          },
          500,
          setTimeout,
        )
      }
    }),
  )

  const canWindow = createMemo(() => !isWorking() && !sessionSwitching())

  const [timeoutDone, setTimeoutDone] = createSignal(true)

  const workingStatus = createMemo<"hidden" | "showing" | "hiding">((prev) => {
    if (isWorking()) return "showing"
    if (prev === "showing" || !timeoutDone()) return "hiding"
    return "hidden"
  })

  createEffect(() => {
    if (workingStatus() !== "hiding") return

    setTimeoutDone(false)
    makeTimer(() => setTimeoutDone(true), 260, setTimeout)
  })

  const captureWindowAnchor = () => {
    const root = viewport
    if (!root) return
    const box = root.getBoundingClientRect()
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
    const visible =
      nodes.find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > box.top && rect.top < box.bottom
      }) ?? nodes[0]
    if (!visible?.dataset.messageId) return
    const anchorTop = visible.getBoundingClientRect().top - box.top

    // Detect abnormal anchor position (likely DOM not ready after session switch)
    const abnormalThreshold = root.clientHeight * 10 // 10x viewport height
    if (Math.abs(anchorTop) > abnormalThreshold) {
      console.warn(
        `[captureWindowAnchor] ABNORMAL anchor position: id=${visible.dataset.messageId} top=${anchorTop.toFixed(2)} threshold=${abnormalThreshold.toFixed(2)} - DOM may not be ready, skipping anchor`,
      )
      return undefined
    }

    return {
      id: visible.dataset.messageId,
      top: anchorTop,
    }
  }

  const captureMessageAnchor = (id?: string) => {
    const root = viewport
    if (!root || !id) return
    const key = typeof CSS === "undefined" ? id : CSS.escape(id)
    const node = root.querySelector<HTMLElement>(`[data-message-id="${key}"]`)
    if (!node) return
    const box = root.getBoundingClientRect()
    return {
      id,
      top: node.getBoundingClientRect().top - box.top,
    }
  }

  const tailWindow = (ids: string[], root: HTMLDivElement) => {
    let end = ids.length
    let covered = 0
    const target = root.clientHeight + windowOverscan
    while (end > 0 && covered < target) {
      end -= 1
      covered += estimateTurnHeight(ids[end]!)
    }

    let top = 0
    for (let i = 0; i < end; i++) top += estimateTurnHeight(ids[i]!)
    return {
      start: end,
      end: ids.length,
      top,
      bottom: 0,
    }
  }

  const buildWindow = () => {
    const root = viewport
    const ids = rendered()
    if (!canWindow() || !root || ids.length <= windowThreshold) {
      return {
        start: 0,
        end: ids.length,
        top: 0,
        bottom: 0,
      }
    }

    if (props.live) {
      return tailWindow(ids, root)
    }

    const scrollTop = root.scrollTop
    const clientHeight = root.clientHeight
    const scrollHeight = root.scrollHeight
    const min = Math.max(0, scrollTop - windowOverscan)
    const max = scrollTop + clientHeight + windowOverscan
    let offset = 0
    let start = 0
    while (start < ids.length) {
      const next = offset + estimateTurnHeight(ids[start]!)
      if (next >= min) break
      offset = next
      start += 1
    }

    let end = start
    let tail = offset
    while (end < ids.length) {
      tail += estimateTurnHeight(ids[end]!)
      end += 1
      if (tail >= max) break
    }

    const clampedStart = Math.max(0, Math.min(start, ids.length - 1))
    const clampedEnd = Math.max(clampedStart + 1, Math.min(end, ids.length))

    if (start !== clampedStart || end !== clampedEnd) {
      console.warn(
        `[buildWindow] CLAMPED window bounds: original=[${start},${end}] clamped=[${clampedStart},${clampedEnd}] total=${ids.length} scrollTop=${scrollTop.toFixed(2)} estimatedHeight=${tail.toFixed(2)} actualHeight=${scrollHeight.toFixed(2)}`,
      )
    }

    return {
      start: clampedStart,
      end: clampedEnd,
      top: offset,
      bottom: Math.max(0, totalHeight() - tail),
    }
  }

  const sameWindow = (next: { start: number; end: number; top: number; bottom: number }) =>
    windowed.start === next.start &&
    windowed.end === next.end &&
    Math.abs(windowed.top - next.top) <= 1 &&
    Math.abs(windowed.bottom - next.bottom) <= 1

  const syncWindow = (next: { start: number; end: number; top: number; bottom: number }, id?: string) => {
    if (!id) return next
    const ids = rendered()
    let index = renderedIndex().get(id)

    if (index === undefined) {
      index = props.renderedUserMessages.findIndex((m) => m.id === id)
      if (index === -1) {
        console.warn(
          `[syncWindow] Anchor not found: id=${id} renderedLength=${ids.length} propsLength=${props.renderedUserMessages.length}`,
        )
        return next
      }
    }

    if (index >= next.start && index < next.end) return next

    const start = Math.min(next.start, index)
    const end = Math.max(next.end, index + 1)
    let top = 0
    for (let i = 0; i < start; i++) top += estimateTurnHeight(ids[i]!)
    let tail = top
    for (let i = start; i < end; i++) tail += estimateTurnHeight(ids[i]!)
    return {
      start,
      end,
      top,
      bottom: Math.max(0, totalHeight() - tail),
    }
  }

  const applyWindow = () => {
    const viewportAnchor = captureWindowAnchor()
    const targetId = activeMessageID() ?? viewportAnchor?.id
    const targetAnchor = captureMessageAnchor(targetId)
    const scrollAnchor = props.currentMessageId ? (targetAnchor ?? viewportAnchor) : viewportAnchor
    const next = syncWindow(buildWindow(), targetId)
    const same = sameWindow(next)
    if (same) return

    const root = viewport
    const before = root ? snap(root) : undefined
    const prev = { start: windowed.start, end: windowed.end, top: windowed.top, bottom: windowed.bottom }

    setWindowed(next)
    const adjustVersion = ++windowAdjustVersion
    if ((props.live || props.scroll.bottom) && !props.currentMessageId) {
      requestAnimationFrame(() => {
        if (adjustVersion !== windowAdjustVersion) return
        const root = viewport
        if (!root) return
        const prevTop = root.scrollTop
        root.scrollTop = root.scrollHeight
        const after = snap(root)
        const jump = Math.round(root.scrollTop - prevTop)
        if (Math.abs(jump) > 24 || after.top < prevTop - 24) {
          console.warn("[timeline] live window scroll write", {
            jump,
            before,
            after,
            prev,
            next,
            live: props.live,
            bottom: props.scroll.bottom,
            current: props.currentMessageId,
            target: targetId,
          })
        }
        props.onScheduleScrollState(root)
      })
      return
    }
    if (!scrollAnchor) return

    requestAnimationFrame(() => {
      if (adjustVersion !== windowAdjustVersion) return
      const root = viewport
      if (!root) return
      const key = typeof CSS === "undefined" ? scrollAnchor.id : CSS.escape(scrollAnchor.id)
      const node = root.querySelector<HTMLElement>(`[data-message-id="${key}"]`)
      if (!node) {
        console.warn(
          `[applyWindow] anchor node not found in DOM: id=${scrollAnchor.id} windowStart=${windowed.start} windowEnd=${windowed.end}`,
        )
        return
      }
      const box = root.getBoundingClientRect()
      const top = node.getBoundingClientRect().top - box.top
      const delta = top - scrollAnchor.top
      if (Math.abs(delta) <= 1) return
      const prevTop = root.scrollTop
      root.scrollTop += delta
      const after = snap(root)
      if (Math.abs(delta) > 24 || after.top < prevTop - 24) {
        console.warn("[timeline] anchor scroll write", {
          delta: Math.round(delta),
          before,
          after,
          prev,
          next,
          anchor: scrollAnchor,
          target: targetId,
          current: props.currentMessageId,
        })
      }
      props.onScheduleScrollState(root)
    })
  }

  const scheduleWindow = () => {
    if (windowFrame !== undefined) return
    windowFrame = requestAnimationFrame(() => {
      windowFrame = undefined
      applyWindow()
    })
  }

  const shouldWindow = () => {
    const root = viewport
    const ids = rendered()
    if (!canWindow() || !root || ids.length <= windowThreshold) return false
    if (windowed.end === Infinity) return true
    const top = root.scrollTop
    const bottom = top + root.clientHeight
    const start = Math.max(0, windowed.top + windowOverscan / 2)
    const end = totalHeight() - Math.max(0, windowed.bottom + windowOverscan / 2)
    return top < start || bottom > end
  }

  const visibleRendered = createMemo(() => {
    const ids = rendered()
    if (!canWindow() || ids.length <= windowThreshold) return ids
    return ids.slice(windowed.start, Math.min(ids.length, windowed.end))
  })

  createEffect(
    on(
      () =>
        [
          visibleRendered().at(0),
          visibleRendered().at(-1),
          visibleRendered().length,
          windowed.top,
          windowed.bottom,
          activeMessageID(),
          isWorking(),
        ] as const,
      ([first, last, size, top, bottom, activeID, busy], prev) => {
        if (!prev) return
        if (
          prev[0] === first &&
          prev[1] === last &&
          prev[2] === size &&
          prev[3] === top &&
          prev[4] === bottom &&
          prev[5] === activeID &&
          prev[6] === busy
        ) {
          return
        }
        console.debug("[timeline] rendered slice", {
          first,
          last,
          size,
          top: Math.round(top),
          bottom: Math.round(bottom),
          active: activeID,
          working: busy,
          activeVisible: !!activeID && visibleRendered().includes(activeID),
          prevFirst: prev[0],
          prevLast: prev[1],
          prevSize: prev[2],
          prevTop: Math.round(prev[3]),
          prevBottom: Math.round(prev[4]),
        })
      },
      { defer: true },
    ),
  )
  createEffect(
    on(rendered, () => {
      const ids = new Set(rendered())
      for (const id of turnHeights.keys()) {
        if (!ids.has(id)) turnHeights.delete(id)
      }
      scheduleWindow()
    }),
  )

  createEffect(() => {
    if (canWindow()) return
    windowAdjustVersion += 1
    const ids = rendered()
    setWindowed({
      start: 0,
      end: ids.length,
      top: 0,
      bottom: 0,
    })
  })

  createEffect(() => {
    if (!canWindow()) return
    scheduleWindow()
  })

  createEffect(() => {
    if (!isWorking()) return
    if (!props.live && !props.scroll.bottom) return

    const step = () => {
      bottomFrame = undefined
      const root = viewport
      if (!root) return
      if (!isWorking()) return
      if (!props.live && !props.scroll.bottom) return
      root.scrollTop = root.scrollHeight
      props.onScheduleScrollState(root)
      bottomFrame = requestAnimationFrame(step)
    }

    bottomFrame = requestAnimationFrame(step)

    onCleanup(() => {
      if (bottomFrame !== undefined) cancelAnimationFrame(bottomFrame)
      bottomFrame = undefined
    })
  })

  onCleanup(() => {
    if (windowFrame !== undefined) cancelAnimationFrame(windowFrame)
    if (bottomFrame !== undefined) cancelAnimationFrame(bottomFrame)
  })

  const activeMessageID = createMemo(() => {
    const current = props.currentMessageId
    if (current) return current

    const pending = pendingMessage()
    const parentID = pending?.parentID

    // Case 1: pending message is an assistant message with a parent user message
    if (parentID) {
      const messages = sessionMessages()
      const result = Binary.search(messages, parentID, (message) => message.id)
      const message = result.found ? messages[result.index] : messages.find((item) => item.id === parentID)
      if (message && message.role === "user") return message.id
    }

    // Case 2: pending message exists but has no parentID (likely a user message when jumping)
    // User messages don't have parentID, so if pending exists but parentID is undefined, treat it as the target
    if (pending && !parentID) {
      return pending.id
    }

    // Case 3: session is working (streaming)
    const status = sessionStatus()
    if (status.type !== "idle") {
      const messages = sessionMessages()
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return messages[i].id
      }
    }

    return undefined
  })

  createEffect(
    on(activeMessageID, (id, prev) => {
      if (id === prev) return
      console.debug("[timeline] active message", {
        prev,
        next: id,
        rendered: props.renderedUserMessages.length,
        live: props.live,
        bottom: props.scroll.bottom,
      })
      windowAdjustVersion += 1
      scheduleWindow()
    }),
  )

  /**
   * Virtualization synchronization anchor.
   *
   * This memo creates a reactive bridge between props.renderedUserMessages
   * and activeMessageID() to prevent a race condition in the virtualization
   * logic. When both values update simultaneously (e.g., during scrolling
   * with new messages arriving), this memo ensures SolidJS coordinates the
   * updates, preventing the virtualization window from being calculated with
   * inconsistent data.
   *
   * Technical details:
   * - Without this memo, rendered() and activeMessageID() update independently
   * - This can cause syncWindow() to look up an activeMessageID that's not
   *   yet in renderedIndex(), returning an incorrect window and causing blanks
   * - By depending on both values, this memo forces them to update in sync
   *
   * DO NOT REMOVE: Critical for scroll stability in long conversations.
   * This is intentionally separate from UI concerns (currentMessage).
   */
  const _virtualizationSync = createMemo(() => {
    const id = activeMessageID()
    const messages = props.renderedUserMessages
    return messages.find((item) => item.id === id)
  })

  createEffect(
    on(
      () => [canWindow(), windowed.start, windowed.end, props.renderedUserMessages.length] as const,
      ([can, start, end, size], prev) => {
        if (prev && prev[0] === can && prev[1] === start && prev[2] === end && prev[3] === size) return
        if (!prev) return
        console.debug("[timeline] window state", {
          can,
          start,
          end,
          size,
          prevCan: prev[0],
          prevStart: prev[1],
          prevEnd: prev[2],
          prevSize: prev[3],
        })
      },
      { defer: true },
    ),
  )

  // UI-specific memo: reuses the sync computation for the message list
  const currentMessage = _virtualizationSync
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()))
  const shareUrl = createMemo(() => info()?.share?.url)
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const parentID = createMemo(() => info()?.parentID)
  const parent = createMemo(() => {
    const id = parentID()
    if (!id) return
    return sync.session.get(id)
  })
  const parentMessages = createMemo(() => {
    const id = parentID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const parentTitle = createMemo(() => sessionTitle(parent()?.title) ?? language.t("command.session.new"))
  const getMsgParts = (msgId: string) => sync.data.part[msgId] ?? emptyParts
  const childTaskDescription = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return parentMessages()
      .flatMap((message) => getMsgParts(message.id))
      .map((part) => taskDescription(part, id))
      .findLast((value): value is string => !!value)
  })
  const childTitle = createMemo(() => {
    if (!parentID()) return titleLabel() ?? ""
    if (childTaskDescription()) return childTaskDescription()
    const value = titleLabel()?.replace(/\s+\(@[^)]+ subagent\)$/, "")
    if (value) return value
    return language.t("command.session.new")
  })
  const showHeader = createMemo(() => !!(titleValue() || parentID()))
  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  let titleRef: HTMLInputElement | undefined

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })
  const [bar, setBar] = createStore({
    ms: pace(640),
  })

  let more: HTMLButtonElement | undefined
  let head: HTMLDivElement | undefined
  let listRoot: HTMLDivElement | undefined
  let listFrame: number | undefined
  let contentFrame: number | undefined
  let bottomAnchorFrame: number | undefined
  let bottomAnchorFrames = 0
  let measuredBottomAnchored = true
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>()

  const updateTitleMetrics = () => {
    if (!head || head.clientWidth <= 0) return
    setBar("ms", pace(head.clientWidth))
  }

  createResizeObserver(() => head, updateTitleMetrics)

  const isMeasuredBottom = (root: HTMLDivElement) => root.scrollHeight - root.clientHeight - root.scrollTop <= 4

  function anchorMeasuredBottom() {
    if (!listRoot) return false
    if (!measuredBottomAnchored) return false
    listRoot.scrollTop = listRoot.scrollHeight
    return true
  }

  function scheduleMeasuredBottomAnchor() {
    // Workaround for virtua issue #301: virtua does not expose a synchronous item-resize hook for
    // "stay at bottom if already at bottom". Tool rows can briefly outgrow the measured virtual
    // height, so keep the scroll container bottom-locked for a few frames while measurement settles.
    bottomAnchorFrames = 90
    if (bottomAnchorFrame !== undefined) return

    const tick = () => {
      bottomAnchorFrame = undefined
      if (!anchorMeasuredBottom()) {
        bottomAnchorFrames = 0
        return
      }

      bottomAnchorFrames = working() ? 12 : bottomAnchorFrames - 1
      if (bottomAnchorFrames <= 0) return
      bottomAnchorFrame = requestAnimationFrame(tick)
    }

    bottomAnchorFrame = requestAnimationFrame(tick)
  }

  const bindContentRoot = (root: HTMLDivElement) => {
    const child = root.firstElementChild
    props.setContentRef(child instanceof HTMLDivElement ? child : root)
  }

  const scheduleContentRoot = (root: HTMLDivElement) => {
    if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
    contentFrame = requestAnimationFrame(() => {
      contentFrame = undefined
      if (listRoot !== root) return
      bindContentRoot(root)
    })
  }

  const connectListRoot = (root: HTMLDivElement) => {
    if (listRoot !== root) return
    if (!root.isConnected || !root.ownerDocument.defaultView) {
      listFrame = requestAnimationFrame(() => {
        listFrame = undefined
        connectListRoot(root)
      })
      return
    }

    props.setScrollRef(root)
    measuredBottomAnchored = isMeasuredBottom(root)
    setScrollRoot(root)
    scheduleContentRoot(root)
  }

  const bindListRoot = (root: HTMLDivElement) => {
    if (root === listRoot) return

    if (listFrame !== undefined) cancelAnimationFrame(listFrame)
    if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
    listRoot = root
    setScrollRoot(undefined)
    connectListRoot(root)
  }

  const handleListWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    const root = event.currentTarget
    const delta = normalizeWheelDelta({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      rootHeight: root.clientHeight,
    })
    if (!delta) return
    markBoundaryGesture({ root, target: event.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
  }

  const handleListTouchStart = (event: TouchEvent) => {
    touchGesture = event.touches[0]?.clientY
  }

  const handleListTouchMove = (event: TouchEvent & { currentTarget: HTMLDivElement }) => {
    const next = event.touches[0]?.clientY
    const prev = touchGesture
    touchGesture = next
    if (next === undefined || prev === undefined) return

    const delta = prev - next
    if (!delta) return

    markBoundaryGesture({
      root: event.currentTarget,
      target: event.target,
      delta,
      onMarkScrollGesture: props.onMarkScrollGesture,
    })
  }

  const handleListTouchEnd = () => {
    touchGesture = undefined
  }

  const handleListPointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.target !== event.currentTarget) return
    props.onMarkScrollGesture(event.currentTarget)
  }

  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    measuredBottomAnchored = isMeasuredBottom(event.currentTarget)
    props.onScheduleScrollState(event.currentTarget)
    props.onHistoryScroll()
    if (!props.hasScrollGesture()) return
    props.onUserScroll()
    props.onAutoScrollHandleScroll()
    props.onMarkScrollGesture(event.currentTarget)
  }

  onCleanup(() => {
    if (listFrame !== undefined) cancelAnimationFrame(listFrame)
    if (contentFrame !== undefined) cancelAnimationFrame(contentFrame)
    if (bottomAnchorFrame !== undefined) cancelAnimationFrame(bottomAnchorFrame)
    setScrollRoot(undefined)
    props.setScrollRef(undefined)
  })

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const openFile = (path: string, line?: number) => {
    const next = file.normalize(path)
    if (!next) return

    const resolve = async () => {
      const base = getFilename(next)
      if (!base) return next

      // Keep fallback search scoped to the active project. This only resolves
      // ambiguous task-relative links to a real file already discoverable in
      // the current project tree.
      return resolveLinkedPath(next, await file.searchFiles(base))
    }

    void resolve().then((target) => {
      const tab = file.tab(target)
      if (!view().reviewPanel.opened()) view().reviewPanel.open()
      layout.fileTree.setTab("all")
      if (line) file.setSelectedLines(target, { start: line, end: line })
      void tabs().open(tab)
      tabs().setActive(tab)
      requestAnimationFrame(() => {
        void file.load(target)
      })
    })
  }

  const openExternal = (path: string) => {
    if (platform.platform !== "desktop" || !platform.openPath) return
    const next = file.normalize(path)
    if (!next) return

    const resolve = async () => {
      const base = getFilename(next)
      if (!base) return next
      return resolveLinkedPath(next, await file.searchFiles(base))
    }

    void resolve().then((target) => {
      const app = prefs.app
      const plan = getOpenPlan(app, [{ id: "finder" as const }, ...openApps()], !!platform.openInEditor)
      const full = absolute(sdk.directory, target)
      const value = editor(app) ? full : manager(app) ? dir(full) || full : dir(full) || full
      const task =
        plan.kind === "editor" && platform.openInEditor
          ? platform.openInEditor(plan.editor, value)
          : platform.openPath?.(value, plan.kind === "path" ? plan.app : undefined)
      void Promise.resolve(task).catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
    })
  }

  const onLink = (event: MouseEvent) => {
    const target = event.target
    const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : undefined
    if (!(node instanceof Element)) return
    const link = node.closest("a[data-file-link]")
    if (!(link instanceof HTMLAnchorElement)) return
    const path = link.dataset.path
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    const line = link.dataset.line ? Number(link.dataset.line) : undefined
    if (event.metaKey || event.ctrlKey || link.dataset.openExternal === "true") {
      delete link.dataset.openExternal
      openExternal(path)
      return
    }
    openFile(path, line)
  }

  const onLinkDown = (event: MouseEvent) => {
    const target = event.target
    const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : undefined
    if (!(node instanceof Element)) return
    const link = node.closest("a[data-file-link]")
    if (!(link instanceof HTMLAnchorElement)) return
    if (!(event.metaKey || event.ctrlKey)) return
    link.dataset.openExternal = "true"
  }

  const shareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.share({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to share session", err)
    },
  }))

  const unshareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.unshare({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to unshare session", err)
    },
  }))

  const titleMutation = useMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      sdk.client.session.update({ sessionID: input.id, title: input.title }),
    onSuccess: (_, input) => {
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === input.id)
          if (index !== -1) draft.session[index].title = input.title
        }),
      )
      setTitle("editing", false)
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err),
      })
    },
  }))

  const shareSession = () => {
    const id = sessionID()
    if (!id || shareMutation.isPending) return
    if (!shareEnabled()) return
    shareMutation.mutate(id)
  }

  const unshareSession = () => {
    const id = sessionID()
    if (!id || unshareMutation.isPending) return
    if (!shareEnabled()) return
    unshareMutation.mutate(id)
  }

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
        }),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description) return
        if (sync.data.message[id] !== undefined) return
        void sync.session.sync(id)
      },
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (titleMutation.isPending) return
    setTitle("editing", false)
  }

  const saveTitleEditor = () => {
    const id = sessionID()
    if (!id) return
    if (titleMutation.isPending) return

    const next = title.draft.trim()
    if (!next || next === (titleLabel() ?? "")) {
      setTitle("editing", false)
      return
    }

    titleMutation.mutate({ id, title: next })
  }

  const navigateAfterSessionRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    if (parentID) {
      navigate(`/${params.dir}/session/${parentID}`)
      return
    }
    if (nextSessionID) {
      navigate(`/${params.dir}/session/${nextSessionID}`)
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const archiveSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.session
      .update({ sessionID, time: { archived: Date.now() } })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.session
      .delete({ sessionID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sessionID])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [sessionID]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    navigate(`/${params.dir}/session/${id}`)
  }

  const jumpTo = (message: UserMessage) => {
    setJump(false)
    props.onJumpToMessage(message)
  }

  function DialogDeleteSession(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(sync.session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const handleDelete = async () => {
      await deleteSession(props.sessionID)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none transition-all duration-200 ease-out"
          classList={{
            "opacity-100 translate-y-0 scale-100": props.scroll.overflow && !props.scroll.bottom,
            "opacity-0 translate-y-2 scale-95 pointer-events-none": !props.scroll.overflow || props.scroll.bottom,
          }}
        >
          <button
            class="pointer-events-auto size-8 flex items-center justify-center rounded-full bg-background-base border border-border-base shadow-sm text-text-base hover:bg-background-stronger transition-colors"
            onClick={props.onResumeScroll}
          >
            <Icon name="arrow-down-to-line" />
          </button>
        </div>
        <ScrollView
          viewportRef={(el) => {
            viewport = el
            props.setScrollRef(el)
            scheduleWindow()
          }}
          onWheel={(e) => {
            const root = e.currentTarget
            const delta = normalizeWheelDelta({
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              rootHeight: root.clientHeight,
            })
            if (!delta) return
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchStart={(e) => {
            touchGesture = e.touches[0]?.clientY
          }}
          onTouchMove={(e) => {
            const next = e.touches[0]?.clientY
            const prev = touchGesture
            touchGesture = next
            if (next === undefined || prev === undefined) return

  const turnDurationMs = (userMessageID: string) => {
    const message = messageByID().get(userMessageID)
    if (!message || message.role !== "user") return
    const end = (assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages).reduce<number | undefined>(
      (max, item) => {
        const completed = item.time.completed
        if (typeof completed !== "number") return max
        if (max === undefined) return completed
        return Math.max(max, completed)
      },
      undefined,
    )
    if (typeof end !== "number") return
    if (end < message.time.created) return
    return end - message.time.created
  }

  const assistantCopyPartID = (userMessageID: string) => {
    if (workingTurn(userMessageID)) return null
    const messages = assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = getMsgParts(message.id)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }
  }

  const getMsgPart = (messageID: string, partID: string) => getMsgParts(messageID).find((part) => part.id === partID)

  const renderAssistantPartGroup = (row: TimelineRowMap["AssistantPart"]) => {
    if (row.group.type === "context") {
      const parts = createMemo(() => {
        const group = row.group
        if (group.type !== "context") return emptyTools
        return group.refs
          .map((ref) => getMsgPart(ref.messageID, ref.partID))
          .filter((part): part is ToolPart => part?.type === "tool")
      })

      return <ContextToolGroup parts={parts()} busy={workingTurn(row.userMessageID) && row.lastAssistantPart} />
    }

    const message = createMemo(() => {
      const group = row.group
      if (group.type !== "part") return
      return messageByID().get(group.ref.messageID)
    })
    const part = createMemo(() => {
      const group = row.group
      if (group.type !== "part") return
      return getMsgPart(group.ref.messageID, group.ref.partID)
    })

    return (
      <Show when={message()}>
        {(message) => (
          <Show when={part()}>
            {(part) => (
              <MessagePart
                part={part()}
                message={message()}
                showAssistantCopyPartID={assistantCopyPartID(row.userMessageID)}
                turnDurationMs={turnDurationMs(row.userMessageID)}
                defaultOpen={partDefaultOpen(
                  part(),
                  settings.general.shellToolPartsExpanded(),
                  settings.general.editToolPartsExpanded(),
                )}
                deferToolContent={false}
              />
            )}
          </Show>
        )}
      </Show>
    )
  }

  function TimelineRowFrame(input: { row: FramedTimelineRow; children: JSX.Element }) {
    const anchor = () => {
      const row = input.row
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousUserMessage = () => {
      const row = input.row
      return (row._tag === "CommentStrip" || row._tag === "UserMessage") && row.previousUserMessage
    }
    const previousAssistantPart = () => {
      const row = input.row
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        id={anchor() ? props.anchor(input.row.userMessageID) : undefined}
        data-message-id={input.row.userMessageID}
        data-timeline-row={input.row._tag}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": props.centered,
          "md:mx-auto": props.centered,
          "pt-6": previousUserMessage(),
          "pt-3": previousAssistantPart(),
        }}
      >
        <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
          {input.children}
        </div>
      </div>
    )
  }

  const renderTimelineRow = (row: TimelineRow.TimelineRow) => {
    switch (row._tag) {
      case "CommentStrip": {
        const comments = createMemo(() =>
          getMsgParts(row.userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? []),
        )
        return (
          <TimelineRowFrame row={row}>
            <div class="w-full px-4 md:px-5 pb-2">
              <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
                <div class="flex w-max min-w-full justify-end gap-2">
                  <Index each={comments()}>
                    {(comment) => (
                      <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                        <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-text-weak">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                          {comment().comment}
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "UserMessage": {
        const message = createMemo(() => {
          const m = messageByID().get(row.userMessageID)
          if (m?.role === "user") return m
        })
        return (
          <TimelineRowFrame row={row}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <Message message={message()} parts={getMsgParts(row.userMessageID)} actions={props.actions} />
                  </div>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "TurnDivider": {
        return (
          <TimelineRowFrame row={row}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-compaction">
                <MessageDivider
                  label={language.t(
                    row.label === "compaction" ? "ui.messagePart.compaction" : "ui.message.interrupted",
                  )}
                />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        return (
          <TimelineRowFrame row={row}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-assistant-content" aria-hidden={workingTurn(row.userMessageID)}>
                {renderAssistantPartGroup(row)}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Thinking": {
        return (
          <TimelineRowFrame row={row}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineThinkingRow
                reasoningHeading={row.reasoningHeading}
                showReasoningSummaries={settings.general.showReasoningSummaries()}
              />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Retry": {
        return (
          <TimelineRowFrame row={row}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <SessionRetry status={sessionStatus()} show={activeMessageID() === row.userMessageID} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "DiffSummary": {
        return (
          <TimelineRowFrame row={row}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineDiffSummaryRow diffs={row.diffs} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        return (
          <TimelineRowFrame row={row}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <Card variant="error" class="error-card">
                {row.text}
              </Card>
            </div>
          </TimelineRowFrame>
        )
      }
      case "BottomSpacer":
        return <div data-timeline-row="bottom-spacer" aria-hidden="true" class="h-16" />
    }
  }

            const root = e.currentTarget
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchEnd={() => {
            touchGesture = undefined
          }}
          onTouchCancel={() => {
            touchGesture = undefined
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onScroll={(e) => {
            const root = e.currentTarget
            const shouldWin = shouldWindow()
            props.onScheduleScrollState(e.currentTarget)
            const gesture = props.hasScrollGesture()
            // Programmatic scroll corrections also emit scroll events. Only let
            // real user gestures drive the auto-scroll state machine, otherwise
            // streaming or anchor correction gets misclassified as manual exit
            // from bottom follow mode.
            if (gesture) props.onAutoScrollHandleScroll()
            if (shouldWin) scheduleWindow()
            if (!gesture) return
            props.onUserScroll()
            props.onMarkScrollGesture(e.currentTarget)
            if (props.isDesktop) props.onScrollSpyScroll()
          }}
          onClick={props.onAutoScrollInteraction}
          class="relative min-w-0 w-full h-full"
          style={{
            "--session-title-height": showHeader() ? "40px" : "0px",
            "--sticky-accordion-top": showHeader() ? "48px" : "0px",
          }}
        >
          <div
            ref={(el) => {
              props.setContentRef(el)
            }}
            class="min-w-0 w-full"
          >
            <Show when={showHeader()}>
              <div
                data-session-title
                classList={{
                  "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
                  "w-full": true,
                  "pb-4": true,
                  "pl-2 pr-3 md:pl-4 md:pr-3": true,
                }}
                style={itemStyle(props.centered)}
              >
                <div class="h-12 w-full flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
                    <Show when={parentID()}>
                      <IconButton
                        tabIndex={-1}
                        icon="arrow-left"
                        variant="ghost"
                        onClick={navigateParent}
                        aria-label={language.t("common.goBack")}
                      />
                    </Show>
                    <div class="flex items-center min-w-0 grow-1">
                      <div
                        class="shrink-0 flex items-center justify-center overflow-hidden transition-[width,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{
                          width: isWorking() ? "16px" : "0px",
                          "margin-right": isWorking() ? "8px" : "0px",
                        }}
                        aria-hidden="true"
                      >
                        <Show when={workingStatus() !== "hidden"}>
                          <div
                            class="transition-opacity duration-200 ease-out"
                            classList={{ "opacity-0": workingStatus() === "hiding" }}
                          >
                            <Spinner class="size-4" style={{ color: tint() ?? "var(--icon-interactive-base)" }} />
                          </div>
                        </Show>
                      </div>
                      <Show when={titleValue() || title.editing}>
                        <Show
                          when={title.editing}
                          fallback={
                            <h1
                              class="text-14-medium text-text-strong truncate grow-1 min-w-0"
                              onDblClick={openTitleEditor}
                            >
                              {titleValue()}
                            </h1>
                          }
                        >
                          <InlineInput
                            ref={(el) => {
                              titleRef = el
                            }}
                            value={title.draft}
                            disabled={titleMutation.isPending}
                            class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px]"
                            style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                            onInput={(event) => setTitle("draft", event.currentTarget.value)}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === "Enter") {
                                event.preventDefault()
                                void saveTitleEditor()
                                return
                              }
                              if (event.key === "Escape") {
                                event.preventDefault()
                                closeTitleEditor()
                              }
                            }}
                            onBlur={closeTitleEditor}
                          />
                        </Show>
                      </Show>
                    </div>
                  </div>
                  <Show when={sessionID()}>
                    {(id) => (
                      <div class="shrink-0 flex items-center gap-2">
                        <SessionContextUsage placement="bottom" />
                        <Show when={props.renderedUserMessages.length > 0}>
                          <Popover
                            open={jump()}
                            onOpenChange={setJump}
                            placement="bottom-end"
                            trigger={
                              <Tooltip placement="bottom" value={language.t("command.message.next.description")}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  class="size-6"
                                  aria-label={language.t("command.message.next.description")}
                                >
                                  <Icon name="bullet-list" size="small" />
                                </Button>
                              </Tooltip>
                            }
                            class="w-[320px] max-w-[min(320px,calc(100vw-24px))] p-2"
                          >
                            <List
                              class="p-0"
                              items={props.renderedUserMessages}
                              key={(message) => message.id}
                              current={currentMessage()}
                              onSelect={(message) => message && jumpTo(message)}
                            >
                              {(message) => (
                                <>
                                  <DiffChanges changes={message.summary?.diffs ?? []} variant="bars" class="mr-3" />
                                  <div data-slot="list-item-label" class="truncate text-left">
                                    {label(message, sync.data.part[message.id] ?? [])}
                                  </div>
                                </>
                              )}
                            </List>
                          </Popover>
                        </Show>
                        <DropdownMenu
                          gutter={4}
                          placement="bottom-end"
                          open={title.menuOpen}
                          onOpenChange={(open) => {
                            setTitle("menuOpen", open)
                            if (open) return
                          }}
                        >
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="dot-grid"
                            variant="ghost"
                            class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                            classList={{
                              "bg-surface-base-active": share.open || title.pendingShare,
                            }}
                            aria-label={language.t("common.moreOptions")}
                            aria-expanded={title.menuOpen || share.open || title.pendingShare}
                            ref={(el: HTMLButtonElement) => {
                              more = el
                            }}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              style={{ "min-width": "104px" }}
                              onCloseAutoFocus={(event) => {
                                if (title.pendingRename) {
                                  event.preventDefault()
                                  setTitle("pendingRename", false)
                                  openTitleEditor()
                                  return
                                }
                                if (title.pendingShare) {
                                  event.preventDefault()
                                  requestAnimationFrame(() => {
                                    setShare({ open: true, dismiss: null })
                                    setTitle("pendingShare", false)
                                  })
                                }
                              }}
                            >
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setTitle("pendingRename", true)
                                  setTitle("menuOpen", false)
                                }}
                              >
                                <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                              <Show when={shareEnabled()}>
                                <DropdownMenu.Item
                                  onSelect={() => {
                                    setTitle({ pendingShare: true, menuOpen: false })
                                  }}
                                >
                                  <DropdownMenu.ItemLabel>
                                    {language.t("session.share.action.share")}
                                  </DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                              </Show>
                              <DropdownMenu.Item onSelect={() => void archiveSession(id())}>
                                <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id()} />)}
                              >
                                <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>

                        <KobaltePopover
                          open={share.open}
                          anchorRef={() => more}
                          placement="bottom-end"
                          gutter={4}
                          modal={false}
                          onOpenChange={(open) => {
                            if (open) setShare("dismiss", null)
                            setShare("open", open)
                          }}
                        >
                          <KobaltePopover.Portal>
                            <KobaltePopover.Content
                              data-component="popover-content"
                              style={{ "min-width": "320px" }}
                              onEscapeKeyDown={(event) => {
                                setShare({ dismiss: "escape", open: false })
                                event.preventDefault()
                                event.stopPropagation()
                              }}
                              onPointerDownOutside={() => {
                                setShare({ dismiss: "outside", open: false })
                              }}
                              onFocusOutside={() => {
                                setShare({ dismiss: "outside", open: false })
                              }}
                              onCloseAutoFocus={(event) => {
                                if (share.dismiss === "outside") event.preventDefault()
                                setShare("dismiss", null)
                              }}
                            >
                              <div class="flex flex-col p-3">
                                <div class="flex flex-col gap-1">
                                  <div class="text-13-medium text-text-strong">
                                    {language.t("session.share.popover.title")}
                                  </div>
                                  <div class="text-12-regular text-text-weak">
                                    {shareUrl()
                                      ? language.t("session.share.popover.description.shared")
                                      : language.t("session.share.popover.description.unshared")}
                                  </div>
                                </div>
                                <div class="mt-3 flex flex-col gap-2">
                                  <Show
                                    when={shareUrl()}
                                    fallback={
                                      <Button
                                        size="large"
                                        variant="primary"
                                        class="w-full"
                                        onClick={shareSession}
                                        disabled={shareMutation.isPending}
                                      >
                                        {shareMutation.isPending
                                          ? language.t("session.share.action.publishing")
                                          : language.t("session.share.action.publish")}
                                      </Button>
                                    }
                                  >
                                    <div class="flex flex-col gap-2">
                                      <TextField
                                        value={shareUrl() ?? ""}
                                        readOnly
                                        copyable
                                        copyKind="link"
                                        tabIndex={-1}
                                        class="w-full"
                                      />
                                      <div class="grid grid-cols-2 gap-2">
                                        <Button
                                          size="large"
                                          variant="secondary"
                                          class="w-full shadow-none border border-border-weak-base"
                                          onClick={unshareSession}
                                          disabled={unshareMutation.isPending}
                                        >
                                          {unshareMutation.isPending
                                            ? language.t("session.share.action.unpublishing")
                                            : language.t("session.share.action.unpublish")}
                                        </Button>
                                        <Button
                                          size="large"
                                          variant="primary"
                                          class="w-full"
                                          onClick={viewShare}
                                          disabled={unshareMutation.isPending}
                                        >
                                          {language.t("session.share.action.view")}
                                        </Button>
                                      </div>
                                    </div>
                                  </Show>
                                </div>
                              </div>
                            </KobaltePopover.Content>
                          </KobaltePopover.Portal>
                        </KobaltePopover>
                      </div>
                    )}
                  </Show>
                </div>
              </div>
              <Show when={sessionID()} keyed>
                {(id) => (
                  <div class="shrink-0 flex items-center gap-3">
                    <SessionContextUsage placement="bottom" />
                    <Show when={!parentID()}>
                      <DropdownMenu
                        gutter={4}
                        placement="bottom-end"
                        open={title.menuOpen}
                        onOpenChange={(open) => {
                          setTitle("menuOpen", open)
                          if (open) return
                        }}
                      >
                        <DropdownMenu.Trigger
                          as={IconButton}
                          icon="dot-grid"
                          variant="ghost"
                          class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                          classList={{
                            "bg-surface-base-active": share.open || title.pendingShare,
                          }}
                          aria-label={language.t("common.moreOptions")}
                          aria-expanded={title.menuOpen || share.open || title.pendingShare}
                          ref={(el: HTMLButtonElement) => {
                            more = el
                          }}
                        />
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            style={{ "min-width": "104px" }}
                            onCloseAutoFocus={(event) => {
                              if (title.pendingRename) {
                                event.preventDefault()
                                setTitle("pendingRename", false)
                                openTitleEditor()
                                return
                              }
                              if (title.pendingShare) {
                                event.preventDefault()
                                requestAnimationFrame(() => {
                                  setShare({ open: true, dismiss: null })
                                  setTitle("pendingShare", false)
                                })
                              }
                            }}
                          >
                            <DropdownMenu.Item
                              onSelect={() => {
                                setTitle("pendingRename", true)
                                setTitle("menuOpen", false)
                              }}
                            >
                              <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <Show when={shareEnabled()}>
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setTitle({ pendingShare: true, menuOpen: false })
                                }}
                              >
                                <DropdownMenu.ItemLabel>
                                  {language.t("session.share.action.share")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </Show>
                            <DropdownMenu.Item onSelect={() => void archiveSession(id)}>
                              <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item
                              onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} />)}
                            >
                              <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>

            <div
              role="log"
              class="items-start justify-start pb-16 transition-[margin]"
              classList={{
                "w-full": true,
                "flex flex-col gap-12": true,
                "mt-0.5": props.centered,
                "mt-0": !props.centered,
              }}
              style={itemStyle(props.centered)}
            >
              <Show when={props.historyMore}>
                <div class="w-full flex justify-center">
                  <Button
                    variant="ghost"
                    size="large"
                    class="text-12-medium opacity-50"
                    disabled={props.historyLoading}
                    onClick={props.onLoadEarlier}
                  >
                    {props.historyLoading
                      ? language.t("session.messages.loadingEarlier")
                      : language.t("session.messages.loadEarlier")}
                  </Button>
                </div>
              </Show>
              <Show when={windowed.top > 0}>
                <div class="w-full shrink-0" style={{ height: `${windowed.top}px` }} aria-hidden="true" />
              </Show>
              <div class="w-full contents">
                <For each={visibleRendered()}>
                  {(messageID) => <TimelineItem index={renderedIndex().get(messageID) ?? 0} messageID={messageID} />}
                </For>
              </div>
              <Show when={windowed.bottom > 0}>
                <div class="w-full shrink-0" style={{ height: `${windowed.bottom}px` }} aria-hidden="true" />
              </Show>
            </div>
          </div>
        </Show>
        <Show when={scrollRoot()}>
          {(root) => (
            <Virtualizer
              data={timelineRowKeys()}
              cache={virtualCache()}
              itemSize={virtualCache() ? undefined : timelineFallbackItemSize}
              scrollRef={root()}
              shift={props.historyShift}
              keepMounted={keepMounted()}
              startMargin={64}
              ref={(handle) => {
                if (!handle) {
                  writeTimelineCache(virtualizerSessionKey, virtualizerRowKeys, virtualizer)
                  virtualizer = undefined
                  return
                }
                virtualizer = handle
                virtualizerSessionKey = cacheSessionKey
                virtualizerRowKeys = cacheRowKeys
                maybeAnchorBottom()
                scheduleContentRoot(root())
              }}
            >
              {(key) => <TimelineRowView rowKey={key} />}
            </Virtualizer>
          )}
        </Show>
      </ScrollView>
    </div>
  )

  function TimelineItem(item: { messageID: string; index: number }) {
    const active = createMemo(() => activeMessageID() === item.messageID)
    const eager = createMemo(() => active() || item.index >= rendered().length - 3)
    const highlight = createMemo<"full" | "defer">(() => (active() ? "full" : "defer"))
    const math = createMemo<"full" | "defer">(() => {
      if (mathMode() !== "turn") return "full"
      return eager() ? "full" : "defer"
    })
    const messages = createMemo<MessageType[]>((prev?: MessageType[]) => {
      if (active()) return turnMessages(sessionMessages(), item.messageID)
      const next = turnMessages(sessionMessages(), item.messageID)
      return prev && sameMessages(prev, next) ? prev : next
    }, emptyMessages)
    const comments = createMemo(() => messageComments(sync.data.part[item.messageID] ?? []), [], {
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    })
    const commentCount = createMemo(() => comments().length)
    let rootRef: HTMLDivElement | undefined
    let stop: (() => void) | undefined
    let raf: number | undefined

    const measure = () => {
      const next = rootRef?.offsetHeight
      if (!next) return
      const prev = turnHeights.get(item.messageID)
      if (prev !== undefined && Math.abs(prev - next) <= 1) return
      turnHeights.set(item.messageID, next)
      scheduleWindow()
    }

    createEffect(() => {
      if (!rootRef) return
      measure()
      const update = () => {
        if (raf !== undefined) cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          raf = undefined
          measure()
        })
      }
      // Each rendered turn feeds back its real height so spacer estimates
      // converge as the user scrolls through long markdown/math history.
      const observer = new ResizeObserver(update)
      observer.observe(rootRef)
      onCleanup(() => {
        observer.disconnect()
        if (raf === undefined) return
        cancelAnimationFrame(raf)
        raf = undefined
      })
    })

    createEffect(() => {
      if (!active()) return
      if (!isWorking()) return
      console.debug("[timeline] active item mounted", {
        msg: item.messageID,
        index: item.index,
        visible: visibleRendered().includes(item.messageID),
      })
    })

    onCleanup(() => stop?.())
    onCleanup(() => {
      if (!active()) return
      console.warn("[timeline] active item unmounted", {
        msg: item.messageID,
        index: item.index,
        working: isWorking(),
        visibleSize: visibleRendered().length,
        first: visibleRendered().at(0),
        last: visibleRendered().at(-1),
        top: Math.round(windowed.top),
        bottom: Math.round(windowed.bottom),
      })
    })

    return (
      <div
        ref={(el) => {
          stop?.()
          rootRef = el
          el.addEventListener("mousedown", onLinkDown, { capture: true })
          el.addEventListener("click", onLink, { capture: true })
          stop = () => {
            el.removeEventListener("mousedown", onLinkDown, { capture: true })
            el.removeEventListener("click", onLink, { capture: true })
          }
        }}
        id={props.anchor(item.messageID)}
        data-message-id={item.messageID}
        classList={{
          "min-w-0 w-full max-w-full": true,
        }}
        style={itemStyle(props.centered)}
      >
        <Show when={commentCount() > 0}>
          <div class="w-full px-4 md:px-5 pb-2">
            <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
              <div class="flex w-max min-w-full justify-end gap-2">
                <Index each={comments()}>
                  {(commentAccessor: () => MessageComment) => {
                    const comment = createMemo(() => commentAccessor())
                    return (
                      <Show when={comment()}>
                        {(c) => (
                          <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                            <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                              <FileIcon node={{ path: c().path, type: "file" }} class="size-3.5 shrink-0" />
                              <span class="truncate">{getFilename(c().path)}</span>
                              <Show when={c().selection}>
                                {(selection) => (
                                  <span class="shrink-0 text-text-weak">
                                    {selection().startLine === selection().endLine
                                      ? `:${selection().startLine}`
                                      : `:${selection().startLine}-${selection().endLine}`}
                                  </span>
                                )}
                              </Show>
                            </div>
                            <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                              {c().comment}
                            </div>
                          </div>
                        )}
                      </Show>
                    )
                  }}
                </Index>
              </div>
            </div>
          </div>
        </Show>
        <SessionTurn
          sessionID={sessionID() ?? ""}
          messageID={item.messageID}
          messages={messages()}
          actions={props.actions}
          autoScroll={false}
          fill={false}
          active={active()}
          status={active() ? sessionStatus() : undefined}
          showReasoningSummaries={settings.general.showReasoningSummaries()}
          showCustomHookParts={settings.general.showCustomHookParts()}
          shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
          editToolDefaultOpen={settings.general.editToolPartsExpanded()}
          markdownEager={eager()}
          markdownViewport={viewport}
          markdownHighlight={highlight()}
          markdownMath={math()}
          classes={{
            root: "min-w-0 w-full relative",
            content: "flex flex-col justify-between !overflow-visible",
            container: "w-full px-4 md:px-5",
          }}
        />
      </div>
    )
  }
}
