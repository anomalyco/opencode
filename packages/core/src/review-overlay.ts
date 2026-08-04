export * as ReviewOverlay from "./review-overlay"

import { FSUtil } from "./fs-util"

// In-memory staging area for ACP review mode. While enabled, file writes are
// kept here instead of going to disk, and are later sent to the client so they
// show up in the native review UI. `entries` holds the current staged content
// (or a delete marker) per path; `pending` is the queue of writes still to send.
export type Entry = { readonly content: string } | { readonly deleted: true }

export type PendingWrite = { sessionID: string; path: string; content: string }

let enabled = false
let activeSession: string | undefined
const entries = new Map<string, Entry>()
const pending: PendingWrite[] = []
// Tracks the exact content that was successfully delivered to the client per
// path, so a later enqueueUnflushed() call in the same turn doesn't re-send a
// write that already landed (entries isn't cleared until end of turn). Only
// markFlushed() populates this — draining alone does not, so a write that was
// drained but failed to send stays eligible for a retry.
const flushedContent = new Map<string, string>()

export function setEnabled(value: boolean) {
  enabled = value
}

export function isEnabled() {
  return enabled
}

export function setActiveSession(sessionID: string | undefined) {
  activeSession = sessionID
}

export function stage(path: string, content: string) {
  const key = FSUtil.resolve(path)
  entries.set(key, { content })
  if (activeSession) pending.push({ sessionID: activeSession, path: key, content })
}

export function markDeleted(path: string) {
  entries.set(FSUtil.resolve(path), { deleted: true })
}

export function get(path: string) {
  return entries.get(FSUtil.resolve(path))
}

export function has(path: string) {
  return entries.has(FSUtil.resolve(path))
}

// Recover staged edits that were written before a session was active, so a late
// flush still sends them. Skips paths already queued, delete markers, and
// content that was successfully flushed to the client earlier in this turn.
export function enqueueUnflushed(sessionID: string) {
  const queued = new Set(pending.map((item) => item.path))
  for (const [path, entry] of entries) {
    if (!("content" in entry)) continue
    if (queued.has(path)) continue
    if (flushedContent.get(path) === entry.content) continue
    pending.push({ sessionID, path, content: entry.content })
    queued.add(path)
  }
}

// Take the queued writes to send. Draining does not mark anything as flushed;
// the caller must call markFlushed() for each write the client actually
// accepted so a rejected write can still be retried.
export function drainPendingWrites() {
  const drained = [...pending]
  pending.length = 0
  return drained
}

// Record that a write was successfully delivered to the client. `path` is the
// already-resolved key carried on the drained pending item.
export function markFlushed(path: string, content: string) {
  flushedContent.set(path, content)
}

// Drop staged state at the end of a turn but keep review mode enabled.
export function clear() {
  entries.clear()
  pending.length = 0
  flushedContent.clear()
  activeSession = undefined
}

// Full reset, including disabling review mode. Used on shutdown and in tests.
export function reset() {
  enabled = false
  activeSession = undefined
  entries.clear()
  pending.length = 0
  flushedContent.clear()
}
