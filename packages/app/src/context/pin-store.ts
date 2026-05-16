import { createSignal } from "solid-js"

const PIN_STORAGE_KEY = "opencode_pinned_sessions"

function loadPinned(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) ?? "[]")
  } catch {
    return []
  }
}

function savePinned(pinned: string[]) {
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinned))
}

const [pinnedIds, setPinnedIds] = createSignal<string[]>(loadPinned())

export function usePinned() {
  return { pinnedIds }
}

export function isPinned(sessionId: string): boolean {
  return pinnedIds().includes(sessionId)
}

export function togglePin(sessionId: string) {
  setPinnedIds((prev) => {
    const next = prev.includes(sessionId)
      ? prev.filter((id) => id !== sessionId)
      : [...prev, sessionId]
    savePinned(next)
    return [...next]
  })
}

export function sortByPinned<T extends { id: string }>(items: T[]): T[] {
  const pinned = pinnedIds()
  return [...items].sort((a, b) => {
    const aPinned = pinned.includes(a.id)
    const bPinned = pinned.includes(b.id)
    if (aPinned && !bPinned) return -1
    if (!aPinned && bPinned) return 1
    return 0
  })
}
