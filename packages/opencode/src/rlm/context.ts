/**
 * RLM Context Manager — persistent, always-on context memory.
 *
 * Stores every message (user, assistant, tool calls, tool results, sub-agents)
 * as structured JSON in the REPL sandbox AND on disk via Storage.
 *
 * The agent can query this context programmatically via the context_query tool,
 * running JS code in the REPL sandbox against the full `context` array.
 *
 * On session load, context is restored from disk and re-injected into the REPL.
 * On compaction, the full context history is included in the summary so nothing
 * is lost.
 *
 * Lifecycle:
 * - init(sessionID) — called when a session starts or loads
 * - append(sessionID, entries) — called after each LLM step / message
 * - snapshot(sessionID) — returns the full context array (for compaction)
 * - execute(sessionID, code) — runs JS against the context REPL
 * - persist(sessionID) — saves to disk
 * - restore(sessionID) — loads from disk, re-injects into REPL
 * - cleanup(sessionID) — frees memory
 */

import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { LocalREPL } from "./environment"
import type { LLMQueryHandler, LLMQueryBatchedHandler } from "./environment"
import type { REPLResult } from "./types"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"

const log = Log.create({ service: "rlm-context" })

// ============================================================
// Context Entry — the structured messages stored in the REPL
// ============================================================

export interface ContextEntry {
  role: "system" | "user" | "assistant" | "tool-call" | "tool-result" | "sub-agent"
  content: string
  /** For tool-call and tool-result entries */
  toolName?: string
  toolCallId?: string
  /** Timestamp when this entry was recorded */
  time: number
  /** Session ID of the sub-agent (for sub-agent entries) */
  sourceSessionID?: string
}

// ============================================================
// Per-session state
// ============================================================

interface SessionContext {
  repl: LocalREPL
  entries: ContextEntry[]
  dirty: boolean
}

const sessions = new Map<string, SessionContext>()
/** Maps child sessionID -> parent sessionID for shared context */
const aliases = new Map<string, string>()

function resolve(sessionID: string): string {
  return aliases.get(sessionID) ?? sessionID
}

// ============================================================
// Storage key
// ============================================================

function storageKey(sessionID: string): string[] {
  return ["rlm_context", sessionID]
}

// ============================================================
// LLM Query handlers (no-op defaults — the tool doesn't need sub-LLM)
// ============================================================

const noopQuery: LLMQueryHandler = async () => "Error: llm_query not available in context_query mode"
const noopBatchedQuery: LLMQueryBatchedHandler = async (prompts) =>
  prompts.map(() => "Error: llm_query_batched not available in context_query mode")

// ============================================================
// Public API
// ============================================================

/**
 * Initialize context for a session. Creates REPL, restores from disk if exists.
 */
export async function init(sessionID: string): Promise<void> {
  const id = resolve(sessionID)
  if (sessions.has(id)) return

  log.info("init", { sessionID: id })

  const repl = new LocalREPL({
    llmQueryHandler: noopQuery,
    llmQueryBatchedHandler: noopBatchedQuery,
    executionTimeoutMs: 10_000,
  })
  await repl.start()

  const ctx: SessionContext = {
    repl,
    entries: [],
    dirty: false,
  }
  sessions.set(id, ctx)

  // Try restoring from disk
  await restore(id)

  // Sync entries into REPL
  await syncToRepl(ctx)
}

/**
 * Ensure context is initialized for a session, lazy init if needed.
 */
export async function ensure(sessionID: string): Promise<SessionContext> {
  const id = resolve(sessionID)
  if (!sessions.has(id)) await init(id)
  return sessions.get(id)!
}

/**
 * Append context entries for a session. Auto-persists.
 */
export async function append(sessionID: string, entries: ContextEntry[]): Promise<void> {
  const id = resolve(sessionID)
  const ctx = await ensure(id)
  ctx.entries.push(...entries)
  ctx.dirty = true
  await syncToRepl(ctx)
  await persist(id)
}

/**
 * Get the full context snapshot (for compaction summaries).
 */
export async function snapshot(sessionID: string): Promise<ContextEntry[]> {
  const id = resolve(sessionID)
  const ctx = await ensure(id)
  return [...ctx.entries]
}

/**
 * Execute JavaScript code against the context REPL.
 * The `context` variable contains the full ContextEntry[] array.
 */
export async function execute(sessionID: string, code: string): Promise<REPLResult> {
  const id = resolve(sessionID)
  const ctx = await ensure(id)
  return ctx.repl.executeCode(code)
}

/**
 * Alias a child session to share the parent's context.
 * Used for sub-agent tasks.
 */
export function alias(childID: string, parentID: string): void {
  log.info("alias", { childID, parentID })
  aliases.set(childID, resolve(parentID))
}

