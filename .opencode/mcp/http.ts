import { createTradeMemoryService, type TradeMemoryService } from "./service"

export function startTradeMemoryHttpServer(input?: {
  service?: TradeMemoryService
  hostname?: string
  port?: number
}) {
  const service = input?.service ?? createTradeMemoryService()
  const hostname = input?.hostname ?? process.env.OPENCODE_TRADE_MEMORY_SERVICE_HOST ?? "127.0.0.1"
  const port = input?.port ?? Number(process.env.OPENCODE_TRADE_MEMORY_SERVICE_PORT ?? 19787)

  return Bun.serve({
    hostname,
    port,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "GET" || request.method === "DELETE" ? undefined : await readJson(request)

      if (request.method === "GET" && url.pathname === "/health") return json(service.health())
      if (request.method === "POST" && url.pathname === "/sync") return json(service.sync(toSyncInput(body)))
      if (request.method === "POST" && url.pathname === "/handoff/context") return json(service.buildHandoffContext(toHandoffContextInput(body)))
      if (request.method === "POST" && url.pathname === "/handoff/model-switched") return json(service.markModelSwitched(toModelSwitchedInput(body)))
      if (request.method === "POST" && url.pathname === "/notes") return json(service.storeNote(toStoreNoteInput(body)))
      if (request.method === "POST" && url.pathname === "/notes/search") return json(service.searchNotes(toSearchNotesInput(body)))
      if (request.method === "POST" && url.pathname === "/pins") return json(service.pinNote(toPinInput(body)))
      if (request.method === "GET" && url.pathname === "/pins") return json(service.listPins({ limit: readLimit(url), indexDbPath: url.searchParams.get("index_db_path") ?? undefined }))
      if (request.method === "DELETE" && url.pathname.startsWith("/pins/")) return json(service.unpinNote({ id: decodeURIComponent(url.pathname.slice(6)), indexDbPath: url.searchParams.get("index_db_path") ?? undefined }))
      if (request.method === "POST" && url.pathname === "/semantic/search") return json(service.semanticSearch(toSemanticSearchInput(body)))
      if (request.method === "POST" && url.pathname === "/conversations/search") return json(service.searchConversations(toSearchConversationsInput(body)))
      if (request.method === "POST" && url.pathname === "/conversations/source") return json(service.openConversationSource(toOpenConversationSourceInput(body)))
      if (request.method === "POST" && url.pathname === "/oracle/render") return json({ note: service.renderOracleNote(toRenderOracleInput(body)) })

      return json({ error: "not found" }, 404)
    },
  })
}

async function readJson(request: Request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function readLimit(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? 20)
  return Number.isFinite(limit) ? limit : 20
}

function toSyncInput(input: any) {
  return {
    sourceDbPath: input?.source_db_path,
    indexDbPath: input?.index_db_path,
    fullResync: input?.full_resync,
  }
}

function toHandoffContextInput(input: any) {
  return {
    sessionID: String(input?.session_id ?? ""),
    modelID: input?.model_id,
    maxChars: typeof input?.max_chars === "number" ? input.max_chars : undefined,
    indexDbPath: input?.index_db_path,
  }
}

function toModelSwitchedInput(input: any) {
  return {
    sessionID: String(input?.session_id ?? ""),
    providerID: input?.provider_id,
    modelID: input?.model_id,
    indexDbPath: input?.index_db_path,
  }
}

function toStoreNoteInput(input: any) {
  return {
    title: String(input?.title ?? ""),
    body: String(input?.body ?? ""),
    memory_type: String(input?.memory_type ?? ""),
    tags: Array.isArray(input?.tags) ? input.tags : undefined,
    importance: typeof input?.importance === "number" ? input.importance : undefined,
    status: input?.status,
    scope: input?.scope,
    source_session_id: input?.source_session_id,
    source_message_ids: Array.isArray(input?.source_message_ids) ? input.source_message_ids : undefined,
    indexDbPath: input?.index_db_path,
  }
}

function toSearchNotesInput(input: any) {
  return {
    query: typeof input?.query === "string" ? input.query : undefined,
    limit: typeof input?.limit === "number" ? input.limit : undefined,
    indexDbPath: input?.index_db_path,
  }
}

function toPinInput(input: any) {
  return {
    noteID: String(input?.note_id ?? ""),
    priority: typeof input?.priority === "number" ? input.priority : undefined,
    alwaysInclude: typeof input?.always_include === "boolean" ? input.always_include : undefined,
    reason: String(input?.reason ?? ""),
    indexDbPath: input?.index_db_path,
  }
}

function toSemanticSearchInput(input: any) {
  return {
    query: String(input?.query ?? ""),
    limit: typeof input?.limit === "number" ? input.limit : undefined,
    indexDbPath: input?.index_db_path,
  }
}

function toSearchConversationsInput(input: any) {
  return {
    query: String(input?.query ?? ""),
    limit: typeof input?.limit === "number" ? input.limit : undefined,
    indexDbPath: input?.index_db_path,
  }
}

function toOpenConversationSourceInput(input: any) {
  return {
    messageID: String(input?.message_id ?? ""),
    sourceDbPath: input?.source_db_path,
  }
}

function toRenderOracleInput(input: any) {
  return { issue: String(input?.issue ?? "") }
}
