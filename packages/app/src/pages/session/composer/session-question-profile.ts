import type { Part, QuestionRequest } from "@opencode-ai/sdk/v2"

const key = "opencode.question.profile"
type TextMark = { at: number; messageID: string; partID: string; length: number; source: string }
type AskedMark = { at: number; sessionID: string; textGap: number | "none" }
type ToolMark = {
  at: number
  sessionID: string
  messageID: string
  partID: string
  callID: string
  status: string
  questions: number | "none"
}
type UiMark = { at: number; fields: Record<string, string | number | boolean | undefined> }
type RecentQuestion = { at: number; sessionID: string; requestID: string }

const lastTextBySession = new Map<string, TextMark>()
const askedByRequest = new Map<string, AskedMark>()
const firstToolByCall = new Map<string, ToolMark>()
const visibleToolByCall = new Map<string, ToolMark>()
const uiByRequest = new Map<string, Record<string, UiMark | undefined>>()
const timelineCountByRequest = new Map<string, number>()
const seen = new Set<string>()

function globalProfile() {
  if (typeof window === "undefined") return
  const target = window as Window & {
    __opencodeQuestionProfile?: {
      lastTextBySession: Record<string, TextMark | undefined>
      askedByRequest: Record<string, AskedMark | undefined>
      firstToolByCall: Record<string, ToolMark | undefined>
      visibleToolByCall: Record<string, ToolMark | undefined>
      uiByRequest: Record<string, Record<string, UiMark | undefined> | undefined>
      recentQuestion?: RecentQuestion
      timelineCountByRequest: Record<string, number | undefined>
      seen: Record<string, boolean | undefined>
    }
  }
  target.__opencodeQuestionProfile ??= {
    lastTextBySession: {},
    askedByRequest: {},
    firstToolByCall: {},
    visibleToolByCall: {},
    uiByRequest: {},
    timelineCountByRequest: {},
    seen: {},
  }
  return target.__opencodeQuestionProfile
}

function now() {
  if (typeof performance === "undefined") return Date.now()
  return performance.now()
}

export function questionProfileEnabled() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(key) !== "0"
  } catch {
    return true
  }
}

function emit(phase: string, fields: Record<string, string | number | boolean | undefined>) {
  if (!questionProfileEnabled()) return
  const line = Object.entries(fields)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(" ")
  console.debug(`[question-profile] phase=${phase} t=${now().toFixed(1)} ${line}`)
}

function gap(from: number | undefined, to: number | undefined) {
  if (from === undefined || to === undefined) return "none" as const
  return Math.round(to - from)
}

function markRecentQuestion(sessionID: string, requestID: string) {
  const global = globalProfile()
  if (!global) return
  global.recentQuestion = { at: now(), sessionID, requestID }
}

function textLength(part: Part) {
  if (part.type !== "text") return
  return part.text.length
}

export function markQuestionProfileText(part: Part, source: string) {
  const length = textLength(part)
  if (length === undefined) return
  const mark = {
    at: now(),
    messageID: part.messageID,
    partID: part.id,
    length,
    source,
  }
  lastTextBySession.set(part.sessionID, mark)
  const global = globalProfile()
  if (global) global.lastTextBySession[part.sessionID] = mark
}

export function markQuestionProfileDelta(input: { sessionID: string; messageID: string; partID: string; length: number }) {
  const mark = {
    at: now(),
    messageID: input.messageID,
    partID: input.partID,
    length: input.length,
    source: "delta",
  }
  lastTextBySession.set(input.sessionID, mark)
  const global = globalProfile()
  if (global) global.lastTextBySession[input.sessionID] = mark
}

export function markQuestionProfileTool(part: Part, source: string) {
  if (part.type !== "tool" || part.tool !== "question") return
  const at = now()
  const state = part.state
  const questions = Array.isArray(state.input.questions) ? state.input.questions.length : "none"
  const mark: ToolMark = {
    at,
    sessionID: part.sessionID,
    messageID: part.messageID,
    partID: part.id,
    callID: part.callID,
    status: state.status,
    questions,
  }
  const global = globalProfile()
  if (!firstToolByCall.has(part.callID)) {
    firstToolByCall.set(part.callID, mark)
    if (global) global.firstToolByCall[part.callID] = mark
  }
  if (state.status !== "pending" && !visibleToolByCall.has(part.callID)) {
    visibleToolByCall.set(part.callID, mark)
    if (global) global.visibleToolByCall[part.callID] = mark
  }
}

