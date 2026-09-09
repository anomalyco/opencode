import type { Session } from "@opencode-ai/sdk/v2/client"
import { createSignal, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { useGlobal } from "@/context/global"
import {
  applyHomeSessionEvent,
  loadHomeSessionIndex,
  retainHomeSessions,
  type HomeSessionEvent,
} from "@/context/global-sync/home-session-index"
import { ServerConnection } from "@/context/server"
import { sweepAttention } from "./mission-control-attention"

const SESSION_LIMIT = 64

type ServerCtx = ReturnType<ReturnType<typeof useGlobal>["ensureServerCtx"]>

export type ServerFeed = {
  key: ServerConnection.Key
  ctx: ServerCtx
  sessions: () => Session[]
  loading: () => boolean
}

// Mission control spans every server, so it owns its own session index rather than the
// single-server TanStack cache the home page uses. The list is seeded once and then kept
// current from the same session events the rest of the app reacts to.
export function createServerFeed(conn: ServerConnection.Any, ctx: ServerCtx): ServerFeed {
  const key = ServerConnection.key(conn)
  const [store, setStore] = createStore<{ sessions: Session[] }>({ sessions: [] })
  const [loading, setLoading] = createSignal(true)

  const load = () =>
    loadHomeSessionIndex((input, options) => ctx.sdk.client.v2.session.list(input, options))
      .then((index) => setStore("sessions", reconcile(index.sessions, { key: "id" })))
      .catch(() => {})
      .finally(() => setLoading(false))

  void load()
  void sweepAttention(ctx)

  const unsubscribe = ctx.sdk.event.listen((entry) => {
    const event = entry.details
    if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
      setStore("sessions", (current) => applyHomeSessionEvent(current, event as HomeSessionEvent))
      return
    }
    // A reconnect can drop events, so rebuild the index rather than trusting the stale list.
    if (event.type === "server.connected") void load()
  })
  onCleanup(unsubscribe)

  return {
    key,
    ctx,
    sessions: () => retainHomeSessions(store.sessions, SESSION_LIMIT, Date.now()),
    loading,
  }
}
