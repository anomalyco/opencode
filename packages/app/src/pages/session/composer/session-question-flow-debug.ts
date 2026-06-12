type QuestionFlowFields = Record<string, string | number | boolean | undefined>

type QuestionFlowCorrelation = {
  sessionID?: string
  requestID?: string
}

type QuestionFlowRecent = {
  at: number
  requestID: string
  sessionID: string
  source: string
  submittedAt?: number
}

type QuestionFlowGlobal = {
  seq: number
  latest?: QuestionFlowRecent
  recentBySession: Record<string, QuestionFlowRecent | undefined>
}

const QUESTION_FLOW_KEY = "opencode.question.flow"
const QUESTION_FLOW_RECENT_MS = 12_000

function questionFlowGlobal(): QuestionFlowGlobal | undefined {
  if (typeof window === "undefined") return undefined
  const target = window as Window & { __opencodeQuestionFlow?: QuestionFlowGlobal }
  target.__opencodeQuestionFlow ??= {
    seq: 0,
    recentBySession: {},
  }
  return target.__opencodeQuestionFlow
}

function questionFlowNow(): number {
  if (typeof performance === "undefined") return Date.now()
  return performance.now()
}

export function questionFlowEnabled(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(QUESTION_FLOW_KEY) !== "0"
  } catch {
    return true
  }
}

export function rememberQuestionFlow(input: {
  requestID: string
  sessionID: string
  source: string
  submitted?: boolean
}): void {
  if (!questionFlowEnabled()) return
  const global = questionFlowGlobal()
  if (!global) return

  const at = questionFlowNow()
  const previous = global.recentBySession[input.sessionID]
  const recent: QuestionFlowRecent = {
    at,
    requestID: input.requestID,
    sessionID: input.sessionID,
    source: input.source,
    submittedAt:
      input.submitted === true
        ? at
        : previous?.requestID === input.requestID
          ? previous.submittedAt
          : undefined,
  }
  global.latest = recent
  global.recentBySession[input.sessionID] = recent
}

function resolveRecent(
  global: QuestionFlowGlobal | undefined,
  correlation: QuestionFlowCorrelation | undefined,
): QuestionFlowRecent | undefined {
  if (!global) return undefined
  if (correlation?.sessionID) {
    const sessionRecent = global.recentBySession[correlation.sessionID]
    if (!correlation.requestID || sessionRecent?.requestID === correlation.requestID) return sessionRecent
  }
  if (correlation?.requestID && global.latest?.requestID === correlation.requestID) return global.latest
  return global.latest
}

export function markQuestionFlow(
  phase: string,
  fields: QuestionFlowFields = {},
  correlation?: QuestionFlowCorrelation,
): void {
  if (!questionFlowEnabled()) return
  const global = questionFlowGlobal()
  if (!global) return

  const at = questionFlowNow()
  const recent = resolveRecent(global, correlation)
  const hasCorrelation = !!correlation?.sessionID || !!correlation?.requestID
  if (!hasCorrelation && (!recent || at - recent.at > QUESTION_FLOW_RECENT_MS)) return

  const sessionID = correlation?.sessionID ?? recent?.sessionID
  const requestID = correlation?.requestID ?? recent?.requestID
  if (hasCorrelation && sessionID && requestID) {
    const existing = global.recentBySession[sessionID]
    if (!existing || existing.requestID === requestID) {
      global.latest = {
        at,
        requestID,
        sessionID,
        source: existing?.source ?? phase,
        submittedAt: existing?.submittedAt,
      }
      global.recentBySession[sessionID] = global.latest
    }
  }

  global.seq += 1
  const matchedRecent = recent && recent.requestID === requestID ? recent : undefined
  const submittedAt = matchedRecent?.submittedAt
  const values: QuestionFlowFields = {
    seq: global.seq,
    session: sessionID ?? "none",
    request: requestID ?? "none",
    sinceSubmitMs: submittedAt === undefined ? "none" : Math.round(at - submittedAt),
    ...fields,
  }
  const line = Object.entries(values)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(" ")

  console.debug(`[question-flow] phase=${phase} t=${at.toFixed(1)} ${line}`)
}

export function questionFlowElementMetrics(
  element: HTMLElement | undefined,
  prefix: string,
): QuestionFlowFields {
  if (!element) return { [`${prefix}Rect`]: "none" }
  const rect = element.getBoundingClientRect()
  return {
    [`${prefix}Top`]: Math.round(rect.top),
    [`${prefix}Bottom`]: Math.round(rect.bottom),
    [`${prefix}Height`]: Math.round(rect.height),
    [`${prefix}Width`]: Math.round(rect.width),
  }
}

export function questionFlowViewportMetrics(
  viewport: HTMLElement | null | undefined,
  prefix = "viewport",
): QuestionFlowFields {
  if (!viewport) return { [`${prefix}Rect`]: "none" }
  const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  return {
    [`${prefix}Top`]: Math.round(viewport.scrollTop),
    [`${prefix}ScrollHeight`]: Math.round(viewport.scrollHeight),
    [`${prefix}ClientHeight`]: Math.round(viewport.clientHeight),
    [`${prefix}BottomGap`]: Math.round(Math.max(0, max - viewport.scrollTop)),
  }
}
