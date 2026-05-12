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
import type { MarkdownStage } from "@opencode-ai/ui/markdown"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
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
const gap = 48
const windowOverscan = 1600
const windowThreshold = 3
const totalViewports = 2
const turnViewports = 1.5
const scoreLimit = 1_200
const textLimit = 8_000
const mathLimit = 24
const codeLimit = 12
const partLimit = 24
const toolLimit = 8
const MEASURE_WARN_MS = 24
const HEIGHT_SHIFT_WARN = 120
const SPACER_SHIFT_WARN = 400

const heightCacheKey = (sessionId: string, msgId: string, stage: string) =>
  `opencode.h.${sessionId}.${msgId}.${stage}`

const rankByStage = {
  lite: 0,
  structure: 1,
  full: 2,
} as const

const stageCacheKey = (sessionId: string, msgId: string) => `opencode.s.${sessionId}.${msgId}`

const parseStage = (value: string | null | undefined): MarkdownStage | undefined => {
  if (value === "lite") return "lite"
  if (value === "structure") return "structure"
  if (value === "full") return "full"
  return undefined
}

const readStageCache = (sessionId: string, msgId: string): MarkdownStage | undefined => {
  try {
    return parseStage(sessionStorage.getItem(stageCacheKey(sessionId, msgId)))
  } catch {
    return undefined
  }
}

const writeStageCache = (sessionId: string, msgId: string, stage: MarkdownStage) => {
  try {
    sessionStorage.setItem(stageCacheKey(sessionId, msgId), stage)
  } catch {
    // QuotaExceededError — silently drop
  }
}

const deleteStageCache = (sessionId: string, msgId: string) => {
  try {
    sessionStorage.removeItem(stageCacheKey(sessionId, msgId))
  } catch {
    // Ignore storage access failures
  }
}

const maxStage = (a: MarkdownStage, b: MarkdownStage) => (rankByStage[a] >= rankByStage[b] ? a : b)

const readHeightCache = (sessionId: string, msgId: string, stage: string): number | undefined => {
  try {
    const v = sessionStorage.getItem(heightCacheKey(sessionId, msgId, stage))
    if (v === null) return undefined
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

const writeHeightCache = (sessionId: string, msgId: string, stage: string, height: number) => {
  try {
    sessionStorage.setItem(heightCacheKey(sessionId, msgId, stage), String(height))
  } catch {
    // QuotaExceededError — silently drop
  }
}
const IDLE_QUEUE_MS = 1_200
const mdKey = "opencode.markdown.debug"
const virtKey = "opencode.session.virtual.debug"
const domMs = 5_000
const lagMs = 250

function mddebug() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(mdKey) === "1"
  } catch {
    return false
  }
}

function vdebug(id?: string) {
  if (typeof window === "undefined") return false
  try {
    const flag = window.localStorage.getItem(virtKey)
    return flag === "1" || (!!id && flag === id)
  } catch {
    return false
  }
}

type MathMode = "turn" | "markdown"

type Estimate = {
  height: number
  complexity: number
  text: number
  code: number
  math: number
  part: number
  tool: number
}

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

