import path from "path"
import fs from "fs/promises"
import { AsyncLocalStorage } from "node:async_hooks"
import type { MiddlewareHandler } from "hono"
import { Context, Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { Event as LlmStreamEvent } from "@/session/llm"

const log = Log.create({ service: "workflow-trace" })

/** Written as `"format"` in every trace file for parsers. */
export const TRACE_FORMAT = "opencode-trace-v2"

const traceAls = new AsyncLocalStorage<WorkflowTraceSession>()

function envInt(name: string, fallback: number) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Max chars for `chat.user_input` (prompt text). */
function maxUserInputChars() {
  return envInt("OPENCODE_TRACE_MAX_USER_CHARS", 200_000)
}
/** Max chars for `chat.assistant_output` (final assistant text, all rounds). */
function maxAssistantOutputChars() {
  return envInt("OPENCODE_TRACE_MAX_ASSISTANT_CHARS", 500_000)
}
/** Max chars for `chat.model_stream_text` (concatenated assistant text deltas). */
function maxModelStreamChars() {
  return envInt("OPENCODE_TRACE_MAX_STREAM_CHARS", 500_000)
}
/** Cap `chat.part_deltas` rows (same granularity as bus `message.part.delta`). */
const MAX_PART_DELTA_EVENTS = () => envInt("OPENCODE_TRACE_MAX_PART_DELTAS", 100_000)
/** Per-row cap for `part_deltas[].delta`. */
const PART_DELTA_CAP = () => envInt("OPENCODE_TRACE_PART_DELTA_CAP", 8192)

/** One bus-aligned `message.part.delta` payload (UI stream chunks). */
export type WorkflowChatPartDeltaEntry = {
  ms: number
  message_id: string
  part_id: string
  field: string
  delta: string
}

export type WorkflowChatTrace = {
  session_id?: string
  user_message_id?: string
  /** Full user-visible prompt text (capped). */
  user_input?: string
  /** @deprecated use `user_input` */
  user_text_preview?: string
  model?: string
  assistant_message_id?: string
  /** Final assistant plain text after stream completes (capped). */
  assistant_output?: string
  /** @deprecated use `assistant_output` */
  assistant_text_preview?: string
  /** Concatenated assistant `text-delta` chunks in order (stream replay, capped). */
  model_stream_text?: string
  /**
   * Each entry matches one `session.updatePartDelta` / bus `message.part.delta` (text + reasoning).
   * Order and chunking match what the UI receives.
   */
  part_deltas?: WorkflowChatPartDeltaEntry[]
  /**
   * Time to first **user-visible** assistant text (`text-delta`), in ms from HTTP trace start (`t0`).
   * Same notion as TTFT for chat UIs. Omitted if no text was streamed.
   */
  ttft_ms?: number
  /**
   * Time to first streamed chunk from the model (`text-delta` or `reasoning-delta`), ms from HTTP trace start.
   * Useful when the model emits reasoning before visible text.
   */
  ttft_stream_ms?: number
  /** Which delta type produced `ttft_stream_ms`. */
  ttft_stream_kind?: "text" | "reasoning"
}

export type WorkflowTraceSession = {
  readonly requestId: string
  readonly startedAt: string
  readonly t0Ms: number
  /** Each entry is one line: `opencode.<business>.<method>=<ms>[|k=v,...]` */
  events: string[]
  readonly traceFilePath: string
  http: {
    method: string
    path: string
    url: string
    status?: number
  }
  opencode?: {
    directory?: string
    workspace?: string
  }
  error?: { message: string }
  /** Populated for chat HTTP handlers (user preview + LLM stream replay). */
  chat?: WorkflowChatTrace
  /** @internal model stream chunks (avoid O(n²) string += on every token) */
  _modelStreamChunks?: string[]
  _modelStreamTotal?: number
}

/**
 * Carries the HTTP workflow trace session through `AppRuntime.runPromise` (ALS does not propagate into Effect).
 */
export const WorkflowTraceSessionRef = Context.Reference<WorkflowTraceSession | undefined>(
  "@opencode/WorkflowTraceSession",
  {
    defaultValue: () => undefined,
  },
)

function seg(s: string) {
  return s.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "x"
}

function encodeDetail(detail?: Record<string, unknown>): string {
  if (!detail) return ""
  const parts: string[] = []
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined) continue
    const t = typeof v
    if (t !== "string" && t !== "number" && t !== "boolean") continue
    let s = String(v)
    if (s.length > 500) s = s.slice(0, 497) + "..."
    s = s.replace(/\|/g, "%7C").replace(/=/g, "%3D").replace(/,/g, "%2C").replace(/\n/g, "%0A")
    parts.push(`${seg(k)}=${s}`)
  }
  return parts.length ? `|${parts.join(",")}` : ""
}