export function markQuestionProfileAsked(request: QuestionRequest, source: string) {
  const at = now()
  const text = lastTextBySession.get(request.sessionID)
  const textGap = text ? Math.round(at - text.at) : ("none" as const)
  const mark = { at, sessionID: request.sessionID, textGap }
  askedByRequest.set(request.id, mark)
  const global = globalProfile()
  if (global) global.askedByRequest[request.id] = mark
  markRecentQuestion(request.sessionID, request.id)
}

export function markQuestionProfileUi(phase: string, request: QuestionRequest, extra?: Record<string, string | number | boolean | undefined>) {
  const at = now()
  const global = globalProfile()
  markRecentQuestion(request.sessionID, request.id)
  const asked = askedByRequest.get(request.id) ?? global?.askedByRequest[request.id]
  const text = lastTextBySession.get(request.sessionID) ?? global?.lastTextBySession[request.sessionID]
  const key = `${phase}:${request.id}`
  if (seen.has(key) || global?.seen[key]) return
  seen.add(key)
  if (global) global.seen[key] = true
  const marks = uiByRequest.get(request.id) ?? global?.uiByRequest[request.id] ?? {}
  marks[phase] = { at, fields: extra ?? {} }
  uiByRequest.set(request.id, marks)
  if (global) global.uiByRequest[request.id] = marks
  if (phase !== "question-dock-raf2") return

  const summaryKey = `summary:${request.id}`
  if (seen.has(summaryKey) || global?.seen[summaryKey]) return
  seen.add(summaryKey)
  if (global) global.seen[summaryKey] = true

  const call = request.tool?.callID
  const firstTool = call ? firstToolByCall.get(call) ?? global?.firstToolByCall[call] : undefined
  const visibleTool = call ? visibleToolByCall.get(call) ?? global?.visibleToolByCall[call] : undefined
  const composer = marks["composer-request"]
  const region = marks["composer-region"]
  const wrapper = marks["question-wrapper-ref"]
  const mount = marks["question-dock-mount"]
  const raf = marks["question-dock-raf1"]
  const raf2 = marks["question-dock-raf2"]

  emit("question-summary", {
    session: request.sessionID,
    request: request.id,
    questions: request.questions.length,
    toolCall: call ?? "none",
    toolStatus: visibleTool?.status ?? firstTool?.status ?? "none",
    textGapMs: asked?.textGap ?? "none",
    firstToolGapMs: gap(asked?.at, firstTool?.at),
    visibleToolGapMs: gap(asked?.at, visibleTool?.at),
    composerGapMs: gap(asked?.at, composer?.at),
    regionGapMs: gap(asked?.at, region?.at),
    wrapperGapMs: gap(asked?.at, wrapper?.at),
    mountGapMs: gap(asked?.at, mount?.at),
    raf1GapMs: gap(asked?.at, raf?.at),
    raf2GapMs: gap(asked?.at, raf2?.at),
    sinceTextMs: text ? Math.round(at - text.at) : "none",
    textMsg: text?.messageID ?? "none",
    textPart: text?.partID ?? "none",
    textLen: text?.length ?? "none",
    textSource: text?.source ?? "none",
    mountToRafMs: raf?.fields.mountToRafMs,
    height: raf2?.fields.height ?? raf?.fields.height ?? wrapper?.fields.height,
    viewportClient: raf2?.fields.viewportClient,
    viewportHeight: raf2?.fields.viewportHeight,
    viewportTop: raf2?.fields.viewportTop,
    dockHeight: raf2?.fields.dockHeight,
    options: mount?.fields.options,
    cached: mount?.fields.cached,
  })
}

export function markQuestionProfileTimeline(
  phase: string,
  fields: Record<string, string | number | boolean | undefined>,
) {
  if (!questionProfileEnabled()) return
  const at = now()
  const global = globalProfile()
  const recent = global?.recentQuestion
  if (!recent) return
  const sinceQuestionMs = Math.round(at - recent.at)
  if (sinceQuestionMs > 8_000) return

  const localCount = timelineCountByRequest.get(recent.requestID) ?? 0
  const globalCount = global?.timelineCountByRequest[recent.requestID] ?? 0
  const count = Math.max(localCount, globalCount)
  if (count >= 16) return
  timelineCountByRequest.set(recent.requestID, count + 1)
  if (global) global.timelineCountByRequest[recent.requestID] = count + 1

  emit(`timeline:${phase}`, {
    session: recent.sessionID,
    request: recent.requestID,
    sinceQuestionMs,
    index: count + 1,
    ...fields,
  })
}
