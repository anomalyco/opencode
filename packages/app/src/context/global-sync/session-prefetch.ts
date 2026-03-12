const key = (directory: string, sessionID: string) => `${directory}\n${sessionID}`

export const SESSION_PREFETCH_TTL = 15_000

type Meta = {
  limit: number
  complete: boolean
  at: number
}

const cache = new Map<string, Meta>()
const inflight = new Map<string, Promise<Meta | undefined>>()
const rev = new Map<string, number>()

const version = (id: string) => rev.get(id) ?? 0

export function getSessionPrefetch(directory: string, sessionID: string) {
  return cache.get(key(directory, sessionID))
}

export function getSessionPrefetchPromise(directory: string, sessionID: string) {
  return inflight.get(key(directory, sessionID))
}

export function clearSessionPrefetchInflight() {
  inflight.clear()
}

export function isSessionPrefetchCurrent(directory: string, sessionID: string, value: number) {
  return version(key(directory, sessionID)) === value
}

export function runSessionPrefetch(input: {
  directory: string
  sessionID: string
  task: (value: number) => Promise<Meta | undefined>
}) {
  const id = key(input.directory, input.sessionID)
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
  sessionID: string
  limit: number
  complete: boolean
  at?: number
}) {
  cache.set(key(input.directory, input.sessionID), {
    limit: input.limit,
    complete: input.complete,
    at: input.at ?? Date.now(),
  })
}

export function clearSessionPrefetch(directory: string, sessionIDs: Iterable<string>) {
  for (const sessionID of sessionIDs) {
    if (!sessionID) continue
    const id = key(directory, sessionID)
    rev.set(id, version(id) + 1)
    cache.delete(id)
    inflight.delete(id)
  }
}

export function clearSessionPrefetchDirectory(directory: string) {
  const prefix = `${directory}\n`
  const keys = new Set([...cache.keys(), ...inflight.keys()])
  for (const id of keys) {
    if (!id.startsWith(prefix)) continue
    rev.set(id, version(id) + 1)
    cache.delete(id)
    inflight.delete(id)
  }
}
