// Which OTHER agents are working in this directory right now.
//
// Nothing is discovered or transported here: sessions in a directory share one
// store (a server on one port lists sessions created by a server on another in
// the same directory), and `fleet-instance-presence` already landed the status
// derivation. This is a projection over data two sessions already share — the
// only thing that was missing is that no agent could ask.
//
// Pure and import-free apart from types, like gates.ts and personas.ts, so the
// caller supplies the four sources and tests drive it without a runtime.
import { statusFrom, type Status } from "@/agent/presence-status"

export interface PeerSession {
  id: string
  parentID?: string
  directory: string
  title: string
  agent?: string
  model?: { providerID: string; id: string }
  updatedAt: number
}

export interface PeerLoop {
  id: string
  sessionID: string
  status: string
  iteration: number
}

export interface Peer {
  sessionID: string
  title: string
  status: Status
  agent?: string
  provider?: string
  model?: string
  loopID?: string
  loopIteration?: number
  /** milliseconds since this session last produced an event */
  idleForMs: number
}

export interface ResolveInput {
  sessions: readonly PeerSession[]
  statuses: ReadonlyMap<string, { type: string }>
  pendingPermission: ReadonlySet<string>
  loops: readonly PeerLoop[]
  /** the session asking; excluded along with everything descended from it */
  callerID: string
  directory: string
  now: number
}

const LiveLoopStatuses = new Set(["running", "paused"])

/**
 * True when a session is actually doing something. An idle session is not a
 * neighbour: a directory accumulates abandoned sessions, and a warning that
 * fires on every one of them is a warning nobody reads.
 */
function isWorking(status: Status, loop: PeerLoop | undefined): boolean {
  if (loop && LiveLoopStatuses.has(loop.status)) return true
  return status !== "idle"
}

export function resolvePeers(input: ResolveInput): Peer[] {
  const parentOf = new Map<string, string | undefined>()
  for (const session of input.sessions) parentOf.set(session.id, session.parentID)

  // A run that fans out to a reviewer would otherwise see its own subagents as
  // competing agents, and every delegation would read as a collision — the
  // signal would be loudest exactly when the run is behaving correctly.
  const descendsFromCaller = (id: string): boolean => {
    const seen = new Set<string>()
    let current: string | undefined = id
    while (current !== undefined && !seen.has(current)) {
      if (current === input.callerID) return true
      seen.add(current)
      current = parentOf.get(current)
    }
    return false
  }

  const loopBySession = new Map<string, PeerLoop>()
  for (const loop of input.loops) {
    const existing = loopBySession.get(loop.sessionID)
    if (!existing || LiveLoopStatuses.has(loop.status)) loopBySession.set(loop.sessionID, loop)
  }

  const peers: Peer[] = []
  for (const session of input.sessions) {
    if (session.directory !== input.directory) continue
    if (descendsFromCaller(session.id)) continue

    const loop = loopBySession.get(session.id)
    const status = statusFrom({
      session: input.statuses.get(session.id),
      permissionPending: input.pendingPermission.has(session.id),
      loop,
    })
    if (!isWorking(status, loop)) continue

    peers.push({
      sessionID: session.id,
      title: session.title,
      status,
      ...(session.agent ? { agent: session.agent } : {}),
      ...(session.model ? { provider: session.model.providerID, model: session.model.id } : {}),
      ...(loop && LiveLoopStatuses.has(loop.status) ? { loopID: loop.id, loopIteration: loop.iteration } : {}),
      idleForMs: Math.max(0, input.now - session.updatedAt),
    })
  }

  // Whatever needs attention first, then the freshest — the same ordering the
  // Agents view uses, for the same reason.
  const rank: Record<Status, number> = {
    stalled: 0,
    "awaiting-permission": 1,
    cancelling: 2,
    busy: 3,
    unreachable: 4,
    idle: 5,
  }
  peers.sort((a, b) => rank[a.status] - rank[b.status] || a.idleForMs - b.idleForMs)
  return peers
}

function age(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

/** One line per peer, for a tool result or a queue brief. */
export function describePeer(peer: Peer): string {
  const parts = [`${peer.sessionID} — "${peer.title}" [${peer.status}]`]
  if (peer.loopID) parts.push(`in an auto/loop run (iteration ${peer.loopIteration ?? 0})`)
  if (peer.agent) parts.push(`agent ${peer.agent}`)
  if (peer.model) parts.push(`${peer.provider}/${peer.model}`)
  parts.push(`last active ${age(peer.idleForMs)} ago`)
  return parts.join(", ")
}

export * as SessionPeers from "./peers"
