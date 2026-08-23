import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { SessionID } from "@/session/schema"

export type TaskTurnEvidence = {
  readonly epoch: number
  readonly order: number
  readonly assistant: SessionV1.WithParts
}

export type TaskSelectedReturn =
  | {
      readonly type: "evidence"
      readonly candidate?: TaskTurnEvidence
      readonly observed?: TaskTurnEvidence
      readonly fallback: SessionV1.WithParts
      readonly degraded: boolean
    }
  | {
      readonly type: "cancelled"
      readonly taskID: SessionID
      readonly status: string
    }

type RenderState = "running" | "completed" | "error" | "cancelled"
type EligiblePart = SessionV1.TextPart | SessionV1.ReasoningPart | SessionV1.ToolPart

const ERROR_SOURCE_MAX = 1_024
const CONTENT_SOURCE_MAX = 512
const OPEN_FIELD_MAX = 256
const RECOVERY = "The Task session remains addressable by task_id; inspect or resume it if more evidence is needed."
const DEGRADED = [
  "<task_warning>",
  "Attachment coordination degraded. Returning the best observed output; background work was not interrupted.",
  "</task_warning>",
].join("\n")

export function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

export function hasUnconsumedLocalTool(parts: readonly SessionV1.Part[]) {
  return parts.some(
    (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
  )
}

function codepoints(value: string) {
  return Array.from(value)
}

function truncate(value: string, cap: number, head: number) {
  const points = codepoints(value)
  if (points.length <= cap) return value
  const tail = cap - head
  const omitted = points.length - cap
  return [
    points.slice(0, head).join(""),
    `…[${omitted} code points omitted]…`,
    points.slice(points.length - tail).join(""),
  ].join("")
}

function truncateError(value: string) {
  return truncate(value, ERROR_SOURCE_MAX, 768)
}

function truncateContent(value: string) {
  return truncate(value, CONTENT_SOURCE_MAX, 256)
}

function optionalOpen(value: string | undefined) {
  if (value === undefined) return undefined
  const length = codepoints(value).length
  if (length === 0 || length > OPEN_FIELD_MAX) return undefined
  return value
}

function assertedOpen(value: string | undefined) {
  return optionalOpen(value) ?? "unknown"
}

function errorMessage(error: NonNullable<SessionV1.Assistant["error"]>) {
  const data = error.data
  if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string") {
    return data.message
  }
  if ("message" in error && typeof error.message === "string") return error.message
  return error.name
}

function latestPart(parts: readonly SessionV1.Part[]): EligiblePart | undefined {
  return parts.findLast(
    (part): part is EligiblePart =>
      (part.type === "text" && part.text.length > 0) ||
      (part.type === "reasoning" && part.text.length > 0) ||
      part.type === "tool",
  )
}

function partTime(part: EligiblePart) {
  if (part.type === "tool") {
    if (part.state.status === "pending") return undefined
    return {
      start: part.state.time.start,
      ...(part.state.status === "running" ? {} : { end: part.state.time.end }),
    }
  }
  if (!part.time) return undefined
  return { start: part.time.start, ...(part.time.end === undefined ? {} : { end: part.time.end }) }
}

function partEvidence(part: EligiblePart | undefined, assistantError: boolean) {
  if (!part) return undefined
  if (part.type === "text") {
    return {
      id: part.id,
      type: part.type,
      ...(partTime(part) ? { time: partTime(part) } : {}),
      excerpt: truncateContent(part.text),
    }
  }
  if (part.type === "reasoning") {
    return {
      id: part.id,
      type: part.type,
      time: partTime(part),
      excerpt: truncateContent(part.text),
    }
  }
  const state = part.state
  const excerpt =
    state.status === "error" && !assistantError
      ? truncateError(state.error)
      : state.status === "completed"
        ? truncateContent(state.output)
        : undefined
  return {
    id: part.id,
    type: part.type,
    tool: assertedOpen(part.tool),
    callID: assertedOpen(part.callID),
    status: assertedOpen(state.status),
    ...(partTime(part) ? { time: partTime(part) } : {}),
    ...(excerpt === undefined ? {} : { excerpt }),
  }
}

function evidence(sessionID: SessionID, assistant: SessionV1.WithParts, outputLimit: boolean) {
  if (assistant.info.role !== "assistant") throw new Error("Task return does not contain an Assistant message")
  const info = assistant.info
  const error = info.error
  const part = latestPart(assistant.parts)
  return {
    task_id: sessionID,
    messageID: info.id,
    ...(optionalOpen(info.finish) ? { finish: optionalOpen(info.finish) } : {}),
    assistant_time: {
      created: info.time.created,
      ...(info.time.completed === undefined ? {} : { completed: info.time.completed }),
    },
    ...(error
      ? {
          error: {
            name: assertedOpen(error.name),
            message: truncateError(errorMessage(error)),
          },
        }
      : {}),
    ...(outputLimit ? { tokens: { output: info.tokens.output, reasoning: info.tokens.reasoning } } : {}),
    ...(part ? { last_part: partEvidence(part, error !== undefined) } : {}),
  }
}

