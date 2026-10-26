export type LinkServer<Key, Session> = {
  key: Key
  url: string
  get: (sessionID: string, signal: AbortSignal) => Promise<Session>
}

/**
 * Finds which server has a linked session. A server the link names (by key or origin) is asked first; otherwise every
 * server is asked at once and the first to have it wins, since session IDs are unique. The same server can be listed
 * under different keys on different clients (the sidecar here, an http server on another Mac), which is why a named
 * server that is not listed still finds the session. Never adds a server.
 */
export async function resolveLinkSession<Key, Session>(input: {
  sessionID: string
  hint?: string
  servers: LinkServer<Key, Session>[]
  timeout: number
}) {
  const named = input.hint
    ? input.servers.find((server) => server.key === input.hint || URL.parse(server.url)?.origin === input.hint)
    : undefined

  const hit = named ? await probe(named, input.sessionID, input.timeout) : undefined

  if (hit) return hit
  const rest = input.servers.filter((server) => server !== named)

  return Promise.any(
    rest.map((server) =>
      probe(server, input.sessionID, input.timeout).then((found) => found ?? Promise.reject(new Error("not found"))),
    ),
  ).catch(() => undefined)
}

function probe<Key, Session>(server: LinkServer<Key, Session>, sessionID: string, timeout: number) {
  return server.get(sessionID, AbortSignal.timeout(timeout)).then(
    (session) => ({ key: server.key, session }),
    () => undefined,
  )
}
