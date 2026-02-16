import { createStore, produce } from "solid-js/store"

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
  const dirty = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

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

  function seed(sessionKey: string) {
    if (cache[sessionKey]) return
    setCache(sessionKey, clone(opts.getSnapshot(sessionKey)))
  }

  function scroll(sessionKey: string, tab: string) {
    seed(sessionKey)
    return cache[sessionKey]?.[tab] ?? opts.getSnapshot(sessionKey)?.[tab]
  }

  function schedule(sessionKey: string) {
    const prev = timers.get(sessionKey)
    if (prev) clearTimeout(prev)
    timers.set(
      sessionKey,
      setTimeout(() => flush(sessionKey), wait),
    )
  }

  function setScroll(sessionKey: string, tab: string, pos: SessionScroll) {
    seed(sessionKey)

    const prev = cache[sessionKey]?.[tab]
    if (prev?.x === pos.x && prev?.y === pos.y) return

    setCache(sessionKey, tab, { x: pos.x, y: pos.y })
    dirty.add(sessionKey)
    schedule(sessionKey)
  }

  function flush(sessionKey: string) {
    const timer = timers.get(sessionKey)
    if (timer) clearTimeout(timer)
    timers.delete(sessionKey)

    if (!dirty.has(sessionKey)) return
    dirty.delete(sessionKey)

    opts.onFlush(sessionKey, clone(cache[sessionKey]))
  }

  function flushAll() {
    const keys = Array.from(dirty)
    if (keys.length === 0) return

    for (const key of keys) {
      flush(key)
    }
  }

  function drop(keys: string[]) {
    if (keys.length === 0) return

    for (const key of keys) {
      const timer = timers.get(key)
      if (timer) clearTimeout(timer)
      timers.delete(key)
      dirty.delete(key)
    }

    setCache(
      produce((draft) => {
        for (const key of keys) {
          delete draft[key]
        }
      }),
    )
  }

  function dispose() {
    drop(Array.from(timers.keys()))
  }

  return {
    cache,
    drop,
    flush,
    flushAll,
    scroll,
    seed,
    setScroll,
    dispose,
  }
}