/**
 * Fixed trace line: `opencode.<business>.<method>=<ms>` optional `|k=v,...` for grep / scripts.
 * Example: `opencode.http.request.enter=0|request_id=abc`
 */
export function formatTraceLine(
  business: string,
  method: string,
  ms: number,
  detail?: Record<string, unknown>,
): string {
  return `opencode.${seg(business)}.${seg(method)}=${Math.round(ms)}${encodeDetail(detail)}`
}

function appendEvent(session: WorkflowTraceSession, line: string) {
  session.events.push(line)
}

/** Record TTFT / first-stream metrics once per HTTP request (multi-round safe). */
function recordTtftOnDelta(s: WorkflowTraceSession, delta: string, kind: "text" | "reasoning") {
  if (!delta) return
  ensureChat(s)
  const ms = Math.round(performance.now() - s.t0Ms)
  if (s.chat!.ttft_stream_ms === undefined) {
    s.chat!.ttft_stream_ms = ms
    s.chat!.ttft_stream_kind = kind
    appendEvent(
      s,
      formatTraceLine("chat", "first_stream_token", ms, { kind, ttft_stream_ms: ms }),
    )
  }
  if (kind === "text" && s.chat!.ttft_ms === undefined) {
    s.chat!.ttft_ms = ms
    appendEvent(s, formatTraceLine("chat", "first_text_token", ms, { ttft_ms: ms }))
  }
}

/** Active workflow trace for this HTTP request, if any. */
export function getWorkflowTraceSession(): WorkflowTraceSession | undefined {
  return traceAls.getStore()
}

/**
 * Append one fixed-format line for the current request (inside WorkflowTraceMiddleware + traceAls.run).
 */
export function traceStep(input: { business: string; method: string; detail?: Record<string, unknown> }) {
  const s = traceAls.getStore()
  if (!s) return
  const ms = Math.round(performance.now() - s.t0Ms)
  appendEvent(s, formatTraceLine(input.business, input.method, ms, input.detail))
}

export function traceStepEffect(input: { business: string; method: string; detail?: Record<string, unknown> }) {
  return Effect.sync(() => traceStep(input))
}

/** Use inside Effect when ALS may not propagate; pass session from getWorkflowTraceSession() at sync edge. */
export function traceStepWithSession(
  session: WorkflowTraceSession | undefined,
  input: { business: string; method: string; detail?: Record<string, unknown> },
) {
  if (!session) return
  const ms = Math.round(performance.now() - session.t0Ms)
  appendEvent(session, formatTraceLine(input.business, input.method, ms, input.detail))
}

function ensureChat(s: WorkflowTraceSession) {
  if (!s.chat) s.chat = {}
}

/** Accumulate assistant text-delta without repeated string reallocation (critical for streaming perf). */
function appendModelStreamText(s: WorkflowTraceSession, delta: string) {
  if (!delta) return
  const cap = maxModelStreamChars()
  const total = s._modelStreamTotal ?? 0
  if (total >= cap) return
  let add = delta
  if (total + add.length > cap) add = add.slice(0, cap - total)
  if (!add) return
  if (!s._modelStreamChunks) s._modelStreamChunks = []
  s._modelStreamChunks.push(add)
  s._modelStreamTotal = total + add.length
}

function materializeModelStreamText(s: WorkflowTraceSession) {
  if (!s._modelStreamChunks?.length) return
  ensureChat(s)
  s.chat!.model_stream_text = s._modelStreamChunks.join("")
}

