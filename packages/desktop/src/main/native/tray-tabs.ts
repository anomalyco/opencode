import type { TrayAvatar } from "../../shared/tray-avatar"

// Tabs belong to client windows, not to the server's session history.
export function createTrayTabs() {
  const windows = new Map<number, { ids: readonly string[]; avatars: Record<string, TrayAvatar> }>()
  const listeners = new Set<() => void>()
  return {
    set(windowID: number, sessionIDs: readonly string[], avatars: Record<string, TrayAvatar> = {}) {
      const next = { ids: [...new Set(sessionIDs)], avatars }
      const previous = windows.get(windowID)
      if (JSON.stringify(previous) === JSON.stringify(next)) return
      windows.set(windowID, next)
      listeners.forEach((listener) => listener())
    },
    remove(windowID: number) {
      if (windows.delete(windowID)) listeners.forEach((listener) => listener())
    },
    sessions() {
      return [...new Set([...windows.values()].flatMap((window) => window.ids))]
    },
    owner(sessionID: string, preferred?: number) {
      if (preferred !== undefined && windows.get(preferred)?.ids.includes(sessionID)) return preferred
      return [...windows].find(([, window]) => window.ids.includes(sessionID))?.[0]
    },
    avatar(sessionID: string) {
      return [...windows.values()].find((window) => window.ids.includes(sessionID) && window.avatars[sessionID])
        ?.avatars[sessionID]
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const trayTabs = createTrayTabs()
