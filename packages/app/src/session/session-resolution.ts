import { createComputed, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import {
  createSessionResolutionState,
  transitionSessionResolution,
  type SessionResolutionEffect,
  type SessionResolutionEvent,
} from "./resolution-machine"

type SessionStore<T> = {
  get: (id: string) => T | undefined
  sync: (id: string, options?: { children?: boolean }) => Promise<void>
  message: {
    sync: (id: string) => Promise<void>
  }
  pending: {
    sync: (id: string) => Promise<void>
  }
}

// Drives the session route's resolution machine (resolution-machine.ts) from the data store.
// All session tabs on a server share one route instance, so the target session ID changes in
// place; each change is a new target for the machine, which rejects results from earlier ones.
// Resolution is imperative rather than a resource on purpose: a resource created here would be
// created inside the router's navigation transition, and suspending that transition deadlocks the
// URL commit and double-mounts the session header portals from the transition's shadow render.
// `pending` names a new session whose creation another owner (the tab promotion) still runs.
export function createSessionResolution<T, P = never>(
  sessionID: () => string | undefined,
  sessions: () => SessionStore<T>,
  options?: { children?: boolean; connected?: () => boolean; pending?: (sessionID: string) => P | undefined },
) {
  const [state, setState] = createSignal(createSessionResolutionState<T, SessionStore<T>, P>())
  const connected = createMemo(() => options?.connected?.() ?? true)
  // Without a live connection or child sessions to load, cached metadata is already complete.
  const refresh = !!options?.children || !!options?.connected
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = (effect: SessionResolutionEffect<SessionStore<T>>) => {
    if (effect.type === "timer.clear") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        dispatch({ type: "resolve.timed-out", attempt: effect.attempt })
      }, effect.delayMs)

      return
    }

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
        dispatch({
          type: "sync.settled",
          target: effect.target,
          attempt: effect.attempt,
          session: untrack(() => store.get(id)),
        }),
      )
      .catch((error) => dispatch({ type: "sync.failed", target: effect.target, attempt: effect.attempt, error }))
  }

  const dispatch = (event: SessionResolutionEvent<T, SessionStore<T>, P>) => {
    const previous = untrack(state)
    const result = transitionSessionResolution(previous, event)

    if (result.state !== previous) setState(() => result.state)
    result.effects.forEach(run)
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  // Computations, not render effects, like the memo this machine replaced: a deleted session leaves
  // `ready` in the same pure phase that removed it, before the session subtree's render effects run.
  createComputed(
    on([sessionID, sessions] as const, ([id, store]) => {
      if (!id) {
        dispatch({ type: "target.changed", target: undefined, cached: undefined, connected: false, refresh })

        return
      }

      const target = { scope: store, sessionID: id }
      const pending = createMemo(() => options?.pending?.(id))
      const cached = createMemo(() => store.get(id))
      dispatch({
        type: "target.changed",
        target,
        pending: pending(),
        cached: cached(),
        connected: connected(),
        refresh,
      })

      // Owned by this target's run, so all are disposed before the next target is dispatched.
      createComputed(
        on(
          pending,
          (value) =>
            dispatch({
              type: "pending.changed",
              target,
              pending: value,
              cached: untrack(cached),
              connected: untrack(connected),
              refresh,
            }),
          { defer: true },
        ),
      )
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
