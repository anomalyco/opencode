import type { Accessor } from "solid-js"
import { pathKey } from "@/utils/path-key"

export function createProjectSessionLoader(load: (directory: string) => Promise<boolean> | boolean) {
  const scheduled = new Set<string>()
  const pending = new Map<string, Promise<void>>()
  const queue: { directory: string; key: string; resolve: () => void }[] = []
  let active = false
  let disposed = false

  async function run() {
    if (active) return
    active = true
    while (!disposed) {
      const next = queue.shift()
      if (!next) break
      const success = await Promise.resolve()
        .then(() => load(next.directory))
        .catch(() => false)
      if (!success) scheduled.delete(next.key)
      pending.delete(next.key)
      next.resolve()
    }
    active = false
  }

  const schedule = (directory: string) => {
    if (disposed) return Promise.resolve()
    const key = pathKey(directory)
    if (!key) return Promise.resolve()
    const existing = pending.get(key)
    if (existing) return existing
    if (scheduled.has(key)) return Promise.resolve()
    scheduled.add(key)
    const result = new Promise<void>((resolve) => {
      queue.push({ directory, key, resolve })
    })
    pending.set(key, result)
    void run()
    return result
  }

  return Object.assign(schedule, {
    dispose() {
      disposed = true
      scheduled.clear()
      queue.splice(0).forEach((next) => {
        pending.delete(next.key)
        next.resolve()
      })
    },
  })
}

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}
