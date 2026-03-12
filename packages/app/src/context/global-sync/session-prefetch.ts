const key = (directory: string, sessionID: string) => `${directory}\n${sessionID}`

type Meta = {
  limit: number
  complete: boolean
  at: number
}

const cache = new Map<string, Meta>()
const inflight = new Map<string, Promise<Meta | undefined>>()

export function getSessionPrefetch(directory: string, sessionID: string) {
  return cache.get(key(directory, sessionID))
}

export function getSessionPrefetchPromise(directory: string, sessionID: string) {
  return inflight.get(key(directory, sessionID))
}

export function runSessionPrefetch(input: {
  directory: string
  sessionID: string
  task: () => Promise<Meta | undefined>
}) {
  const id = key(input.directory, input.sessionID)
  const pending = inflight.get(id)
  if (pending) return pending

  const promise = input.task().finally(() => {
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
    cache.delete(id)
    inflight.delete(id)
  }
}

export function clearSessionPrefetchDirectory(directory: string) {
  const prefix = `${directory}\n`
  for (const id of [...cache.keys()]) {
    if (!id.startsWith(prefix)) continue
    cache.delete(id)
  }
  for (const id of [...inflight.keys()]) {
    if (!id.startsWith(prefix)) continue
    inflight.delete(id)
  }
}