/**
 * Persist context to disk via Storage.
 */
export async function persist(sessionID: string): Promise<void> {
  const id = resolve(sessionID)
  const ctx = sessions.get(id)
  if (!ctx || !ctx.dirty) return

  log.info("persist", { sessionID: id, entries: ctx.entries.length })
  await Storage.write(storageKey(id), ctx.entries)
  ctx.dirty = false
}

/**
 * Restore context from disk. Merges into existing entries if any.
 */
async function restore(sessionID: string): Promise<void> {
  const ctx = sessions.get(sessionID)
  if (!ctx) return

  try {
    const stored = await Storage.read<ContextEntry[]>(storageKey(sessionID))
    if (Array.isArray(stored) && stored.length > 0) {
      log.info("restore", { sessionID, entries: stored.length })
      ctx.entries = stored
    }
  } catch {
    // No stored context — fresh session
  }
}

/**
 * Sync the entries array into the REPL as the `context` variable.
 */
async function syncToRepl(ctx: SessionContext): Promise<void> {
  await ctx.repl.executeCode(`context = ${JSON.stringify(ctx.entries)}`)
}

/**
 * Get the number of context entries for a session.
 */
export async function count(sessionID: string): Promise<number> {
  const id = resolve(sessionID)
  const ctx = sessions.get(id)
  return ctx?.entries.length ?? 0
}

/**
 * Clean up a session's context. Persists before cleanup.
 */
export async function cleanup(sessionID: string): Promise<void> {
  // Handle alias cleanup
  if (aliases.has(sessionID)) {
    aliases.delete(sessionID)
    return
  }

  const ctx = sessions.get(sessionID)
  if (!ctx) return

  log.info("cleanup", { sessionID })
  await persist(sessionID)
  await ctx.repl.cleanup()
  sessions.delete(sessionID)
}

/**
 * Clean up all sessions. Called on process exit.
 */
export async function cleanupAll(): Promise<void> {
  aliases.clear()
  for (const [id, ctx] of sessions) {
    try {
      await persist(id)
      await ctx.repl.cleanup()
    } catch {
      // best effort
    }
  }
  sessions.clear()
}

// ============================================================
// Helper: extract context entries from messages
// ============================================================

/**
 * Convert a MessageV2.WithParts into ContextEntry[] for appending.
 * Handles user messages, assistant text, tool calls, tool results.
 */
export function fromMessage(msg: {
  info: { role: string; id: string; sessionID: string; time: { created: number } }
  parts: Array<{
    type: string
    text?: string
    tool?: string
    callID?: string
    state?: { status: string; input?: unknown; output?: unknown }
    prompt?: string
    description?: string
  }>
}): ContextEntry[] {
  const entries: ContextEntry[] = []
  const time = msg.info.time.created

  if (msg.info.role === "user") {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        entries.push({ role: "user", content: part.text, time })
      }
      if (part.type === "subtask" && part.prompt) {
        entries.push({
          role: "sub-agent",
          content: `Sub-task: ${part.description ?? part.prompt}`,
          time,
          sourceSessionID: msg.info.sessionID,
        })
      }
    }
  }

  if (msg.info.role === "assistant") {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        entries.push({ role: "assistant", content: part.text, time })
      }
      if (part.type === "tool") {
        if (part.state?.status === "completed" || part.state?.status === "error") {
          entries.push({
            role: "tool-call",
            content: typeof part.state.input === "string"
              ? part.state.input
              : JSON.stringify(part.state.input ?? {}),
            toolName: part.tool,
            toolCallId: part.callID,
            time,
          })
          entries.push({
            role: "tool-result",
            content: typeof part.state.output === "string"
              ? part.state.output?.slice(0, 5000) ?? ""
              : JSON.stringify(part.state.output ?? {}).slice(0, 5000),
            toolName: part.tool,
            toolCallId: part.callID,
            time,
          })
        }
      }
    }
  }

  return entries
}

// ============================================================
// Events
// ============================================================

export const Event = {
  Updated: BusEvent.define(
    "rlm.context.updated",
    z.object({
      sessionID: z.string(),
      count: z.number(),
    }),
  ),
}

// ============================================================
// Init hook for session deletion cleanup
// ============================================================

let initialized = false

export function initGlobal(): void {
  if (initialized) return
  initialized = true

  Bus.subscribe(
    BusEvent.define("session.deleted", z.object({ info: z.object({ id: z.string() }).passthrough() })),
    async (event) => {
      await cleanup(event.properties.info.id)
    },
  )

  process.on("exit", () => {
    // Synchronous best-effort cleanup
    for (const [, ctx] of sessions) {
      try {
        ctx.repl.cleanup()
      } catch {
        // best effort
      }
    }
    sessions.clear()
    aliases.clear()
  })
}
