import type { RepositoryOutcome } from "./repository"

const MAX_ANCESTRY_DEPTH = 64

export interface SessionAncestry {
  readonly parentID?: string
  readonly directory: string
}

export type SessionReader = (sessionID: string) => Promise<SessionAncestry | undefined>

export interface SessionRecord {
  readonly parentID?: string
  readonly location: { readonly directory: string }
}

export interface SessionLookup {
  readonly get: (input: { readonly sessionID: string }) => Promise<SessionRecord>
}

export interface ResolvedPrincipal {
  readonly sessionID: string
  readonly rootSessionID: string
  readonly directory: string
}

export function createSessionReader(session: SessionLookup): SessionReader {
  return async (sessionID) => {
    try {
      const info = await session.get({ sessionID })
      return {
        ...(info.parentID === undefined ? {} : { parentID: info.parentID }),
        directory: info.location.directory,
      }
    } catch {
      return undefined
    }
  }
}

export async function resolveReportPrincipal(
  callerSessionID: string,
  readSession: SessionReader,
): Promise<RepositoryOutcome<ResolvedPrincipal>> {
  const visited = new Set<string>()
  let currentID = callerSessionID
  for (;;) {
    if (visited.has(currentID)) return forbidden(`session ancestry cycle at ${currentID}`)
    if (visited.size >= MAX_ANCESTRY_DEPTH) return forbidden(`session ancestry exceeds ${MAX_ANCESTRY_DEPTH} levels`)
    visited.add(currentID)
    const current = await readSession(currentID)
    if (current === undefined) {
      const detail = currentID === callerSessionID ? `unknown caller session: ${callerSessionID}` : `unknown session in ancestry: ${currentID}`
      return forbidden(detail)
    }
    if (current.parentID === undefined) {
      return {
        ok: true,
        value: { sessionID: callerSessionID, rootSessionID: currentID, directory: current.directory },
      }
    }
    currentID = current.parentID
  }
}

function forbidden(detail: string): RepositoryOutcome<never> {
  return { ok: false, error: { code: "forbidden", detail } }
}