/** Summarize user prompt parts for trace (no raw file bytes; filenames only). */
export function summarizePromptPartsForTrace(parts: ReadonlyArray<{ type: string; text?: string; filename?: string }>) {
  const chunks: string[] = []
  for (const p of parts) {
    if (p.type === "text" && p.text) chunks.push(p.text)
    else if (p.type === "file")
      chunks.push(p.filename ? `[file:${p.filename}]` : "[file]")
    else chunks.push(`[${p.type}]`)
  }
  const joined = chunks.join("\n")
  const cap = maxUserInputChars()
  if (joined.length <= cap) return joined
  return `${joined.slice(0, cap - 12)}\n...[truncated]`
}

/** Called after the user message is persisted (SessionPrompt.prompt). */
export function traceChatInitFromUserMessage(
  s: WorkflowTraceSession | undefined,
  input: { sessionID: string; parts: ReadonlyArray<{ type: string; text?: string; filename?: string }> },
  user: { id: string; model: { providerID: string; modelID: string } },
) {
  if (!s) return
  ensureChat(s)
  s.chat!.session_id = input.sessionID
  s.chat!.user_message_id = user.id
  s.chat!.model = `${user.model.providerID}/${user.model.modelID}`
  const text = summarizePromptPartsForTrace(input.parts)
  s.chat!.user_input = text
  s.chat!.user_text_preview = text
}

/** Record one `message.part.delta` (after `Session.updatePartDelta`). */
export function traceRecordMessagePartDelta(
  s: WorkflowTraceSession | undefined,
  input: { messageID: string; partID: string; field: string; delta: string },
) {
  if (!s || !input.delta) return
  ensureChat(s)
  const list = (s.chat!.part_deltas ??= [])
  if (list.length >= MAX_PART_DELTA_EVENTS()) return
  const cap = PART_DELTA_CAP()
  let delta = input.delta
  if (delta.length > cap) delta = `${delta.slice(0, cap - 3)}...`
  list.push({
    ms: Math.round(performance.now() - s.t0Ms),
    message_id: input.messageID,
    part_id: input.partID,
    field: input.field,
    delta,
  })
}

/**
 * Lightweight fullStream hook: TTFT / `model_stream_text` only.
 * Per-chunk UI replay lives in `chat.part_deltas` (`traceRecordMessagePartDelta`).
 */
export function traceRecordLlmStreamEvent(s: WorkflowTraceSession | undefined, ev: LlmStreamEvent) {
  if (!s) return
  switch (ev.type) {
    case "start":
      s._modelStreamChunks = undefined
      s._modelStreamTotal = undefined
      return
    case "text-delta":
      recordTtftOnDelta(s, ev.text, "text")
      appendModelStreamText(s, ev.text)
      return
    case "reasoning-delta":
      recordTtftOnDelta(s, ev.text, "reasoning")
      return
    default:
      return
  }
}

/** Assistant plain text after each model stream completes (multi-round tool loops append). */
export function traceChatFinalizeAssistant(
  s: WorkflowTraceSession | undefined,
  assistantMessageId: string,
  fullText: string,
) {
  if (!s) return
  ensureChat(s)
  s.chat!.assistant_message_id = assistantMessageId
  const t = fullText.trim()
  if (!t) return
  const cap = maxAssistantOutputChars()
  const prev = (s.chat!.assistant_output ?? s.chat!.assistant_text_preview ?? "").trim()
  const merged = prev ? `${prev}\n\n--- round ---\n\n${t}` : t
  const out = merged.length <= cap ? merged : `${merged.slice(0, cap - 12)}\n...[truncated]`
  s.chat!.assistant_output = out
  s.chat!.assistant_text_preview = out
}

/** Same directory tier as `Global.Path.log`: `…/opencode/log` vs `…/opencode/trace`. */
export function traceDirectory() {
  return Global.Path.trace
}

function shouldSkip(pathname: string, method: string) {
  if (method === "OPTIONS") return true
  if (pathname === "/log") return true
  if (pathname === "/event" || pathname.startsWith("/event/")) return true
  if (pathname === "/global/event" || pathname.startsWith("/global/event/")) return true
  return false
}

/**
 * When `OPENCODE_WORKFLOW_TRACE` is unset, only session "chat" POSTs get a trace file
 * (one HTTP request → one JSON file). Set to `all` or `1` to trace every non-skipped route.
 * Header `x-opencode-workflow-trace: 1` forces tracing for that request.
 */
