import { createSignal, createEffect } from "solid-js"

const KEY = "opencode:pinned-sessions"

function loadPinned(): string[] {
  try {
    const data = localStorage.getItem(KEY)
    if (data) return JSON.parse(data)
  } catch (err) {}
  return []
}

const [pinnedSessions, setPinnedSessions] = createSignal<string[]>(loadPinned())

createEffect(() => {
  localStorage.setItem(KEY, JSON.stringify(pinnedSessions()))
})

export function isSessionPinned(sessionId: string) {
  return pinnedSessions().includes(sessionId)
}

export function toggleSessionPinned(sessionId: string) {
  setPinnedSessions((prev) => {
    if (prev.includes(sessionId)) return prev.filter((id) => id !== sessionId)
    return [...prev, sessionId]
  })
}

export function getPinnedSessions() {
  return pinnedSessions()
}
