/**
 * RLM REPL Manager - Session-scoped REPL lifecycle management.
 *
 * Manages shared LocalREPL instances tied to sessions. Sub-agents spawned
 * from a parent session share the same REPL — each sub-agent's findings
 * are stored as variables, so later sub-agents can reference earlier results.
 *
 * Also manages session-level RLM activation state (rlmActive toggle).
 *
 * Lifecycle:
 * - REPL created lazily on first sub-agent spawn (via getOrCreate)
 * - Cleaned up on session deletion (Session.Event.Deleted)
 * - Safety cleanup on process exit
 */

import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import { LocalREPL } from "./environment"
import type { LocalREPLOptions } from "./environment"
import z from "zod"

const log = Log.create({ service: "rlm-repl-manager" })

// ============================================================
// Shared REPL instances — one per session
// ============================================================

const repls = new Map<string, LocalREPL>()
/** Maps child sessionID → parent sessionID for aliased REPLs */
const aliases = new Map<string, string>()

/**
 * Get or create a shared REPL for a session.
 * If the session already has a REPL, returns it.
 * Otherwise creates a new one with the provided options and starts it.
 */
export async function getOrCreate(
  sessionID: string,
  options: LocalREPLOptions,
): Promise<LocalREPL> {
  const existing = repls.get(sessionID)
  if (existing) return existing

  log.info("repl.create", { sessionID })
  const repl = new LocalREPL(options)
  await repl.start()
  repls.set(sessionID, repl)
  return repl
}

/**
 * Get a shared REPL for a session, if one exists.
 */
export function get(sessionID: string): LocalREPL | undefined {
  return repls.get(sessionID)
}

/**
 * Alias a child session to a parent's REPL.
 * Both sessionIDs will resolve to the same REPL instance.
 * Cleanup of the alias does NOT destroy the underlying REPL —
 * only cleanup of the original (parent) sessionID does.
 */
export function alias(childID: string, parentID: string): void {
  const repl = repls.get(parentID)
  if (!repl) return
  log.info("repl.alias", { childID, parentID })
  aliases.set(childID, parentID)
  repls.set(childID, repl)
}

/**
 * Clean up and remove a session's shared REPL.
 * If this sessionID is an alias, only removes the alias (not the REPL).
 */
export async function cleanup(sessionID: string): Promise<void> {
  if (aliases.has(sessionID)) {
    log.info("repl.cleanup.alias", { sessionID })
    aliases.delete(sessionID)
    repls.delete(sessionID)
    return
  }
  const repl = repls.get(sessionID)
  if (!repl) return
  log.info("repl.cleanup", { sessionID })
  await repl.cleanup()
  repls.delete(sessionID)
}

/**
 * Clean up all REPLs. Called on process exit as safety net.
 */
async function cleanupAll(): Promise<void> {
  aliases.clear()
  // Deduplicate — aliased entries share the same instance
  const seen = new Set<LocalREPL>()
  for (const [sessionID, repl] of repls) {
    if (seen.has(repl)) {
      repls.delete(sessionID)
      continue
    }
    seen.add(repl)
    try {
      await repl.cleanup()
    } catch {
      // best effort
    }
    repls.delete(sessionID)
  }
}

// ============================================================
// Session-level RLM activation state
// ============================================================

const active = new Map<string, boolean>()

/** Check if RLM is active for a session */
export function isActive(sessionID: string): boolean {
  return active.get(sessionID) ?? false
}

/** Toggle RLM active state for a session. Returns the new state. */
export function toggle(sessionID: string): boolean {
  const next = !isActive(sessionID)
  active.set(sessionID, next)
  log.info("rlm.toggle", { sessionID, active: next })
  Bus.publish(Event.Toggled, { sessionID, active: next })
  return next
}

/** Activate RLM for a session */
export function activate(sessionID: string): void {
  active.set(sessionID, true)
  log.info("rlm.activate", { sessionID })
  Bus.publish(Event.Toggled, { sessionID, active: true })
}

/** Deactivate RLM for a session */
export function deactivate(sessionID: string): void {
  active.set(sessionID, false)
  log.info("rlm.deactivate", { sessionID })
  Bus.publish(Event.Toggled, { sessionID, active: false })
}

// ============================================================
// Events
// ============================================================

export const Event = {
  Toggled: BusEvent.define(
    "rlm.toggled",
    z.object({
      sessionID: z.string(),
      active: z.boolean(),
    }),
  ),
}

// ============================================================
// Cleanup on session deletion + process exit
// ============================================================

let initialized = false

export function init(): void {
  if (initialized) return
  initialized = true

  // Clean up REPL when session is deleted
  Bus.subscribe(
    // Using the event type string directly to avoid circular imports
    // with Session module
    BusEvent.define("session.deleted", z.object({ info: z.object({ id: z.string() }).passthrough() })),
    async (event) => {
      const sessionID = event.properties.info.id
      await cleanup(sessionID)
      active.delete(sessionID)
      aliases.delete(sessionID)
    },
  )

  // Safety net — cleanup all on process exit
  process.on("exit", () => {
    // Can't await in exit handler, but cleanup() nulls out the vm context
    // which is synchronous enough for GC
    const seen = new Set<LocalREPL>()
    for (const [, repl] of repls) {
      if (seen.has(repl)) continue
      seen.add(repl)
      try {
        repl.cleanup()
      } catch {
        // best effort
      }
    }
    repls.clear()
    aliases.clear()
    active.clear()
  })
}
