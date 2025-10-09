import { useSync, useLocal } from "@/context"
import { Button } from "@/ui"
import { VList } from "virtua/solid"
import { createMemo, createSignal } from "solid-js"
import { DateTime } from "luxon"

type SessionOrHeader = { type: "header"; label: string; date: string } | { type: "session"; session: any }

export default function SessionList() {
  const sync = useSync()
  const local = useLocal()
  const [displayLimit, setDisplayLimit] = createSignal(50)
  let listRef: any

  const flattenedList = createMemo(() => {
    const sessions = sync.data.session
    if (!sessions || sessions.length === 0) {
      return []
    }

    console.log("[SessionList] Processing", sessions.length, "sessions")

    const items: SessionOrHeader[] = []
    let lastDate = ""
    const limit = displayLimit()

    try {
      const limitedSessions = sessions.slice(0, limit)

      limitedSessions.forEach((session, idx) => {
        if (!session) {
          console.warn("[SessionList] Null session at index", idx)
          return
        }

        if (!session.time?.created) {
          items.push({ type: "session", session })
          return
        }

        try {
          const sessionDate = DateTime.fromMillis(session.time.created)
          const dateKey = sessionDate.toFormat("yyyy-MM-dd")

          if (dateKey !== lastDate) {
            const now = DateTime.now()
            const today = now.toFormat("yyyy-MM-dd")
            const yesterday = now.minus({ days: 1 }).toFormat("yyyy-MM-dd")

            let label = sessionDate.toFormat("MMMM d, yyyy")
            if (dateKey === today) {
              label = "Today"
            } else if (dateKey === yesterday) {
              label = "Yesterday"
            }

            items.push({ type: "header", label, date: dateKey })
            lastDate = dateKey
          }

          items.push({ type: "session", session })
        } catch (dateError) {
          console.error("[SessionList] Error processing session date:", session.id, dateError)
          items.push({ type: "session", session })
        }
      })

      console.log("[SessionList] Generated", items.length, "items from", limitedSessions.length, "sessions")
    } catch (error) {
      console.error("[SessionList] Error grouping sessions:", error)
      return sessions.slice(0, limit).map((session) => ({ type: "session" as const, session }))
    }

    return items
  })

  const items = flattenedList()
  const hasMore = createMemo(() => sync.data.session.length > displayLimit())

  console.log("[SessionList] Rendering", items.length, "items")

  const loadMore = () => {
    setDisplayLimit((prev) => Math.min(prev + 50, sync.data.session.length))
  }

  return (
    <VList
      ref={listRef}
      data={items}
      class="p-2"
      onScrollEnd={() => {
        if (hasMore()) {
          loadMore()
        }
      }}
    >
      {(item) => {
        if (!item) {
          console.warn("[SessionList] Null item in render")
          return null
        }

        if (item.type === "header") {
          return (
            <div class="px-2 py-1.5 text-xs font-semibold text-text-muted uppercase tracking-wider">{item.label}</div>
          )
        }

        if (!item.session) {
          console.warn("[SessionList] Session item without session data")
          return null
        }

        return (
          <Button
            size="sm"
            variant="ghost"
            title={item.session.title || "Untitled"}
            class="w-full min-w-0 py-1 text-left text-xs !justify-start"
            classList={{
              "text-text-muted": true,
              "text-text!": local.session.active()?.id === item.session.id,
            }}
            onClick={() => {
              console.log("[SessionList] Selecting session:", item.session.id)
              local.session.setActive(item.session.id)
            }}
          >
            <span class="truncate">{item.session.title || "Untitled"}</span>
          </Button>
        )
      }}
    </VList>
  )
}
