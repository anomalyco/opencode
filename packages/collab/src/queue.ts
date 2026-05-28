/**
 * Prompt Queue engine — pure in-memory logic for scheduling LLM execution.
 *
 * Two modes per Collab Session:
 *   fifo — prompts execute in server-arrival order
 *   vote — participants vote; highest score wins, earliest timestamp breaks ties
 *
 * Database operations are injected via CollabDB so this file has no direct
 * SQLite dependency (the concrete impl lives in packages/opencode/src/collab/).
 */

import { collabId } from "./id"
import type { PromptSuggestion } from "./types"
import type { CollabDB } from "./db"

// Per-session execution lock: true = LLM currently running
const locks = new Map<string, boolean>()

// Injected: DB adapter per session
const dbs = new Map<string, CollabDB>()

// Injected: callback to actually run a prompt through the LLM pipeline
const executors = new Map<string, (suggestion: PromptSuggestion) => Promise<void>>()

export function registerSession(collabSessionId: string, db: CollabDB, executor: (s: PromptSuggestion) => Promise<void>) {
  dbs.set(collabSessionId, db)
  executors.set(collabSessionId, executor)
}

export function unregisterSession(collabSessionId: string) {
  dbs.delete(collabSessionId)
  executors.delete(collabSessionId)
  locks.delete(collabSessionId)
}

// ── FIFO: Driver submits / approves directly ───────────────────────────────────

export function enqueue(
  collabSessionId: string,
  content: string,
  authorGithubId: number,
  authorGithubLogin: string,
  model?: string,
  agent?: string,
  variant?: string,
): PromptSuggestion {
  const db = _db(collabSessionId)
  const suggestion = _insert(db, collabSessionId, content, authorGithubId, authorGithubLogin, "approved", model, agent, variant)
  _scheduleNext(collabSessionId)
  return suggestion
}

// ── Vote Pool: submit to pool (status = pending) ───────────────────────────────

export function submitToPool(
  collabSessionId: string,
  content: string,
  authorGithubId: number,
  authorGithubLogin: string,
  model?: string,
  agent?: string,
  variant?: string,
): PromptSuggestion {
  return _insert(_db(collabSessionId), collabSessionId, content, authorGithubId, authorGithubLogin, "pending", model, agent, variant)
}

export function castVote(
  collabSessionId: string,
  suggestionId: string,
  _voterLogin: string,
): { newScore: number } {
  return _db(collabSessionId).incrementVoteScore(suggestionId)
}

/** Driver resolves the vote pool — winner executes, losers are rejected. */
export function resolvePool(collabSessionId: string): PromptSuggestion | null {
  const db = _db(collabSessionId)
  const pending = db.getPendingPool(collabSessionId)
  if (pending.length === 0) return null

  // Sort: highest voteScore first, then earliest createdAt
  const sorted = [...pending].sort((a, b) =>
    b.voteScore !== a.voteScore ? b.voteScore - a.voteScore : a.createdAt.getTime() - b.createdAt.getTime(),
  )
  const winner = sorted[0]!

  db.updateSuggestionStatus(winner.id, "approved")
  for (const loser of sorted.slice(1)) {
    db.updateSuggestionStatus(loser.id, "rejected")
  }

  _scheduleNext(collabSessionId)
  return db.getSuggestion(winner.id)
}

// ── Suggestion approval / rejection (FIFO mode from Contributor suggestions) ──

export function approveSuggestion(collabSessionId: string, suggestionId: string): PromptSuggestion | null {
  const db = _db(collabSessionId)
  db.updateSuggestionStatus(suggestionId, "approved")
  const suggestion = db.getSuggestion(suggestionId)
  if (suggestion) _scheduleNext(collabSessionId)
  return suggestion
}

export function rejectSuggestion(collabSessionId: string, suggestionId: string): void {
  _db(collabSessionId).updateSuggestionStatus(suggestionId, "rejected")
}

// ── Queue state ────────────────────────────────────────────────────────────────

export function getQueue(collabSessionId: string): PromptSuggestion[] {
  return _db(collabSessionId).getApprovedQueue(collabSessionId)
}

// ── Internals ──────────────────────────────────────────────────────────────────

function _db(collabSessionId: string): CollabDB {
  const db = dbs.get(collabSessionId)
  if (!db) throw new Error(`No DB registered for collab session ${collabSessionId}`)
  return db
}

function _insert(
  db: CollabDB,
  collabSessionId: string,
  content: string,
  authorGithubId: number,
  authorGithubLogin: string,
  status: "pending" | "approved",
  model?: string,
  agent?: string,
  variant?: string,
): PromptSuggestion {
  const id = collabId("sg")
  const now = Date.now()
  db.insertSuggestion({ id, collabSessionId, content, authorGithubId, authorGithubLogin, status, createdAt: now, model, agent, variant })
  return {
    id,
    collabSessionId,
    authorGithubId,
    authorGithubLogin,
    content,
    status,
    voteScore: 0,
    votes: [],
    createdAt: new Date(now),
    model,
    agent,
    variant,
  }
}

function _scheduleNext(collabSessionId: string) {
  if (locks.get(collabSessionId)) return
  const executor = executors.get(collabSessionId)
  const db = dbs.get(collabSessionId)
  if (!executor || !db) return

  const queue = db.getApprovedQueue(collabSessionId)
  const next = queue[0]
  if (!next) return

  locks.set(collabSessionId, true)
  void executor(next)
    .catch(() => {})
    .finally(() => {
      locks.set(collabSessionId, false)
      const remaining = db.getApprovedQueue(collabSessionId)
      if (remaining.length > 0) _scheduleNext(collabSessionId)
    })
}
