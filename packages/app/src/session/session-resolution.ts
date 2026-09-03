import { createMemo, createRenderEffect, createSignal, on, onCleanup } from "solid-js"
import { sessionNotFoundError } from "@/runtime/server/errors"

type SessionStore<T> = {
  get: (id: string) => T | undefined
  sync: (id: string, options?: { children?: boolean }) => Promise<unknown>
  message: {
    sync: (id: string) => Promise<unknown>
  }
  pending: {
    list: (id: string) => readonly unknown[]
    sync: (id: string) => Promise<unknown>
  }
}

type Resolution<T> = { id: string; store: SessionStore<T> } & (
  | { state: "pending" }
  | { state: "settled" }
  | { state: "failed"; failure: unknown }
)

// Reactive target session for the session route, read from the data store.
// All session tabs on a server share one route instance, so the target session ID
// changes in place; the effect is only a trigger that starts resolution for the
// current target, and each run cancels the previous one through onCleanup so a
// late result from an abandoned target is dropped. Resolution is imperative rather
// than a resource on purpose: a resource created here would be created inside the
// router's navigation transition, and suspending that transition deadlocks the URL
// commit and double-mounts the session header portals from the transition's shadow
// render.
//
// The returned accessor is a pure derivation. The sync cache is authoritative, and
// status only applies while it matches the current target (store + session ID): on
// navigation or store replacement the memo re-evaluates before the trigger runs,
// so trusting a previous target's settlement would fabricate a not-found for a
// session that simply has not resolved yet. Resolve failures rethrow on read so
// the enclosing SessionRouteErrorBoundary renders the scoped session error.
export function createSessionResolution<T>(
  sessionID: () => string | undefined,
  sessions: () => SessionStore<T>,
  options?: { children?: boolean; connected?: () => boolean },
) {
  const cached = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sessions().get(id)
  })
  const [status, setStatus] = createSignal<Resolution<T>>()

  // Start independent reads before constructing the selected view, including
  // when its metadata is cached but its transcript has never been loaded.
  createRenderEffect(
    on([sessionID, sessions, () => options?.connected?.() ?? true] as const, ([id, store, connected]) => {
      if (!id || !connected) return
      let stale = false
      onCleanup(() => {
        stale = true
      })
      // Message reconciliation retains pending placeholders. Refresh their membership
      // first when present, but keep empty-cache reads parallel and metadata independent.
      const messages = store.pending.list(id).length ? undefined : store.message.sync(id)
      const pending = store.pending.sync(id).catch(() => undefined)
      void (messages ?? pending.then(() => store.message.sync(id))).catch(() => undefined)
      if (cached() && !options?.children && !options?.connected) {
        setStatus({ id, store, state: "settled" })
        return
      }
      setStatus({ id, store, state: "pending" })
      store
        .sync(id, options)
        .then(() => {
          if (!stale) setStatus({ id, store, state: "settled" })
        })
        .catch((failure) => {
          if (!stale) setStatus({ id, store, state: "failed", failure })
        })
    }),
  )

  return createMemo(() => {
    const id = sessionID()
    if (!id) return
    const value = cached()
    if (value) return value
    const state = status()
    if (!state || state.id !== id || state.store !== sessions()) return undefined
    if (state.state === "failed") throw state.failure
    // A session missing after settlement was deleted, possibly by another client.
    // Match the resolve error so the boundary shows the
    // session not found fallback.
    if (state.state === "settled") throw sessionNotFoundError(id)
    return undefined
  })
}
