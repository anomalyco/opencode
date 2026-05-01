import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { Persist, persisted } from "@/utils/persist"

export type SessionHistoryEntry = {
  id: string
  title: string
  directory: string
  visitedAt: number
}

const MAX_ENTRIES = 30
const DEFAULT_RECENT_LIMIT = 10

export const { use: useSessionHistory, provider: SessionHistoryProvider } = createSimpleContext({
  name: "SessionHistory",
  gate: false,
  init: () => {
    const globalSDK = useGlobalSDK()
    const [store, setStore, , ready] = persisted(
      Persist.global("session_history.v1"),
      createStore<{ entries: SessionHistoryEntry[] }>({ entries: [] }),
    )

    const sanitize = (raw: { id?: string; title?: string; directory?: string }) => {
      const id = raw.id?.trim()
      const directory = raw.directory?.trim()
      if (!id || !directory) return undefined
      return {
        id,
        directory,
        title: (raw.title ?? "").toString(),
      }
    }

    const record = (entry: { id: string; title: string; directory: string }) => {
      const clean = sanitize(entry)
      if (!clean) return
      const visitedAt = Date.now()
      setStore("entries", (current) => {
        const filtered = current.filter((x) => x.id !== clean.id)
        const next = [{ ...clean, visitedAt }, ...filtered]
        if (next.length <= MAX_ENTRIES) return next
        return next.slice(0, MAX_ENTRIES)
      })
    }

    const remove = (id: string) => {
      setStore("entries", (current) => current.filter((x) => x.id !== id))
    }

    const clear = () => {
      setStore("entries", [])
    }

    // Auto-prune the history when sessions are archived or deleted server-side.
    // The bus surfaces every archive — local UI action, another tab, or remote —
    // so we don't need to wire each call site individually.
    const unsubscribe = globalSDK.listenAll((e) => {
      const detail = e.details
      if (!detail) return
      if (detail.type === "session.updated") {
        const info = (detail.properties as { info?: { id?: string; time?: { archived?: number } } } | undefined)
          ?.info
        if (info?.id && info.time?.archived) remove(info.id)
        return
      }
      if (detail.type === "session.deleted") {
        const info = (detail.properties as { info?: { id?: string } } | undefined)?.info
        if (info?.id) remove(info.id)
      }
    })
    onCleanup(unsubscribe)

    const entries = createMemo(() => store.entries)

    return {
      ready,
      entries,
      recent: (limit: number = DEFAULT_RECENT_LIMIT) => entries().slice(0, Math.max(0, limit)),
      record,
      remove,
      clear,
    }
  },
})