function evidenceLine(value: object) {
  return `task_evidence=${JSON.stringify(value).replaceAll("<", "\\u003c")}`
}

function isOutputLimit(assistant: SessionV1.WithParts) {
  if (assistant.info.role !== "assistant") return false
  return assistant.info.error?.name === "MessageOutputLengthError" || assistant.info.finish === "length"
}

function select(input: Extract<TaskSelectedReturn, { type: "evidence" }>) {
  if (!input.candidate && !input.observed) return { assistant: input.fallback }
  if (!input.candidate) return { assistant: input.observed!.assistant }
  if (!input.observed) return { assistant: input.candidate.assistant }
  if (input.observed.order > input.candidate.order) return { assistant: input.observed.assistant }
  return { assistant: input.candidate.assistant, earlierObserved: input.observed.assistant }
}

function classify(sessionID: SessionID, selected: ReturnType<typeof select>) {
  const assistant = selected.assistant
  if (assistant.info.role !== "assistant") throw new Error("Task return does not contain an Assistant message")
  const info = assistant.info
  const error = info.error
  const outputLimit = isOutputLimit(assistant)
  const structuralError = info.finish !== "stop" || hasUnconsumedLocalTool(assistant.parts)
  const snapshot = evidenceLine(evidence(sessionID, assistant, outputLimit))
  const errorBody = (summary: string) => [summary, snapshot, RECOVERY].join("\n")

  if (error?.name === "ContextOverflowError") {
    return { state: "error" as const, text: errorBody("Task child exceeded its available context.") }
  }
  if (outputLimit) {
    return { state: "error" as const, text: errorBody("Task child reached its output limit.") }
  }
  if (error) {
    return { state: "error" as const, text: errorBody("Task child stopped with an Assistant error.") }
  }
  if (structuralError) {
    return { state: "error" as const, text: errorBody("Task child stopped without a clean final Assistant response.") }
  }

  const text = assistant.parts.findLast((part): part is SessionV1.TextPart => part.type === "text")?.text
  if (text && text.trim().length > 0) return { state: "completed" as const, text }

  const notice = `Task child returned finish:"stop"; its final TextPart was absent, empty, or whitespace-only. task_id: ${sessionID}.`
  if (!selected.earlierObserved) return { state: "completed" as const, text: notice }
  return {
    state: "completed" as const,
    text: [
      notice,
      evidenceLine(evidence(sessionID, selected.earlierObserved, isOutputLimit(selected.earlierObserved))),
    ].join("\n"),
  }
}

const NOTICE_MAX = 256

/**
 * One sanitized single-line notice. Runs of carriage returns, newlines and tabs collapse to single
 * spaces, `<` is escaped the same way evidence lines escape it, and the result is capped. Notice
 * text can interpolate a failure cause, so this is what stops that cause nesting a Task envelope.
 */
function sanitizeNotice(value: string) {
  const collapsed = value.replaceAll(/[\r\n\t]+/g, " ").replaceAll("<", "\\u003c")
  return truncate(collapsed, NOTICE_MAX, 192)
}

function noticeElements(notes: readonly string[] | undefined) {
  if (!notes?.length) return []
  return notes.map((note) => ["<task_notice>", sanitizeNotice(note), "</task_notice>"].join("\n"))
}

export function renderOutput(input: {
  sessionID: SessionID
  state: RenderState
  summary?: string
  notes?: readonly string[]
  text: string
}) {
  const tag = input.state === "running" ? "task_status" : input.state === "completed" ? "task_result" : "task_error"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    ...noticeElements(input.notes),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export function renderSelectedTask(input: {
  sessionID: SessionID
  selected: TaskSelectedReturn
  notes?: readonly string[]
}) {
  if (input.selected.type === "cancelled") {
    return renderCancelledTask({
      sessionID: input.selected.taskID,
      status: input.selected.status,
      notes: input.notes,
    })
  }
  const classified = classify(input.sessionID, select(input.selected))
  const text = [classified.text, ...(input.selected.degraded ? [DEGRADED] : [])].join("\n")
  return renderOutput({
    sessionID: input.sessionID,
    state: classified.state,
    notes: input.notes,
    text,
  })
}

export function renderCancelledTask(input: { sessionID: SessionID; status?: string; notes?: readonly string[] }) {
  const status = assertedOpen(input.status)
  const text = [
    `Task child was cancelled. task_id: ${input.sessionID}. status: ${status}.`,
    evidenceLine({ task_id: input.sessionID, status }),
  ].join("\n")
  return renderOutput({
    sessionID: input.sessionID,
    state: "cancelled",
    notes: input.notes,
    text,
  })
}

/** A notice-only delivery, for a completed terminal whose notices are still undelivered. */
export function renderNotices(input: { sessionID: SessionID; notes: readonly string[] }) {
  return renderOutput({
    sessionID: input.sessionID,
    state: "completed",
    notes: input.notes,
    text: "",
  })
}
