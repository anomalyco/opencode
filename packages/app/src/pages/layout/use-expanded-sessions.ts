import { createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { persisted } from "@/utils/persist"
import { Persist } from "@/utils/persist"
import { checksum } from "@opencode-ai/util/encode"
import type { Session } from "@opencode-ai/sdk/v2/client"

export function useExpandedSessions(
  directory: () => string,
  sessions: () => Session[],
): {
  expanded: (sessionId: string) => boolean
  toggle: (sessionId: string) => void
} {
  const storageKey = createMemo(() => {
    const dir = directory()
    const sum = checksum(dir)
    if (!sum) throw new Error("Failed to generate checksum for directory")
    const head = dir.slice(0, 12) || "workspace"
    return `workspace.${head}.${sum}.expanded-sessions`
  })

  const [store, setStore, , ready] = persisted(
    Persist.global("expanded-sessions", ["expanded-sessions.v1"]),
    createStore({} as Record<string, boolean>),
  )

  const [local, setLocal] = createSignal<string[]>([])
  const [migrated, setMigrated] = createSignal(false)

  const prefix = () => storageKey() + "."

  const expanded = (sessionId: string) => {
    if (!ready() && !migrated()) return local().includes(sessionId)
    return store[prefix() + sessionId] ?? false
  }

  const toggle = (sessionId: string) => {
    const key = prefix() + sessionId
    const isReady = ready()
    const current = expanded(sessionId)

    if (!isReady && !migrated()) {
      setLocal((prev) => (current ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]))
      return
    }

    setStore(key, !current)
  }

  onMount(() => {
    if (ready() && !migrated()) {
      const localIds = local()
      if (localIds.length > 0) {
        const pfx = prefix()
        for (const id of localIds) {
          setStore(pfx + id, true)
        }
        setLocal([])
      }
      setMigrated(true)
    }
  })

  return { expanded, toggle }
}