function shouldEmitTraceFile(
  pathname: string,
  method: string,
  header: (name: string) => string | undefined,
): boolean {
  if (shouldSkip(pathname, method)) return false
  const h = header("x-opencode-workflow-trace")?.toLowerCase()
  if (h === "1" || h === "all" || h === "true") return true
  const mode = process.env.OPENCODE_WORKFLOW_TRACE?.toLowerCase()
  if (mode === "all" || mode === "1" || mode === "true") return true
  if (method !== "POST") return false
  return /^\/session\/[^/]+\/(message|prompt_async|command|shell)$/.test(pathname)
}

function safeTimestampForFilename(iso: string) {
  return iso.replace(/[:.]/g, "-")
}

async function writeTraceFile(filepath: string, payload: Record<string, unknown>) {
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await fs.writeFile(filepath, JSON.stringify(payload, null, 2), "utf8")
}

/** POST …/prompt_async returns 204 before the prompt Effect finishes; skip middleware persist and call this from `runRequest(…).finally()`. */
export function workflowTracePathDefersPersist(pathname: string): boolean {
  return /\/session\/[^/]+\/prompt_async$/.test(pathname)
}

/** Never block the request path: materialize + JSON + disk run after the current turn. */
export function scheduleWorkflowTracePersist(
  session: WorkflowTraceSession,
  traceFilePath: string,
  meta: {
    requestId: string
    startedAt: string
    finishedAt: string
    durationMs: number
    finalStatus: number
  },
) {
  setImmediate(() => {
    void (async () => {
      try {
        materializeModelStreamText(session)
        const payload: Record<string, unknown> = {
          format: TRACE_FORMAT,
          request_id: meta.requestId,
          started_at: meta.startedAt,
          finished_at: meta.finishedAt,
          duration_ms: meta.durationMs,
          trace_file: traceFilePath,
          http: {
            ...session.http,
            status: meta.finalStatus,
          },
          opencode: session.opencode,
          events: session.events,
        }
        if (session.chat !== undefined) payload.chat = session.chat
        if (session.error !== undefined) payload.error = session.error
        await writeTraceFile(traceFilePath, payload)
      } catch (err) {
        log.error("workflow trace write failed", { path: traceFilePath, error: err })
      }
    })()
  })
}

export const WorkflowTraceMiddleware: MiddlewareHandler = async (c, next) => {
  const pathname = c.req.path
  const method = c.req.method
  if (shouldSkip(pathname, method)) return next()
  if (!shouldEmitTraceFile(pathname, method, (n) => c.req.header(n))) return next()

  const requestId = crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const t0Ms = performance.now()
  const filename = `trace_${requestId}_${safeTimestampForFilename(startedAt)}.json`
  const traceFilePath = path.join(traceDirectory(), filename)

  const session: WorkflowTraceSession = {
    requestId,
    startedAt,
    t0Ms,
    events: [],
    traceFilePath,
    http: {
      method,
      path: pathname,
      url: c.req.url,
    },
    opencode: {
      directory: c.req.query("directory") ?? c.req.header("x-opencode-directory"),
      workspace: c.req.query("workspace"),
    },
  }

  appendEvent(session, formatTraceLine("http", "request.enter", 0, { request_id: requestId }))
  c.header("X-OpenCode-Trace-Id", requestId)

  let status: number | null = null
  let errMessage: string | undefined

  try {
    await traceAls.run(session, async () => {
      traceStep({ business: "http", method: "chain.before_next" })
      await next()
      status = c.res.status
      session.http.status = status
      traceStep({ business: "http", method: "chain.after_next", detail: { status } })
    })
  } catch (e) {
    errMessage = e instanceof Error ? e.message : String(e)
    session.error = { message: errMessage }
    throw e
  } finally {
    const durationMs = Math.round(performance.now() - t0Ms)
    const finishedAt = new Date().toISOString()
    const finalStatus = status ?? (errMessage ? 500 : 0)

    appendEvent(
      session,
      formatTraceLine("http", "request.exit", Math.round(performance.now() - session.t0Ms), {
        status: finalStatus,
        duration_ms: durationMs,
      }),
    )

    if (!workflowTracePathDefersPersist(session.http.path)) {
      scheduleWorkflowTracePersist(session, traceFilePath, {
        requestId,
        startedAt,
        finishedAt,
        durationMs,
        finalStatus,
      })
    }
  }
}
