import { createComputed, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import {
  createSessionResolutionState,
  transitionSessionResolution,
  type SessionResolutionEffect,
  type SessionResolutionEvent,
} from "./resolution-machine"

type SessionStore<T> = {
  get: (id: string) => T | undefined
  sync: (id: string, options?: { children?: boolean }) => Promise<unknown>
  message: {
    sync: (id: string) => Promise<unknown>
  }
  pending: {
    sync: (id: string) => Promise<unknown>
  }
}

// Drives the session route's resolution machine (resolution-machine.ts) from the data store.
// All session tabs on a server share one route instance, so the target session ID changes in
// place; each change is a new target for the machine, which rejects results from earlier ones.
// Resolution is imperative rather than a resource on purpose: a resource created here would be
// created inside the router's navigation transition, and suspending that transition deadlocks the
// URL commit and double-mounts the session header portals from the transition's shadow render.
export function createSessionResolution<T>(
  sessionID: () => string | undefined,
  sessions: () => SessionStore<T>,
  options?: { children?: boolean; connected?: () => boolean },
) {
  const [state, setState] = createSignal(createSessionResolutionState<T, SessionStore<T>>())
  const connected = createMemo(() => options?.connected?.() ?? true)
  // Without a live connection or child sessions to load, cached metadata is already complete.
  const refresh = !!options?.children || !!options?.connected

  const run = (effect: SessionResolutionEffect<SessionStore<T>>) => {
    const store = effect.target.scope
    const id = effect.target.sessionID

    if (effect.type === "sync.transcript") {
      void store.message.sync(id).catch(() => undefined)
      void store.pending.sync(id).catch(() => undefined)

      return
    }

    store
      .sync(id, options?.children ? { children: true } : undefined)
      .then(() =>
        dispatch({ type: "sync.settled", target: effect.target, attempt: effect.attempt, session: store.get(id) }),
      )
      .catch((error) => dispatch({ type: "sync.failed", target: effect.target, attempt: effect.attempt, error }))
  }

  const dispatch = (event: SessionResolutionEvent<T, SessionStore<T>>) => {
    const result = transitionSessionResolution(untrack(state), event)
    setState(() => result.state)
    result.effects.forEach(run)
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  // Computations, not render effects: the route hands the resolved session to its subtree through a
  // non-keyed <Match>, so a deleted session must leave `ready` before that subtree's render effects
  // run, or they read the narrowed value after the match has gone (a "Stale read from <Match>").
  createComputed(
    on([sessionID, sessions] as const, ([id, store]) => {
      if (!id) {
        dispatch({ type: "target.changed", target: undefined, cached: undefined, connected: false, refresh })

        return
      }

      const target = { scope: store, sessionID: id }
      const cached = createMemo(() => store.get(id))
      dispatch({ type: "target.changed", target, cached: cached(), connected: connected(), refresh })

      // Owned by this target's run, so both are disposed before the next target is dispatched.
      createComputed(on(cached, (session) => dispatch({ type: "cache.changed", target, session }), { defer: true }))
      createComputed(
        on(
          connected,
          (value) => {
            if (value) dispatch({ type: "connected", target, refresh })
          },
          { defer: true },
        ),
      )
    }),
  )

  return state
}
