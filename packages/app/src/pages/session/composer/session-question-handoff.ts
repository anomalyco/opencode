import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"

type QuestionHandoffPart = string | { type: "image"; mime: string; url: string; filename?: string }

export type QuestionHandoff = {
  requestID: string
  sessionID: string
  messageID?: string
  callID?: string
  answers: QuestionHandoffPart[][]
  createdAt: number
}

type QuestionHandoffGlobal = {
  latest?: QuestionHandoff
  byRequest: Record<string, QuestionHandoff | undefined>
  byTool: Record<string, QuestionHandoff | undefined>
}

const QUESTION_HANDOFF_EVENT = "opencode:question-handoff"
const QUESTION_HANDOFF_MAX_AGE_MS = 30_000

function handoffNow(): number {
  if (typeof performance === "undefined") return Date.now()
  return performance.now()
}

function handoffGlobal(): QuestionHandoffGlobal | undefined {
  if (typeof window === "undefined") return undefined
  const target = window as Window & { __opencodeQuestionHandoff?: QuestionHandoffGlobal }
  target.__opencodeQuestionHandoff ??= {
    byRequest: {},
    byTool: {},
  }
  target.__opencodeQuestionHandoff.byTool ??= {}
  return target.__opencodeQuestionHandoff
}

function toolKey(input: { sessionID: string; messageID?: string; callID?: string }): string | undefined {
  if (!input.messageID && !input.callID) return undefined
  return `${input.sessionID}\n${input.messageID ?? ""}\n${input.callID ?? ""}`
}

function cloneAnswers(answers: QuestionAnswer[]): QuestionHandoffPart[][] {
  return answers.map((answer) =>
    answer.map((part) =>
      typeof part === "string"
        ? part
        : {
            type: "image",
            mime: part.mime,
            url: part.url,
            filename: part.filename,
          },
    ),
  )
}

function cleanupExpired(global: QuestionHandoffGlobal, now = handoffNow()): void {
  for (const [requestID, handoff] of Object.entries(global.byRequest)) {
    if (!handoff || now - handoff.createdAt <= QUESTION_HANDOFF_MAX_AGE_MS) continue
    delete global.byRequest[requestID]
    const key = toolKey(handoff)
    if (key) delete global.byTool[key]
    if (global.latest?.requestID === requestID) global.latest = undefined
  }
}

function dispatchHandoffEvent(handoff: QuestionHandoff | undefined, clearedRequestID?: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(QUESTION_HANDOFF_EVENT, {
      detail: handoff
        ? {
            type: "remember",
            requestID: handoff.requestID,
            sessionID: handoff.sessionID,
            messageID: handoff.messageID,
            callID: handoff.callID,
          }
        : {
            type: "clear",
            requestID: clearedRequestID,
          },
    }),
  )
}

export function rememberQuestionHandoff(input: {
  request: QuestionRequest
  answers: QuestionAnswer[]
}): void {
  const global = handoffGlobal()
  if (!global) return
  const now = handoffNow()
  cleanupExpired(global, now)

  const handoff: QuestionHandoff = {
    requestID: input.request.id,
    sessionID: input.request.sessionID,
    messageID: input.request.tool?.messageID,
    callID: input.request.tool?.callID,
    answers: cloneAnswers(input.answers),
    createdAt: now,
  }
  global.latest = handoff
  global.byRequest[handoff.requestID] = handoff
  const key = toolKey(handoff)
  if (key) global.byTool[key] = handoff
  dispatchHandoffEvent(handoff)
}

export function clearQuestionHandoff(requestID: string): void {
  const global = handoffGlobal()
  if (!global) return
  const handoff = global.byRequest[requestID]
  delete global.byRequest[requestID]
  const key = handoff ? toolKey(handoff) : undefined
  if (key) delete global.byTool[key]
  if (global.latest?.requestID === requestID) global.latest = undefined
  dispatchHandoffEvent(undefined, requestID)
}
