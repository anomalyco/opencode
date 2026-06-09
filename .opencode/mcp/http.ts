import { createTradeMemoryService, TradeMemoryInputError, type TradeMemoryService } from "./service"

const MAX_BODY_BYTES = readPositiveEnv("OPENCODE_TRADE_MEMORY_SERVICE_MAX_BODY_BYTES", 1024 * 1024)
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])

export function startTradeMemoryHttpServer(input?: {
  service?: TradeMemoryService
  hostname?: string
  port?: number
}) {
  const service = input?.service ?? createTradeMemoryService()
  const hostname = input?.hostname ?? process.env.OPENCODE_TRADE_MEMORY_SERVICE_HOST ?? "127.0.0.1"
  const port = input?.port ?? readPositiveEnv("OPENCODE_TRADE_MEMORY_SERVICE_PORT", 19787)

  requireTokenForRemoteHost(hostname)

  return Bun.serve({
    hostname,
    port,
    async fetch(request) {
      try {
        authorize(request)
        const url = new URL(request.url)
        const body = request.method === "GET" || request.method === "DELETE" ? undefined : await readJson(request)

        if (request.method === "GET" && url.pathname === "/health") return json(service.health())
        if (request.method === "POST" && url.pathname === "/sync") return json(service.sync(toSyncInput(body)))
        if (request.method === "POST" && url.pathname === "/handoff/context") return json(service.buildHandoffContext(toHandoffContextInput(body)))
        if (request.method === "POST" && url.pathname === "/handoff/model-switched") return json(service.markModelSwitched(toModelSwitchedInput(body)))
        if (request.method === "POST" && url.pathname === "/handoff/ack") return json(service.ackHandoff(toHandoffAckInput(body)))
        if (request.method === "POST" && url.pathname === "/notes") return json(service.storeNote(toStoreNoteInput(body)))
        if (request.method === "POST" && url.pathname === "/notes/search") return json(service.searchNotes(toSearchNotesInput(body)))
        if (request.method === "POST" && url.pathname === "/pins") return json(service.pinNote(toPinInput(body)))
        if (request.method === "GET" && url.pathname === "/pins") {
          return json(service.listPins({ limit: readLimit(url), indexDbPath: readOptionalString(url.searchParams.get("index_db_path"), "index_db_path") }))
        }
        if (request.method === "DELETE" && url.pathname.startsWith("/pins/")) {
          return json(service.unpinNote({ id: decodeURIComponent(url.pathname.slice(6)), indexDbPath: readOptionalString(url.searchParams.get("index_db_path"), "index_db_path") }))
        }
        if (request.method === "POST" && url.pathname === "/semantic/search") return json(service.semanticSearch(toSemanticSearchInput(body)))
        if (request.method === "POST" && url.pathname === "/conversations/search") return json(service.searchConversations(toSearchConversationsInput(body)))
        if (request.method === "POST" && url.pathname === "/conversations/source") return json(service.openConversationSource(toOpenConversationSourceInput(body)))
        if (request.method === "POST" && url.pathname === "/oracle/render") return json({ note: service.renderOracleNote(toRenderOracleInput(body)) })

        return json({ error: "not found" }, 404)
      } catch (error) {
        if (error instanceof HttpError) return json({ error: error.message }, error.status)
        if (error instanceof TradeMemoryInputError) return json({ error: error.message }, 400)
        console.error("[trade-memory] request failed", error)
        return json({ error: "internal error" }, 500)
      }
    },
  })
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) throw new HttpError(415, "content-type must be application/json")
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new HttpError(413, "request body too large")
  const text = await request.text()
  if (!text.trim()) throw new HttpError(400, "request body must not be empty")
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "request body too large")
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HttpError(400, "request body must be valid JSON")
  }
}

function authorize(request: Request) {
  const expected = process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN?.trim()
  if (!expected) return
  const header = request.headers.get("authorization")
  if (header === `Bearer ${expected}`) return
  throw new HttpError(401, "unauthorized")
}

function requireTokenForRemoteHost(hostname: string) {
  if (LOCAL_HOSTS.has(hostname)) return
  if (process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN?.trim()) return
  throw new Error("OPENCODE_TRADE_MEMORY_SERVICE_TOKEN is required when binding outside localhost")
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function readLimit(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? 20)
  return Number.isFinite(limit) ? limit : 20
}

