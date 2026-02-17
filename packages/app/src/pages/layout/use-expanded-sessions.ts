import { createMemo, createSignal } from "solid-js"
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
    const sum = checksum(dir) ?? "0"
    const head = dir.slice(0, 12) || "workspace"
    return `workspace.${head}.${sum}.expanded-sessions`
  })

  const [store, setStore, , ready] = persisted(
    Persist.global("expanded-sessions", ["expanded-sessions.v1"]),
    createStore({} as Record<string, boolean>),
  )

  const [local, setLocal] = createSignal<string[]>([])

  const prefix = () => storageKey() + "."

  const expanded = (sessionId: string) => {
    if (!ready()) return local().includes(sessionId)
    return store[prefix() + sessionId] ?? false
  }

  const toggle = (sessionId: string) => {
    const key = prefix() + sessionId
    const current = expanded(sessionId)

    if (!ready()) {
      setLocal((prev) => (current ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]))
      return
    }

    setStore(key, !current)
  }

  return { expanded, toggle }
}
