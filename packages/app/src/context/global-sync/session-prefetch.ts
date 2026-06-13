import { ScopedKey, type ServerScope } from "@/utils/server-scope"

const key = (scope: ServerScope, directory: string, sessionID: string) => ScopedKey.from(scope, directory, sessionID)

export const SESSION_PREFETCH_TTL = 15_000

type Meta = {
  limit: number
  cursor?: string
  complete: boolean
  at: number
}

export function shouldSkipSessionPrefetch(input: { message: boolean; info?: Meta; chunk: number; now?: number }) {
  if (input.message) {
    if (!input.info) return true
    if (input.info.complete) return true
    if (input.info.limit > input.chunk) return true
  } else {
    if (!input.info) return false
  }

  return (input.now ?? Date.now()) - input.info.at < SESSION_PREFETCH_TTL
}

const cache = new Map<string, Meta>()
const inflight = new Map<string, Promise<Meta | undefined>>()
const rev = new Map<string, number>()

const version = (id: string) => rev.get(id) ?? 0

export function getSessionPrefetch(scope: ServerScope, directory: string, sessionID: string) {
  return cache.get(key(scope, directory, sessionID))
}

export function getSessionPrefetchPromise(scope: ServerScope, directory: string, sessionID: string) {
  return inflight.get(key(scope, directory, sessionID))
}

export function clearSessionPrefetchInflight(scope: ServerScope) {
  const prefix = ScopedKey.prefix(scope)
  for (const id of inflight.keys()) {
    if (id.startsWith(prefix)) inflight.delete(id)
  }
}

export function isSessionPrefetchCurrent(scope: ServerScope, directory: string, sessionID: string, value: number) {
  return version(key(scope, directory, sessionID)) === value
}

export function runSessionPrefetch(input: {
  directory: string
  scope: ServerScope
  sessionID: string
  task: (value: number) => Promise<Meta | undefined>
}) {
  const id = key(input.scope, input.directory, input.sessionID)
  const pending = inflight.get(id)
  if (pending) return pending

  const value = version(id)

  const promise = input.task(value).finally(() => {
    if (inflight.get(id) === promise) inflight.delete(id)
  })

  inflight.set(id, promise)
  return promise
}

export function setSessionPrefetch(input: {
  directory: string
  scope: ServerScope
  sessionID: string
  limit: number
  cursor?: string
  complete: boolean
  at?: number
}) {
  cache.set(key(input.scope, input.directory, input.sessionID), {
    limit: input.limit,
    cursor: input.cursor,
    complete: input.complete,
    at: input.at ?? Date.now(),
  })
}

export function clearSessionPrefetch(scope: ServerScope, directory: string, sessionIDs: Iterable<string>) {
  for (const sessionID of sessionIDs) {
    if (!sessionID) continue
    const id = key(scope, directory, sessionID)
    rev.set(id, version(id) + 1)
    cache.delete(id)
    inflight.delete(id)
  }
}

export function clearSessionPrefetchDirectory(scope: ServerScope, directory: string) {
  const prefix = ScopedKey.prefix(scope, directory)
  const keys = new Set([...cache.keys(), ...inflight.keys()])
  for (const id of keys) {
    if (!id.startsWith(prefix)) continue
    rev.set(id, version(id) + 1)
    cache.delete(id)
    inflight.delete(id)
  }
}
