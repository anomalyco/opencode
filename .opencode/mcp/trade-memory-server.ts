import { createTradeMemoryService } from "./service"
import { startTradeMemoryHttpServer } from "./http"
import { McpServer } from "../../packages/opencode/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js"
import { StdioServerTransport } from "../../packages/opencode/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js"
import { z } from "../../packages/opencode/node_modules/zod/v4"

const service = createTradeMemoryService()
const args = new Set(process.argv.slice(2))
const httpOnly = args.has("--http")
const noHttp = args.has("--no-http")
const withHttp = httpOnly || !noHttp

if (withHttp) {
  const server = startTradeMemoryHttpServer({ service })
  console.error(`[trade-memory] http listening on http://${server.hostname}:${server.port}`)
}

if (!httpOnly) {
  const mcp = new McpServer({ name: "trade-memory-service", version: "0.1.0" })

  mcp.registerTool(
    "trade_memory_health",
    {
      description: "Read trade memory service health and canonical DB state.",
      inputSchema: { index_db_path: z.string().optional() },
    },
    async ({ index_db_path }) => toolText(JSON.stringify(service.health({ indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_sync",
    {
      description: "Sync opencode conversation data into the canonical trade memory SQLite database.",
      inputSchema: { source_db_path: z.string().optional(), index_db_path: z.string().optional(), full_resync: z.boolean().optional() },
    },
    async ({ source_db_path, index_db_path, full_resync }) =>
      toolText(JSON.stringify(service.sync({ sourceDbPath: source_db_path, indexDbPath: index_db_path, fullResync: full_resync }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_search_conversations",
    {
      description: "Search canonical trade memory conversations.",
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(20).optional(), index_db_path: z.string().optional() },
    },
    async ({ query, limit, index_db_path }) => toolText(JSON.stringify(service.searchConversations({ query, limit, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_open_conversation_source",
    {
      description: "Open a source conversation message from opencode.db.",
      inputSchema: { message_id: z.string(), source_db_path: z.string().optional() },
    },
    async ({ message_id, source_db_path }) => toolText(JSON.stringify(service.openConversationSource({ messageID: message_id, sourceDbPath: source_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_store_note",
    {
      description: "Store a curated trade memory note.",
      inputSchema: {
        title: z.string(),
        body: z.string(),
        memory_type: z.string(),
        tags: z.array(z.string()).optional(),
        importance: z.number().int().min(1).max(5).optional(),
        status: z.enum(["active", "tentative", "deprecated"]).optional(),
        scope: z.string().optional(),
        source_session_id: z.string().optional(),
        source_message_ids: z.array(z.string()).optional(),
        index_db_path: z.string().optional(),
      },
    },
    async (input) => toolText(JSON.stringify(service.storeNote({ ...input, indexDbPath: input.index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_update_note_status",
    {
      description: "Update a curated trade memory note status.",
      inputSchema: { id: z.string(), status: z.enum(["active", "tentative", "deprecated"]), index_db_path: z.string().optional() },
    },
    async ({ id, status, index_db_path }) => toolText(JSON.stringify(service.updateNoteStatus({ id, status, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_search_notes",
    {
      description: "Search curated trade memory notes.",
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(20).optional(), index_db_path: z.string().optional() },
    },
    async ({ query, limit, index_db_path }) => toolText(JSON.stringify(service.searchNotes({ query, limit, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_get_handoff_context",
    {
      description: "Build the bounded handoff block for the next model turn.",
      inputSchema: { session_id: z.string(), model_id: z.string().optional(), max_chars: z.number().int().positive().optional(), index_db_path: z.string().optional() },
    },
    async ({ session_id, model_id, max_chars, index_db_path }) =>
      toolText(JSON.stringify(service.buildHandoffContext({ sessionID: session_id, modelID: model_id, maxChars: max_chars, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_model_switched",
    {
      description: "Record a pending model-switch handoff state.",
      inputSchema: { session_id: z.string(), provider_id: z.string().optional(), model_id: z.string().optional(), index_db_path: z.string().optional() },
    },
    async ({ session_id, provider_id, model_id, index_db_path }) =>
      toolText(JSON.stringify(service.markModelSwitched({ sessionID: session_id, providerID: provider_id, modelID: model_id, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_pin_note",
    {
      description: "Pin an active trade memory note for mandatory handoff inclusion.",
      inputSchema: { note_id: z.string(), priority: z.number().int().optional(), always_include: z.boolean().optional(), reason: z.string(), index_db_path: z.string().optional() },
    },
    async ({ note_id, priority, always_include, reason, index_db_path }) =>
      toolText(JSON.stringify(service.pinNote({ noteID: note_id, priority, alwaysInclude: always_include, reason, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_unpin_note",
    {
      description: "Remove a trade memory pin by pin ID.",
      inputSchema: { id: z.string(), index_db_path: z.string().optional() },
    },
    async ({ id, index_db_path }) => toolText(JSON.stringify(service.unpinNote({ id, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_list_pins",
    {
      description: "List pinned trade memory notes.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional(), index_db_path: z.string().optional() },
    },
    async ({ limit, index_db_path }) => toolText(JSON.stringify(service.listPins({ limit, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_semantic_search",
    {
      description: "Run semantic search when qdrant is configured; otherwise return disabled state.",
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(20).optional(), index_db_path: z.string().optional() },
    },
    async ({ query, limit, index_db_path }) => toolText(JSON.stringify(service.semanticSearch({ query, limit, indexDbPath: index_db_path }), null, 2)),
  )

  mcp.registerTool(
    "trade_memory_render_oracle_note",
    {
      description: "Render a lightweight decision note template.",
      inputSchema: { issue: z.string() },
    },
    async ({ issue }) => toolText(service.renderOracleNote({ issue })),
  )

  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  console.error("[trade-memory] mcp stdio connected")
}

function toolText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  }
}
