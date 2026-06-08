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
// flush still sends them. Skips paths already queued and delete markers.
export function enqueueUnflushed(sessionID: string) {
  const queued = new Set(pending.map((item) => item.path))
  for (const [path, entry] of entries) {
    if (!("content" in entry)) continue
    if (queued.has(path)) continue
    pending.push({ sessionID, path, content: entry.content })
    queued.add(path)
  }
}

export function drainPendingWrites() {
  const drained = [...pending]
  pending.length = 0
  return drained
}

// Drop staged state at the end of a turn but keep review mode enabled.
export function clear() {
  entries.clear()
  pending.length = 0
  activeSession = undefined
}

// Full reset, including disabling review mode. Used on shutdown and in tests.
export function reset() {
  enabled = false
  activeSession = undefined
  entries.clear()
  pending.length = 0
}
