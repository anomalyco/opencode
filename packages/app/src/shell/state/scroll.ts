import { createStore, produce } from "solid-js/store"
import {
  INITIAL_SCROLL_PERSISTENCE_STATE,
  isScrollPersistenceDisposed,
  transitionScrollPersistence,
  type ScrollPersistenceEffect,
  type ScrollPersistenceEvent,
} from "./scroll-machine"

export type SessionScroll = {
  x: number
  y: number
}

type ScrollMap = Record<string, SessionScroll>

type Options = {
  debounceMs?: number
  getSnapshot: (sessionKey: string) => ScrollMap | undefined
  onFlush: (sessionKey: string, scroll: ScrollMap) => void
}

export function createScrollPersistence(opts: Options) {
  const wait = opts.debounceMs ?? 200
  const [cache, setCache] = createStore<Record<string, ScrollMap>>({})
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let persistence = INITIAL_SCROLL_PERSISTENCE_STATE

  function clone(input?: ScrollMap) {
    const out: ScrollMap = {}

    if (!input) return out

    for (const key of Object.keys(input)) {
      const pos = input[key]

      if (!pos) continue
      out[key] = { x: pos.x, y: pos.y }
    }

    return out
  }

  function dispatch(event: ScrollPersistenceEvent) {
    const result = transitionScrollPersistence(persistence, event)
    persistence = result.state
    result.effects.forEach(run)
  }

  function run(effect: ScrollPersistenceEffect) {
    if (effect.type === "timer.schedule") {
      clearTimeout(timers.get(effect.sessionKey))
      timers.set(
        effect.sessionKey,
        setTimeout(() => dispatch({ type: "flushed", sessionKey: effect.sessionKey }), wait),
      )

      return
    }

    if (effect.type === "timer.clear") {
      for (const key of effect.sessionKeys) {
        clearTimeout(timers.get(key))
        timers.delete(key)
      }

      return
    }

    if (effect.type === "flush") {
      for (const key of effect.sessionKeys) opts.onFlush(key, clone(cache[key]))

      return
    }

    setCache(
      produce((draft) => {
        for (const key of effect.sessionKeys) {
          delete draft[key]
        }
      }),
    )
  }

  function seed(sessionKey: string) {
    const current = cache[sessionKey]

    // Scroll frames reach here first; a seeded session skips reading and copying its snapshot.
    if (current && Object.keys(current).length > 0) return
    const next = clone(opts.getSnapshot(sessionKey))

    if (current && Object.keys(next).length === 0) return
    setCache(sessionKey, next)
  }

  function scroll(sessionKey: string, tab: string) {
    seed(sessionKey)

    return cache[sessionKey]?.[tab] ?? opts.getSnapshot(sessionKey)?.[tab]
  }

  function setScroll(sessionKey: string, tab: string, pos: SessionScroll) {
    if (isScrollPersistenceDisposed(persistence)) return
    seed(sessionKey)

    const prev = cache[sessionKey]?.[tab]

    if (prev?.x === pos.x && prev?.y === pos.y) return

    setCache(sessionKey, tab, { x: pos.x, y: pos.y })
    dispatch({ type: "edited", sessionKey })
  }

  return {
    cache,
    drop: (sessionKeys: string[]) => dispatch({ type: "dropped", sessionKeys }),
    flush: (sessionKey: string) => dispatch({ type: "flushed", sessionKey }),
    flushAll: () => dispatch({ type: "flush-all" }),
    scroll,
    seed,
    setScroll,
    dispose: () => dispatch({ type: "disposed" }),
  }
}