function inset(node: HTMLElement) {
  const raw = getComputedStyle(node).getPropertyValue("--session-title-inset").trim()
  return Number.parseFloat(raw) || 0
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
  seekingMessageId?: string
  onJumpToMessage: (message: UserMessage) => void
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
}) {
  let touchGesture: number | undefined
  let contentRef: HTMLDivElement | undefined

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
  let mutationFrame: number | undefined
  let pinFrame: number | undefined
  let pinSource = "unknown"
  let blank: number | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let lagAt = 0
  let lagMax = 0
  let mdWasDebug = false
  let windowAdjustVersion = 0
  const turnHeights = new Map<string, number>()
  const [revision, setRevision] = createSignal(0)
  const [stageMark, setStageMark] = createSignal(0)
  const stageByTurn = new Map<string, Map<string, MarkdownStage>>()
  const upgraded = new Set<string>()
  const stageById = new Map<string, MarkdownStage>()
  let seq = 0
  let skipped = 0
  const sessionID = createMemo(() => params.id)
  const sessionMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })

  const rendered = createMemo(() => props.renderedUserMessages.map((message) => message.id))
  const renderedIndex = createMemo(() => new Map(rendered().map((id, index) => [id, index])))
  const estimates = createMemo(() => {
    const ids = new Set(rendered())
    const map = new Map<string, Estimate>()
    let id: string | undefined
    let text = 0
    let code = 0
    let math = 0
    let part = 0
    let tool = 0

    const save = () => {
      if (!id || !ids.has(id)) return
      const height = Math.max(280, Math.min(1800, 220 + text / 6 + code * 160 + math * 120 + part * 18 + tool * 90))
      const complexity = text / 8 + code * 180 + math * 160 + part * 24 + tool * 120
      map.set(id, {
        height,
        complexity,
        text,
        code,
        math,
        part,
        tool,
      })
    }

    for (const msg of sessionMessages()) {
      if (msg.role === "user") {
        save()
        id = msg.id
        text = 0
        code = 0
        math = 0
        part = 0
        tool = 0
      }
      if (!id) continue

      const parts = sync.data.part[msg.id] ?? []
      part += parts.length
      tool += parts.filter((item) => item.type !== "text").length
      const body = parts
        .filter((item): item is TextPart => item.type === "text" && !(item as TextPart).synthetic)
        .map((item) => item.text)
        .join("\n")
      text += body.length
      code += body.match(/```/g)?.length ?? 0
      math += (body.match(/\$\$|\\\[|\\\(/g)?.length ?? 0) + (body.match(/(?:^|\s)\$[^$\n]+\$/g)?.length ?? 0)
    }
    save()

    return map
  })

  const follow = (root: HTMLDivElement, src: string) => {
    if (props.hasScrollGesture()) {
      const now = Date.now()
      if (now - skipped > 300) {
        console.debug("[timeline] follow held", { src })
        skipped = now
      }
      return
    }

    root.scrollTop = root.scrollHeight
    props.onScheduleScrollState(root)
  }
  const estimateTurnHeight = (id: string) => {
    if (turnHeights.has(id)) return turnHeights.get(id)!
    const sid = sessionID()
    if (sid) {
      const cached = readHeightCache(sid, id, "full") ?? readHeightCache(sid, id, "structure") ?? readHeightCache(sid, id, "lite")
      if (cached !== undefined) return cached
    }
    return estimates()?.get(id)?.height ?? estimatedTurnHeight
  }
  const stageOf = (id: string) => {
    stageMark()
    const sid = sessionID()
    const cached = sid ? readStageCache(sid, id) : undefined
    const local = stageById.get(id)
    const next = cached && local ? maxStage(cached, local) : (cached ?? local)
    if (next === "full") return "full"
    if (next === "structure") return "structure"
    return "lite"
  }
  const saveStage = (id: string, stage: MarkdownStage, src: string) => {
    const prev = stageById.get(id)
    const next = prev ? maxStage(prev, stage) : stage
    if (prev === next) return false
    stageById.set(id, next)
    if (next === "full") upgraded.add(id)
    const sid = sessionID()
    if (sid) writeStageCache(sid, id, next)
    seq += 1
    console.debug(`[timeline] stage cache: src=${src} id=${id} prev=${prev ?? "none"} next=${next} sid=${sid ?? "none"} seq=${seq}`)
    setStageMark((value) => value + 1)
    return true
  }
  const slot = (id: string, index: number, size: number) => estimateTurnHeight(id) + (index < size - 1 ? gap : 0)
  const offset = (ids: string[], end: number) => {
    let sum = 0
    for (let i = 0; i < end; i++) sum += slot(ids[i]!, i, ids.length)
    return sum
  }
  const totalHeight = createMemo(() => {
    revision()
    return offset(rendered(), rendered().length)
  })
  const visible = (node: HTMLElement) => {
    const root = viewport
    if (!root) return true
    const box = root.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    return rect.bottom > box.top && rect.top < box.bottom
  }
  const trace = (stage: string, id?: string, extra = "") => {
    const root = viewport
    const data = root ? snap(root) : undefined
    const key = id && typeof CSS !== "undefined" ? CSS.escape(id) : id
    const node = key ? root?.querySelector<HTMLElement>(`[data-message-id="${key}"]`) : undefined
    const box = root?.getBoundingClientRect()
    const rect = node?.getBoundingClientRect()
    const top = rect && box ? Math.round(rect.top - box.top) : "none"
    const bottom = rect && box ? Math.round(rect.bottom - box.top) : "none"
    const height = rect ? Math.round(rect.height) : "none"
    const index = id ? (renderedIndex().get(id) ?? "none") : "none"
    console.debug(
      `[jump] stage=${stage} id=${id || "none"} index=${index} current=${props.currentMessageId || "none"} seeking=${props.seekingMessageId || "none"} scrollTop=${data?.top ?? "none"} scrollHeight=${data?.height ?? "none"} clientHeight=${data?.client ?? "none"} max=${data?.max ?? "none"} gap=${data?.gap ?? "none"} window=[${windowed.start},${windowed.end}] spacerTop=${Math.round(windowed.top)} spacerBottom=${Math.round(windowed.bottom)} total=${Math.round(totalHeight())} measured=${turnHeights.size} visible=${visibleRendered().length} nodeTop=${top} nodeBottom=${bottom} nodeHeight=${height}${extra ? ` ${extra}` : ""}`,
    )
  }
  const census = () => {
    const enabled = mddebug()
    if (enabled && !mdWasDebug) {
      console.debug("[markdown:dom] enabled")
    }
    mdWasDebug = enabled
    if (!enabled) {
      lagMax = 0
      return
    }
    const root = viewport
    if (!root) return

    const start = performance.now()
    const list = contentRef?.querySelector<HTMLElement>('[data-slot="session-turn-list"]')
    const full = root.querySelectorAll('[data-component="markdown"][data-markdown-stage="full"]').length
    const structure = root.querySelectorAll('[data-component="markdown"][data-markdown-stage="structure"]').length
    const lite = root.querySelectorAll('[data-component="markdown"][data-markdown-stage="lite"]').length
    const markdown = root.querySelectorAll('[data-component="markdown"]').length
    const katex = root.querySelectorAll(".katex,.katex-display,.katex-html,.katex-mathml").length
    const turns = root.querySelectorAll("[data-message-id]").length
    const nodes = root.querySelectorAll("*").length
    const text = root.textContent?.length ?? 0
    const data = snap(root)

    console.debug(
      `[markdown:dom] id=${sessionID() || "none"} turns=${turns} visible=${visibleRendered().length} rendered=${rendered().length} window=[${windowed.start},${windowed.end}] markdown=${markdown} full=${full} structure=${structure} lite=${lite} katex=${katex} nodes=${nodes} text=${text} measured=${turnHeights.size} upgraded=${upgraded.size} scrollTop=${data.top} scrollHeight=${data.height} clientHeight=${data.client} spacerTop=${Math.round(windowed.top)} spacerBottom=${Math.round(windowed.bottom)} listHeight=${list ? Math.round(list.getBoundingClientRect().height) : "none"} lagMax=${Math.round(lagMax)} took=${Math.round(performance.now() - start)}`,
    )
    lagMax = 0
  }
  const sampleLag = () => {
    if (!mddebug()) {
      lagAt = 0
      return
    }
    const now = performance.now()
    if (lagAt > 0) lagMax = Math.max(lagMax, Math.max(0, now - lagAt))
    lagAt = now + lagMs
  }
  const [windowed, setWindowed] = createStore({
    start: 0,
    end: Infinity,
    top: 0,
    bottom: 0,
  })

  makeTimer(census, domMs, setInterval)
  makeTimer(sampleLag, lagMs, setInterval)

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

  const eligible = createMemo(() => {
    revision()
    const ids = rendered()
    const root = viewport
    const view = root?.clientHeight && root.clientHeight > 0 ? root.clientHeight : 800
    let sum = 0
    let peak = 0
    let score = 0
    let text = false
    let math = false
    let code = false
    let parts = false
    let tools = false

    for (const id of ids) {
      const estimate = estimates().get(id)
      const height = turnHeights.get(id) ?? estimate?.height ?? estimatedTurnHeight
      sum += height
      peak = Math.max(peak, height)
      if (!estimate) continue
      score = Math.max(score, estimate.complexity)
      text ||= estimate.text >= textLimit
      math ||= estimate.math >= mathLimit
      code ||= estimate.code >= codeLimit
      parts ||= estimate.part >= partLimit
      tools ||= estimate.tool >= toolLimit
    }

    const count = ids.length > windowThreshold
    const total = sum > view * totalViewports
    const tall = peak > view * turnViewports
    const complex = score >= scoreLimit || text || math || code || parts || tools

    return {
      enabled: count || total || tall || complex,
      count,
      total,
      tall,
      complex,
      sum,
      peak,
      score,
      text,
      math,
      code,
      parts,
      tools,
    }
  })

  const canWindow = createMemo(() => !isWorking() && !sessionSwitching() && eligible().enabled)

  createEffect(() => {
    const id = sessionID()
    if (!vdebug(id) && !mddebug()) return
    const state = eligible()
    const visible = visibleRendered().length
    const ids = rendered().length
    console.debug(
      `[virtual] id=${id || "none"} active=${canWindow()} eligible=${state.enabled} working=${isWorking()} switching=${sessionSwitching()} turns=${ids} visible=${visible} window=[${windowed.start},${windowed.end}] count=${state.count} total=${state.total} tall=${state.tall} complex=${state.complex} sum=${Math.round(state.sum)} peak=${Math.round(state.peak)} score=${Math.round(state.score)} text=${state.text} math=${state.math} code=${state.code} parts=${state.parts} tools=${state.tools}`,
    )
  })

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
    const anchorTop = node.getBoundingClientRect().top - box.top

    const abnormalThreshold = root.clientHeight * 10
    if (Math.abs(anchorTop) > abnormalThreshold) {
      console.warn(
        `[captureMessageAnchor] ABNORMAL anchor position: id=${id} top=${anchorTop.toFixed(2)} threshold=${abnormalThreshold.toFixed(2)} - DOM may not be ready, skipping anchor`,
      )
      return undefined
    }

    return {
      id,
      top: anchorTop,
    }
  }

  const tailWindow = (ids: string[], root: HTMLDivElement) => {
    let end = ids.length
    let covered = 0
    const target = root.clientHeight + windowOverscan
    while (end > 0 && covered < target) {
      end -= 1
      covered += slot(ids[end]!, end, ids.length)
    }

    return {
      start: end,
      end: ids.length,
      top: offset(ids, end),
      bottom: 0,
    }
  }

  const buildWindow = () => {
    const root = viewport
    const ids = rendered()
    if (!canWindow() || !root) {
      return {
        start: 0,
        end: ids.length,
        top: 0,
        bottom: 0,
      }
    }
    if (root.clientHeight <= 0 || root.scrollHeight <= 0) {
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
      const next = offset + slot(ids[start]!, start, ids.length)
      if (next >= min) break
      offset = next
      start += 1
    }

    let end = start
    let tail = offset
    while (end < ids.length) {
      tail += slot(ids[end]!, end, ids.length)
      end += 1
      if (tail >= max) break
    }

    if (start >= ids.length) {
      const next = tailWindow(ids, root)
      console.warn(
        `[buildWindow] scrollTop exceeded estimated range: scrollTop=${scrollTop.toFixed(2)} totalEstimate=${offset.toFixed(2)} actualHeight=${scrollHeight.toFixed(2)} - using tail window=[${next.start},${next.end}] spacerTop=${Math.round(next.top)} spacerBottom=${Math.round(next.bottom)}`,
      )
      return next
    }

    const clampedStart = Math.max(0, Math.min(start, ids.length - 1))
    const clampedEnd = Math.max(clampedStart + 1, Math.min(end, ids.length))

    if (start !== clampedStart || end !== clampedEnd) {
      console.warn(
        `[buildWindow] CLAMPED window bounds: original=[${start},${end}] clamped=[${clampedStart},${clampedEnd}] total=${ids.length} scrollTop=${scrollTop.toFixed(2)} estimatedHeight=${tail.toFixed(2)} actualHeight=${scrollHeight.toFixed(2)}`,
      )
    }

    const next = {
      start: clampedStart,
      end: clampedEnd,
      top: offset,
      bottom: Math.max(0, totalHeight() - tail),
    }
    return next
  }

  const buildTargetWindow = (id: string) => {
    const root = viewport
    const ids = rendered()
    const index = renderedIndex().get(id)

    if (!root || index === undefined) {
      return {
        start: 0,
        end: ids.length,
        top: 0,
        bottom: 0,
      }
    }

    const span = root.clientHeight + windowOverscan * 3
    let start = index
    let end = index + 1
    let covered = slot(ids[index]!, index, ids.length)

    while (covered < span && (start > 0 || end < ids.length)) {
      const a = start > 0 ? slot(ids[start - 1]!, start - 1, ids.length) : -1
      const b = end < ids.length ? slot(ids[end]!, end, ids.length) : -1

      if (a >= b && start > 0) {
        start -= 1
        covered += a
        continue
      }

      if (end < ids.length) {
        covered += b
        end += 1
        continue
      }

      if (start > 0) {
        start -= 1
        covered += a
      }
    }

    const top = offset(ids, start)
    const tail = offset(ids, end)

    return {
      start,
      end,
      top,
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
    const top = offset(ids, start)
    const tail = offset(ids, end)
    return {
      start,
      end,
      top,
      bottom: Math.max(0, totalHeight() - tail),
    }
  }

  const applyWindow = () => {
    const root = viewport
    const before = root ? snap(root) : undefined
    const seek = props.seekingMessageId
    if (seek) trace("apply-before", seek)
    const streaming = isWorking() && props.live && !props.currentMessageId
    const pinned = streaming && !props.seekingMessageId && !!before && before.gap <= 16
    const viewportAnchor = pinned ? undefined : captureWindowAnchor()
    const targetId = props.currentMessageId ?? activeMessageID() ?? viewportAnchor?.id
    const targetAnchor = captureMessageAnchor(targetId)
    const scrollAnchor =
      seek && root && targetId
        ? { id: targetId, top: inset(root) }
        : props.currentMessageId
          ? targetAnchor
          : viewportAnchor
    const base = props.seekingMessageId ? buildTargetWindow(props.seekingMessageId) : buildWindow()
    const next = syncWindow(base, pinned ? undefined : targetId)
    const same = sameWindow(next)
    if (seek) {
      trace(
        "apply-window",
        seek,
        `base=[${base.start},${base.end}] baseTop=${Math.round(base.top)} baseBottom=${Math.round(base.bottom)} next=[${next.start},${next.end}] nextTop=${Math.round(next.top)} nextBottom=${Math.round(next.bottom)} same=${same} pinned=${pinned} target=${targetId || "none"} anchor=${scrollAnchor?.id || "none"}`,
      )
    }
    if (same && !seek) {
      if (pinned && root) {
        root.scrollTop = root.scrollHeight
        props.onScheduleScrollState(root)
      }
      return
    }

    if (!same) {
      const prev = { start: windowed.start, end: windowed.end, top: windowed.top, bottom: windowed.bottom }
      const top = Math.round(next.top - prev.top)
      const bottom = Math.round(next.bottom - prev.bottom)
      const shift = Math.max(Math.abs(top), Math.abs(bottom))
      seq += 1
      if (seek && shift > SPACER_SHIFT_WARN) trace("spacer-shift", seek, `deltaTop=${top} deltaBottom=${bottom}`)
      setWindowed(next)
    }

    audit(props.seekingMessageId ? "seek-window" : "apply-window")
    const adjustVersion = ++windowAdjustVersion
    const preserve = !seek && !pinned && props.hasScrollGesture() && !props.scroll.bottom
    if (!seek && (pinned || streaming)) {
      requestAnimationFrame(() => {
        if (adjustVersion !== windowAdjustVersion) return
        const root = viewport
        if (!root) return
        if (root.clientHeight <= 0 || root.scrollHeight <= 0) return
        const before = snap(root)
        root.scrollTop = root.scrollHeight
        const after = snap(root)
        seq += 1
        console.debug("[timeline] streaming window bottom follow", {
          before: before.gap,
          after: after.gap,
          pinned,
        })
        props.onScheduleScrollState(root)
      })
      return
    }
    if (!scrollAnchor) {
      return
    }
    if (preserve) {
      return
    }

    // Synchronous correction within the same rAF: setWindowed already flushed DOM,
    // so we can read the anchor's new position immediately without a second rAF.
    {
      const root = viewport
      if (root) {
        const key = typeof CSS === "undefined" ? scrollAnchor.id : CSS.escape(scrollAnchor.id)
        const node = root.querySelector<HTMLElement>(`[data-message-id="${key}"]`)
        if (node) {
          const box = root.getBoundingClientRect()
          const top = node.getBoundingClientRect().top - box.top
          const delta = top - scrollAnchor.top

          if (Math.abs(delta) > 1) {
            const prevTop = root.scrollTop
            root.scrollTop += delta
            const after = snap(root)

            if (seek)
              trace(
                "anchor-write",
                seek,
                `delta=${Math.round(delta)} prevTop=${Math.round(prevTop)} afterTop=${after.top} anchor=${scrollAnchor.id} target=${targetId || "none"}`,
              )
            props.onScheduleScrollState(root)
          }
        } else {
          if (seek) trace("anchor-missing", seek, `anchor=${scrollAnchor.id}`)
        }
      }
    }
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
    if (!canWindow() || !root) return false
    if (windowed.end === Infinity) return true
    const top = root.scrollTop
    const bottom = top + root.clientHeight
    const start = Math.max(0, windowed.top + windowOverscan / 2)
    const end = totalHeight() - Math.max(0, windowed.bottom + windowOverscan / 2)
    return top < start || bottom > end
  }

  const visibleRendered = createMemo(() => {
    const ids = rendered()
    if (!canWindow()) return ids
    return ids.slice(windowed.start, Math.min(ids.length, windowed.end))
  })

  const turnStage = (id: string): MarkdownStage => {
    const saved = stageOf(id)
    if (saved === "full") return "full"
    const map = stageByTurn.get(id)
    if (!map || map.size === 0) return saved
    let rank = 0
    for (const value of map.values()) {
      if (value === "full") rank = Math.max(rank, 2)
      else if (value === "structure") rank = Math.max(rank, 1)
    }
    if (rank === 2) return "full"
    if (rank === 1) return "structure"
    return saved
  }

  const idleTargets = createMemo(() => {
    if (props.seekingMessageId) return [] as string[]
    if (isWorking()) return [] as string[]

    const ids = rendered()
    const start = Math.max(0, windowed.start - 1)
    const end = Math.min(ids.length, windowed.end + 1)
    return ids
      .slice(start, end)
      .filter((id) => turnStage(id) !== "full")
      .slice(0, 1)
  })

  const audit = (source: string) => {
    if (blank !== undefined) return
    blank = requestAnimationFrame(() => {
      blank = undefined
      const root = viewport
      const ids = rendered()
      if (!root || !canWindow()) return

      const box = root.getBoundingClientRect()
      const nodes = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      const hit = nodes.filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > box.top && rect.top < box.bottom
      })
      if (hit.length > 0) return

      if (props.seekingMessageId) {
        trace(
          "blank",
          props.seekingMessageId,
          `source=${source} first=${visibleRendered().at(0) || "none"} last=${visibleRendered().at(-1) || "none"} rendered=${ids.length}`,
        )
        console.debug(`[virtual] blank rescue: id=${props.seekingMessageId} rendered=${ids.length}`)
        windowAdjustVersion += 1
        setWindowed({
          start: 0,
          end: ids.length,
          top: 0,
          bottom: 0,
        })
        return
      }
      scheduleWindow()
    })
  }

  const pin = (source: string) => {
    const root = viewport
    if (!root) {
      return
    }
    if (props.seekingMessageId || props.currentMessageId) {
      return
    }
    if (!props.live) {
      return
    }
    if (props.hasScrollGesture()) {
      return
    }
    if (root.clientHeight <= 0 || root.scrollHeight <= 0) {
      return
    }

    const top = Math.max(0, root.scrollHeight - root.clientHeight)
    const dist = top - root.scrollTop
    if (Math.abs(dist) <= 1) {
      return
    }

    root.scrollTop = top
    console.debug(
      `[timeline] bottom pin: source=${source} dist=${Math.round(dist)} top=${Math.round(root.scrollTop)} scrollHeight=${Math.round(root.scrollHeight)} clientHeight=${Math.round(root.clientHeight)}`,
    )
    props.onScheduleScrollState(root)
  }

  const schedulePin = (source: string) => {
    pinSource = source
    if (pinFrame !== undefined) return
    pinFrame = requestAnimationFrame(() => {
      pinFrame = undefined
      pin(pinSource)
    })
  }

  createEffect(
    on(rendered, () => {
      const ids = new Set(rendered())
      let changed = false
      for (const id of turnHeights.keys()) {
        if (!ids.has(id)) {
          turnHeights.delete(id)
          changed = true
        }
      }
      for (const id of stageByTurn.keys()) {
        if (!ids.has(id)) {
          stageByTurn.delete(id)
          upgraded.delete(id)
          stageById.delete(id)
          const sid = sessionID()
          if (sid) deleteStageCache(sid, id)
          changed = true
        }
      }
      if (changed) setRevision((value) => value + 1)
      if (changed) setStageMark((value) => value + 1)
      scheduleWindow()
    }),
  )

  createEffect(() => {
    const ids = idleTargets()
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    if (ids.length === 0) return

    idleTimer = setTimeout(() => {
      idleTimer = undefined
      const id = idleTargets()[0]
      if (!id || stageOf(id) === "full") return
      console.debug(`[markdown] idle upgrade: id=${id} queue=${idleTargets().join(",")}`)
      saveStage(id, "full", "idle")
      scheduleWindow()
    }, IDLE_QUEUE_MS)
  })

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
    if (props.seekingMessageId) return
    if (!props.live) return

    const step = () => {
      bottomFrame = undefined
      const root = viewport
      if (!root) return
      if (!isWorking()) return
      if (props.seekingMessageId) return
      if (!props.live) return
      follow(root, "frame")
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
    if (mutationFrame !== undefined) cancelAnimationFrame(mutationFrame)
    if (pinFrame !== undefined) cancelAnimationFrame(pinFrame)
    if (blank !== undefined) cancelAnimationFrame(blank)
    if (idleTimer !== undefined) clearTimeout(idleTimer)
  })

  createEffect(() => {
    const body = contentRef
    if (!body) return

    const sync = () => {
      schedulePin("content-resize")
    }

    const observer = new ResizeObserver(sync)
    observer.observe(body)
    if (body.firstElementChild instanceof HTMLElement) observer.observe(body.firstElementChild)

    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    const body = contentRef
    if (!body) return
    if (!isWorking()) return
    if (props.seekingMessageId) return
    if (!props.live) return

    let queued = false
    const flush = () => {
      queued = false
      mutationFrame = undefined
      const root = viewport
      if (!root) return
      if (!isWorking()) return
      if (props.seekingMessageId) return
      if (!props.live) return
      follow(root, "mutation")
    }
    const schedule = () => {
      if (queued) return
      queued = true
      mutationFrame = requestAnimationFrame(flush)
    }

    const activeID = activeMessageID()
    let target: Element = body
    if (activeID) {
      const key = typeof CSS === "undefined" ? activeID : CSS.escape(activeID)
      const el = body.querySelector(`[data-message-id="${key}"]`)
      if (el) target = el
      else if (body.lastElementChild) target = body.lastElementChild
    }

    const observer = new MutationObserver(schedule)
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    onCleanup(() => {
      observer.disconnect()
      if (mutationFrame === undefined) return
      cancelAnimationFrame(mutationFrame)
      mutationFrame = undefined
      queued = false
    })
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
      if (props.seekingMessageId)
        trace("active-change", props.seekingMessageId, `prev=${prev || "none"} next=${id || "none"}`)
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
  // Keep previous header state while session data is loading between
  // route changes, to prevent --session-title-inset from 64px→0px flash.
  const showHeader = createMemo((prev?: boolean) => {
    if (!info() && sessionID()) return prev ?? false
    return !!(titleValue() || parentID())
  })

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
    trace("click", message.id, `bottom=${props.scroll.bottom} live=${props.live}`)
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

  function Header() {
    return (
      <div
        data-session-title
        classList={{
          "absolute top-0 left-0 right-0 z-40 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
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
                    <h1 class="text-14-medium text-text-strong truncate grow-1 min-w-0" onDblClick={openTitleEditor}>
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
                      style={{ "max-height": "min(600px, 80vh)" }}
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
                          <DropdownMenu.ItemLabel>{language.t("session.share.action.share")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </Show>
                      <DropdownMenu.Item onSelect={() => void archiveSession(id())}>
                        <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id()} />)}>
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
                          <div class="text-13-medium text-text-strong">{language.t("session.share.popover.title")}</div>
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
        <Show when={showHeader()}>
          <Header />
        </Show>
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
            audit("scroll")
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
            "--session-title-inset": showHeader() ? "64px" : "0px",
            "--session-title-height": showHeader() ? "40px" : "0px",
            "--sticky-accordion-top": showHeader() ? "48px" : "0px",
          }}
        >
          <div
            ref={(el) => {
              contentRef = el
              props.setContentRef(el)
            }}
            class="min-w-0 w-full"
          >
            <div
              role="log"
              data-slot="session-turn-list"
              data-virtualized={canWindow() ? "true" : undefined}
              class="flex flex-col items-start justify-start pb-16"
              classList={{
                "w-full": true,
              }}
              style={{
                ...itemStyle(props.centered),
                gap: "0px",
                "margin-top": showHeader() ? "64px" : props.centered ? "0.125rem" : "0px",
              }}
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
    const near = createMemo(() => {
      const start = Math.max(0, windowed.start - 2)
      const end = Math.min(rendered().length, windowed.end + 2)
      return item.index >= start && item.index < end
    })
    const seek = createMemo(() => props.seekingMessageId === item.messageID)
    const stage = createMemo<MarkdownStage>(() => {
      stageMark()
      if (seek() || active()) return "full"
      const saved = stageOf(item.messageID)
      if (saved === "full") return "full"
      if (saved === "structure" && !near()) return "structure"
      if (near()) return "structure"
      return "lite"
    })
    const highlight = createMemo<"full" | "defer">(() => {
      if (stage() !== "lite") return "full"
      return "defer"
    })
    const math = createMemo<"full" | "defer">(() => {
      if (mathMode() !== "turn") return "full"
      if (stage() === "full") return "full"
      return "defer"
    })
    const skipRender = createMemo(() => isWorking() && !eager() && !near())
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
      const time = performance.now()
      const node = rootRef
      const next = node?.offsetHeight
      if (!next) return
      const prev = turnHeights.get(item.messageID)
      const base = prev ?? estimatedTurnHeight
      if (!visible(node) && next < base - HEIGHT_SHIFT_WARN) {
        if (seek()) {
          trace(
            "measure-ignored-shrink",
            item.messageID,
            `prev=${Math.round(base)} next=${Math.round(next)} delta=${Math.round(next - base)}`,
          )
        }
        return
      }
      if (prev !== undefined && Math.abs(prev - next) <= 1) return
      turnHeights.set(item.messageID, next)
      const sid = sessionID()
      const bucket = stageOf(item.messageID)
      if (sid) writeHeightCache(sid, item.messageID, bucket, next)
      setRevision((value) => value + 1)
      const delta = prev === undefined ? 0 : Math.round(next - prev)
      seq += 1
      if (prev !== undefined && Math.abs(delta) > HEIGHT_SHIFT_WARN) {
        if (seek()) {
          trace("measure-target", item.messageID, `prev=${Math.round(prev)} next=${Math.round(next)} delta=${delta}`)
        }
      }
      scheduleWindow()
      schedulePin("turn-measure")
      const took = performance.now() - time
      if (seek() && took > MEASURE_WARN_MS) {
        trace("measure-slow", item.messageID, `height=${Math.round(next)} took=${Math.round(took)}`)
      }
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
      if (seek()) trace("target-mounted", item.messageID)
    })

    onCleanup(() => stop?.())
    onCleanup(() => {
      if (!active()) return
      if (seek()) trace("target-unmounted", item.messageID)
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
          "turn-content-skip": skipRender(),
        }}
        style={{
          ...itemStyle(props.centered),
          "margin-bottom": item.index < rendered().length - 1 ? `${gap}px` : "0px",
        }}
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
          markdownStage={stage()}
          onMarkdownStage={(key, next) => {
            const prev = stageByTurn.get(item.messageID)
            if (!prev && next) {
              stageByTurn.set(item.messageID, new Map([[key, next]]))
              saveStage(item.messageID, next, "part")
              return
            }
            if (!prev) return
            if (next === undefined) {
              if (!prev.delete(key)) return
              if (prev.size === 0) stageByTurn.delete(item.messageID)
              setStageMark((value) => value + 1)
              return
            }
            if (prev.get(key) === next) return
            prev.set(key, next)
            saveStage(item.messageID, next, "part")
          }}
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