function toSyncInput(input: unknown) {
  const body = readRecord(input)
  return {
    sourceDbPath: readOptionalString(body.source_db_path, "source_db_path"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
    fullResync: readOptionalBoolean(body.full_resync, "full_resync"),
  }
}

function toHandoffContextInput(input: unknown) {
  const body = readRecord(input)
  return {
    sessionID: readRequiredString(body.session_id, "session_id"),
    modelID: readOptionalString(body.model_id, "model_id"),
    maxChars: readOptionalInteger(body.max_chars, "max_chars"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toModelSwitchedInput(input: unknown) {
  const body = readRecord(input)
  return {
    sessionID: readRequiredString(body.session_id, "session_id"),
    providerID: readOptionalString(body.provider_id, "provider_id"),
    modelID: readOptionalString(body.model_id, "model_id"),
    pendingSince: readOptionalInteger(body.pending_since, "pending_since"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toHandoffAckInput(input: unknown) {
  const body = readRecord(input)
  return {
    sessionID: readRequiredString(body.session_id, "session_id"),
    modelID: readOptionalString(body.model_id, "model_id"),
    ackedAt: readOptionalInteger(body.acked_at, "acked_at"),
    expectedPendingSince: readOptionalInteger(body.expected_pending_since, "expected_pending_since"),
    expectedModelID: readOptionalString(body.expected_model_id, "expected_model_id"),
    contentHash: readOptionalString(body.content_hash, "content_hash"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toStoreNoteInput(input: unknown) {
  const body = readRecord(input)
  return {
    title: readRequiredString(body.title, "title"),
    body: readRequiredString(body.body, "body"),
    memory_type: readRequiredString(body.memory_type, "memory_type"),
    tags: readOptionalStringArray(body.tags, "tags"),
    importance: readOptionalInteger(body.importance, "importance"),
    status: readOptionalEnum(body.status, "status", ["active", "tentative", "deprecated"]),
    scope: readOptionalString(body.scope, "scope"),
    source_session_id: readOptionalString(body.source_session_id, "source_session_id"),
    source_message_ids: readOptionalStringArray(body.source_message_ids, "source_message_ids"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toSearchNotesInput(input: unknown) {
  const body = readRecord(input)
  return {
    query: readOptionalString(body.query, "query"),
    limit: readOptionalInteger(body.limit, "limit"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toPinInput(input: unknown) {
  const body = readRecord(input)
  return {
    noteID: readRequiredString(body.note_id, "note_id"),
    priority: readOptionalInteger(body.priority, "priority"),
    alwaysInclude: readOptionalBoolean(body.always_include, "always_include"),
    reason: readRequiredString(body.reason, "reason"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toSemanticSearchInput(input: unknown) {
  const body = readRecord(input)
  return {
    query: readRequiredString(body.query, "query"),
    limit: readOptionalInteger(body.limit, "limit"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toSearchConversationsInput(input: unknown) {
  const body = readRecord(input)
  return {
    query: readRequiredString(body.query, "query"),
    limit: readOptionalInteger(body.limit, "limit"),
    indexDbPath: readOptionalString(body.index_db_path, "index_db_path"),
  }
}

function toOpenConversationSourceInput(input: unknown) {
  const body = readRecord(input)
  return {
    messageID: readRequiredString(body.message_id, "message_id"),
    sourceDbPath: readOptionalString(body.source_db_path, "source_db_path"),
  }
}

function toRenderOracleInput(input: unknown) {
  return { issue: readRequiredString(readRecord(input).issue, "issue") }
}

function readRecord(input: unknown) {
  if (input && typeof input === "object") return input as Record<string, unknown>
  throw new HttpError(400, "request body must be an object")
}

function readRequiredString(input: unknown, field: string) {
  if (typeof input !== "string" || !input.trim()) throw new HttpError(400, `${field} must be a non-empty string`)
  return input
}

function readOptionalString(input: unknown, field: string): string | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== "string") throw new HttpError(400, `${field} must be a string`)
  return input
}

function readOptionalStringArray(input: unknown, field: string): string[] | undefined {
  if (input === undefined || input === null) return undefined
  if (!Array.isArray(input) || input.some((item) => typeof item !== "string")) throw new HttpError(400, `${field} must be a string array`)
  return input
}

function readOptionalBoolean(input: unknown, field: string): boolean | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== "boolean") throw new HttpError(400, `${field} must be a boolean`)
  return input
}

function readOptionalInteger(input: unknown, field: string): number | undefined {
  if (input === undefined || input === null) return undefined
  if (!Number.isInteger(input)) throw new HttpError(400, `${field} must be an integer`)
  return input as number
}

function readOptionalEnum<T extends string>(input: unknown, field: string, values: T[]): T | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== "string" || !values.includes(input as T)) throw new HttpError(400, `${field} is invalid`)
  return input as T
}

function readPositiveEnv(name: string, fallback: number) {
  const value = process.env[name]
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}
