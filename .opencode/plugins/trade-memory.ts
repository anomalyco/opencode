import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { openDatabase, resolveIndexDbPath } from "../trade-memory-core/db"
import { storeMemoryNote, searchMemoryNotes, updateMemoryNoteStatus } from "../trade-memory-core/notes"
import { decodeStringArray, runConversationSearch, truncate } from "../trade-memory-core/search"
import { ensureIndexSchema } from "../trade-memory-core/schema"
import { openTradeConversationSource, syncTradeMemoryNow } from "../trade-memory-core/sync"
import { NOTE_STATUSES } from "../trade-memory-core/types"

const AUTO_SYNC_DELAY_MS = Number(process.env.OPENCODE_TRADE_AUTO_SYNC_DELAY_MS ?? 4000)
const AUTO_SYNC_MIN_INTERVAL_MS = Number(process.env.OPENCODE_TRADE_AUTO_SYNC_MIN_INTERVAL_MS ?? 15000)

export default (async () => {
  let autoSyncTimer: ReturnType<typeof setTimeout> | undefined
  let lastAutoSyncStartedAt = 0
  let pendingAutoSync: { fullResync: boolean; reason: string } | undefined
  let runningAutoSync: Promise<void> | undefined

  const scheduleAutoSync = (input: { fullResync?: boolean; reason: string; delayMs?: number }) => {
    const nextDelay = input.delayMs ?? AUTO_SYNC_DELAY_MS
    const fullResync = input.fullResync ?? false
    pendingAutoSync = pendingAutoSync
      ? { fullResync: pendingAutoSync.fullResync || fullResync, reason: `${pendingAutoSync.reason}, ${input.reason}` }
      : { fullResync, reason: input.reason }
    if (autoSyncTimer) clearTimeout(autoSyncTimer)
    const waitMs = Math.max(nextDelay, AUTO_SYNC_MIN_INTERVAL_MS - (Date.now() - lastAutoSyncStartedAt), 0)
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = undefined
      void flushAutoSync()
    }, waitMs)
  }

  const flushAutoSync = () => {
    if (runningAutoSync) return runningAutoSync
    if (!pendingAutoSync) return Promise.resolve()
    const job = pendingAutoSync
    pendingAutoSync = undefined
    lastAutoSyncStartedAt = Date.now()
    runningAutoSync = Promise.resolve()
      .then(() => syncTradeMemoryNow({ fullResync: job.fullResync }))
      .catch((error) => {
        console.warn(`[trade-memory] auto sync failed (${job.reason})`, error)
      })
      .finally(() => {
        runningAutoSync = undefined
        if (pendingAutoSync) void flushAutoSync()
      })
    return runningAutoSync
  }

  return {
    dispose: async () => {
      if (autoSyncTimer) clearTimeout(autoSyncTimer)
    },
    config: async () => {
      scheduleAutoSync({ reason: "startup", delayMs: 0 })
    },
    event: async (input) => {
      scheduleAutoSync({ reason: `event:${input.event.type}` })
    },
    "chat.message": async () => {
      scheduleAutoSync({ reason: "chat.message" })
    },
    "tool.execute.after": async (input) => {
      if (input.tool === "sync_trade_memory") return
      scheduleAutoSync({ reason: `tool.execute.after:${input.tool}` })
    },
    tool: {
      // Core retrieval path: sync, search, and source inspection.
      sync_trade_memory: tool({
        description:
          "Sync user messages and assistant final text from opencode.db into the external trade memory SQLite index.",
        args: {
          source_db_path: tool.schema.string().optional().describe("Optional path to the source opencode.db."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
          full_resync: tool.schema.boolean().optional().describe("Force a full resync and stale reconciliation."),
        },
        async execute(args) {
          const result = syncTradeMemoryNow({
            sourceDbPath: args.source_db_path,
            indexDbPath: args.index_db_path,
            fullResync: args.full_resync,
          })
          return [
            `sync_run: ${result.syncRunID}`,
            `synced: ${result.count} messages`,
            `sync_mode: ${result.fullResync ? "full" : "incremental"}`,
            `source_mode: ${result.sourceMode}`,
            `source_db: ${result.sourceDbPath}`,
            `index_db: ${result.indexDbPath}`,
            "indexed_roles: user, assistant(text only)",
          ].join("\n")
        },
      }),
      search_trade_conversations: tool({
        description:
          "Search the external trade memory full-text index for prior user messages and assistant final text.",
        args: {
          query: tool.schema.string().describe("FTS query string. Use plain keywords unless you need FTS operators."),
          limit: tool.schema.number().int().min(1).max(20).optional().describe("Maximum number of hits."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = resolveIndexDbPath(args.index_db_path)
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const limit = args.limit ?? 8
            const result = runConversationSearch(indexDb, args.query, limit)
            if (!result.rows.length) return result.warning ? `${result.warning}\nno conversation hits for: ${args.query}` : `no conversation hits for: ${args.query}`
            const body = result.rows
              .map((row, index) => {
                return [
                  `${index + 1}. [${row.role}] session=${row.session_id} seq=${row.seq} created_at=${row.created_at}`,
                  `message_id: ${row.message_id}`,
                  `snippet: ${row.snippet}`,
                ].join("\n")
              })
              .join("\n\n")
            return result.warning ? `${result.warning}\n${body}` : body
          } finally {
            indexDb.close(false)
          }
        },
      }),
      open_trade_conversation_source: tool({
        description:
          "Open one indexed source message from opencode.db to inspect the original user text or assistant final text.",
        args: {
          message_id: tool.schema.string().describe("Message ID from search_trade_conversations results."),
          source_db_path: tool.schema.string().optional().describe("Optional path to the source opencode.db."),
        },
        async execute(args) {
          const result = openTradeConversationSource({ sourceDbPath: args.source_db_path, messageID: args.message_id })
          if (result.kind === "not-found") return `source message not found: ${args.message_id}`
          if (result.kind === "not-indexed") return `source message is not indexed content: ${args.message_id}`
          return [
            `role: ${result.source.role}`,
            `session_id: ${result.source.sessionID}`,
            `message_id: ${result.source.messageID}`,
            `seq: ${result.source.seq}`,
            `created_at: ${result.source.createdAt}`,
            "text:",
            result.source.text,
          ].join("\n")
        },
      }),
      // Optional curation path: useful for explicit notes, but not required for normal operation.
      store_trade_memory_note: tool({
        description:
          "Store a curated memory note for a decision, rejection reason, unresolved issue, or Oracle note.",
        args: {
          title: tool.schema.string().min(1).describe("Short title for the memory note."),
          body: tool.schema.string().min(1).describe("The note body to preserve."),
          memory_type: tool.schema.string().min(1).describe("Examples: decision, rejection, risk, oracle-note, unresolved."),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Optional tags."),
          importance: tool.schema.number().int().min(1).max(5).optional().describe("Importance from 1 to 5."),
          status: tool.schema.enum(NOTE_STATUSES).optional().describe("active, tentative, or deprecated."),
          scope: tool.schema.string().optional().describe("Optional scope such as global, project, phase1, oracle."),
          source_session_id: tool.schema.string().optional().describe("Optional source session ID."),
          source_message_ids: tool.schema.array(tool.schema.string()).optional().describe("Optional source message IDs."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = resolveIndexDbPath(args.index_db_path)
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const result = storeMemoryNote(indexDb, args)

            return [
              `stored memory note: ${result.id}`,
              `title: ${args.title}`,
              `status: ${result.status}`,
              `index_db: ${indexDbPath}`,
            ].join("\n")
          } finally {
            indexDb.close(false)
          }
        },
      }),
      update_trade_memory_note_status: tool({
        description: "Update the status of an existing memory note to active, tentative, or deprecated.",
        args: {
          id: tool.schema.string().min(1).describe("Memory note ID."),
          status: tool.schema.enum(NOTE_STATUSES).describe("New status for the memory note."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = resolveIndexDbPath(args.index_db_path)
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const updated = updateMemoryNoteStatus(indexDb, args.id, args.status)
            if (!updated) return `memory note not found: ${args.id}`
            return [`updated memory note: ${args.id}`, `status: ${args.status}`, `index_db: ${indexDbPath}`].join("\n")
          } finally {
            indexDb.close(false)
          }
        },
      }),
      search_trade_memory_notes: tool({
        description:
          "Search curated memory notes by keywords, with recency fallback when the query is empty.",
        args: {
          query: tool.schema.string().optional().describe("FTS query string. Leave empty to list recent notes."),
          limit: tool.schema.number().int().min(1).max(20).optional().describe("Maximum number of notes."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = resolveIndexDbPath(args.index_db_path)
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const result = searchMemoryNotes(indexDb, args.query, args.limit ?? 8)
            const rows = result.rows
            if (!rows.length) {
              if (Array.isArray(result.result)) {
                const message = args.query?.trim() ? `no memory note hits for: ${args.query}` : "no memory notes stored"
                return [`index_db: ${indexDbPath}`, message].join("\n")
              }
              const message = result.result.warning
                ? `${result.result.warning}\nno memory note hits for: ${args.query}`
                : `no memory note hits for: ${args.query}`
              return [`index_db: ${indexDbPath}`, message].join("\n")
            }
            const body = rows
              .map((row, index) => {
                const tags = decodeStringArray(row.tags).join(", ") || "-"
                const sourceMessageIDs = decodeStringArray(row.source_message_ids).join(", ") || "-"
                return [
                  `${index + 1}. ${row.title}`,
                  `id: ${row.id}`,
                  `type: ${row.memory_type} status: ${row.status} importance: ${row.importance} scope: ${row.scope}`,
                  `tags: ${tags}`,
                  `source_session_id: ${row.source_session_id ?? "-"}`,
                  `source_message_ids: ${sourceMessageIDs}`,
                  `body: ${truncate(row.body, 320)}`,
                ].join("\n")
              })
              .join("\n\n")
            const message = !Array.isArray(result.result) && result.result.warning ? `${result.result.warning}\n${body}` : body
            return [`index_db: ${indexDbPath}`, message].join("\n")
          } finally {
            indexDb.close(false)
          }
        },
      }),
      render_trade_oracle_note: tool({
        description: "Render the lightweight Decision Note template for a high-risk decision.",
        args: {
          issue: tool.schema.string().min(1).describe("Decision issue to analyze."),
        },
        async execute(args) {
          return [
            "# Decision Note",
            "",
            "## Issue",
            args.issue,
            "",
            "## Context",
            "- Background:",
            "- Constraints:",
            "",
            "## Options",
            "1. ",
            "2. ",
            "",
            "## Recommendation",
            "- Proposed option:",
            "- Why now:",
            "",
            "## Risks",
            "- ",
            "",
            "## Unknowns",
            "- ",
            "",
            "## Rejected Options",
            "- ",
            "",
            "## Human Approval",
            "- Required: yes/no",
            "",
            "## Next Action",
            "- ",
          ].join("\n")
        },
      }),
    },
  }
}) satisfies Plugin
