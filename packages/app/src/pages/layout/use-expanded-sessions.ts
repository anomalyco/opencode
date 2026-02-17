import { createEffect, createMemo, createSignal } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { persisted } from "@/utils/persist"
import { Persist } from "@/utils/persist"
import { checksum } from "@opencode-ai/util/encode"
import type { Session } from "@opencode-ai/sdk/v2/client"

const CLEANUP_DELAY = 1000

export function useExpandedSessions(
  directory: () => string,
  sessions: () => Session[],
): {
  isExpanded: (sessionId: string) => boolean
  toggleExpanded: (sessionId: string) => void
  ready: () => boolean
} {
  const storageKey = createMemo(() => {
    const dir = directory()
    const sum = checksum(dir) ?? "0"
    const head = dir.slice(0, 12) || "workspace"
    return `workspace.${head}.${sum}.expanded-sessions`
  })

  const [store, setStore, , ready] = persisted(
    Persist.global("expanded-sessions", ["expanded-sessions.v1"]),
    createStore({} as Record<string, boolean>),
  )

  const [localExpanded, setLocalExpanded] = createSignal<string[]>([])
  let cleanupTimeout: ReturnType<typeof setTimeout> | undefined

  const prefix = () => storageKey() + "."

  createEffect(() => {
    const p = prefix()
    const ids = sessions()
    if (ids.length === 0) return
    const validIds = new Set(ids.map((s) => s.id))
    const validExpanded: Record<string, boolean> = {}
    let hasStale = false

    for (const key of Object.keys(store)) {
      if (!key.startsWith(p)) continue
      const sessionId = key.slice(p.length)
      if (validIds.has(sessionId)) {
        validExpanded[key] = store[key]
      } else {
        hasStale = true
      }
    }

    if (hasStale) {
      setStore(reconcile(validExpanded))
    }
  })

  const isExpanded = (sessionId: string) => {
    if (!ready()) return localExpanded().includes(sessionId)
    return store[prefix() + sessionId] ?? false
  }

  const toggleExpanded = (sessionId: string) => {
    const key = prefix() + sessionId
    const current = isExpanded(sessionId)

    if (!ready()) {
      setLocalExpanded((prev) => (current ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]))
      return
    }

    setStore(key, !current)

    if (cleanupTimeout) clearTimeout(cleanupTimeout)
    cleanupTimeout = setTimeout(() => {
      const p = prefix()
      const ids = sessions()
      if (ids.length === 0) return
      const validIds = new Set(ids.map((s) => s.id))
      const validExpanded: Record<string, boolean> = {}
      let hasStale = false

      for (const key of Object.keys(store)) {
        if (!key.startsWith(p)) continue
        const sessionId = key.slice(p.length)
        if (validIds.has(sessionId)) {
          validExpanded[key] = store[key]
        } else {
          hasStale = true
        }
      }

      if (hasStale) {
        setStore(reconcile(validExpanded))
      }
    }, CLEANUP_DELAY)
  }

  return { isExpanded, toggleExpanded, ready }
}
