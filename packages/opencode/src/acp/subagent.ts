import { Decimal } from "decimal.js"
import type { Event, OpencodeClient, Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { Schema } from "effect"

export const phases = ["queued", "running", "completed", "failed", "cancelled", "unknown"] as const
export type Phase = (typeof phases)[number]

export type DirectCost = {
  amount: string
  currency: string
}

export type Node = {
  runId: string
  sessionId: string
  rootSessionId: string
  parentSessionId?: string
  agent?: string
  title?: string
  phase: Phase
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  cwd: string
  repository?: string
  directCost?: DirectCost
}

export type Snapshot = {
  generation: string
  revision: number
  nodes: Node[]
}

export type Update = {
  generation: string
  revision: number
  upsert: Node[]
  removedSessionIds: string[]
}

export type ListParams = {
  rootSessionId?: string
}

export const ListParams = Schema.Struct({
  rootSessionId: Schema.optional(Schema.String),
})

export const DirectCost = Schema.Struct({
  amount: Schema.String,
  currency: Schema.String,
})

export const Node = Schema.Struct({
  runId: Schema.String,
  sessionId: Schema.String,
  rootSessionId: Schema.String,
  parentSessionId: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  phase: Schema.Literals(phases),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
  cwd: Schema.String,
  repository: Schema.optional(Schema.String),
  directCost: Schema.optional(DirectCost),
})

export const Snapshot = Schema.Struct({
  generation: Schema.String,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  nodes: Schema.Array(Node),
})

export const Update = Schema.Struct({
  generation: Schema.String,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  upsert: Schema.Array(Node),
  removedSessionIds: Schema.Array(Schema.String),
})

export type Service = {
  list(params: ListParams): Promise<Snapshot>
  subscribe(params: ListParams): Promise<Snapshot>
  handle(event: Event): Promise<void>
  close(): void
}

type SDK = Pick<OpencodeClient, "session">
type EventSource = {
  addListener(listener: (event: Event) => Promise<void>): () => void
}
type Notify = (update: Update) => Promise<void>

const maxDepth = 8
const maxDescendants = 300
const decodeListParamsSchema = Schema.decodeUnknownSync(ListParams)
const decodeSnapshotSchema = Schema.decodeUnknownSync(Snapshot)
const decodeUpdateSchema = Schema.decodeUnknownSync(Update)

export function decodeListParams(input: unknown): ListParams {
  return decodeListParamsSchema(input)
}

export function decodeSnapshot(input: unknown): Snapshot {
  return validateSnapshot(decodeSnapshotSchema(input))
}

export function encodeSnapshot(input: Snapshot): Snapshot {
  return validateSnapshot(decodeSnapshotSchema(input))
}

export function decodeUpdate(input: unknown): Update {
  return validateUpdate(decodeUpdateSchema(input))
}

export function encodeUpdate(input: Update): Update {
  return validateUpdate(decodeUpdateSchema(input))
}

export function serializeDirectCost(amount: number, currency: string): DirectCost {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("direct cost must be finite and nonnegative")
  }
  return { amount: new Decimal(amount).toString(), currency }
}

export function make(input: { sdk: SDK; events?: EventSource; notify?: Notify }): Service {
  const generation = crypto.randomUUID()
  const failed = new Set<string>()
  const deleted = new Set<string>()
  const statuses = new Map<string, SessionStatus>()
  const sessions = new Map<string, Session>()
  const pending = new Set<string>()
  const nodes = new Map<string, Node>()
  let revision = 0
  let params: ListParams = {}
  let active = false
  let initializing = false
  let closed = false
  let removeListener: (() => void) | undefined
  let processing: Promise<void> | undefined

  const handle = async (event: Event) => {
    const sessionID = recordEvent({ event, failed, deleted, statuses, sessions })
    if (!active || !sessionID) return

    pending.add(sessionID)
    if (initializing) return
    await process()
  }

  const process = () => {
    if (processing) return processing
    processing = reconcile().finally(() => {
      processing = undefined
    })
    return processing
  }

  const reconcile = async () => {
    while (active && pending.size) {
      const changed = [...pending]
      pending.clear()
      const roots = new Set(
        changed.flatMap((sessionID) =>
          affectedRoots({
            sessionID,
            nodes,
            sessions,
          }),
        ),
      )
      if (params.rootSessionId) {
        roots.forEach((rootSessionID) => {
          if (rootSessionID !== params.rootSessionId) roots.delete(rootSessionID)
        })
      }

      const staged = new Map(nodes)
      const upsert = new Map<string, Node>()
      const removed = new Set<string>()
      for (const rootSessionId of roots) {
        const next = await snapshot({
          sdk: input.sdk,
          generation,
          revision,
          params: { rootSessionId },
          failed,
          deleted,
          statuses,
          sessions,
        })
        if (!active) return

        const previous = [...staged.values()].filter((node) => node.rootSessionId === rootSessionId)
        const bySession = new Map(next.nodes.map((node) => [node.sessionId, node]))
        next.nodes.forEach((node) => {
          const current = staged.get(node.sessionId)
          if (!current || !sameNode(current, node)) upsert.set(node.sessionId, node)
        })
        previous.filter((node) => !bySession.has(node.sessionId)).forEach((node) => removed.add(node.sessionId))
        previous.forEach((node) => staged.delete(node.sessionId))
        next.nodes.forEach((node) => staged.set(node.sessionId, node))
      }
      const removedSessionIds = [...removed].filter((sessionID) => !upsert.has(sessionID))
      if (!upsert.size && !removedSessionIds.length) continue

      const update = encodeUpdate({
        generation,
        revision: revision + 1,
        upsert: [...upsert.values()],
        removedSessionIds,
      })
      // Reserve the revision before notification I/O so a failed send can never be reused.
      revision = update.revision
      nodes.clear()
      staged.forEach((node) => nodes.set(node.sessionId, node))
      await input.notify?.(update)
    }
  }

  return {
    list: (params) => snapshot({ sdk: input.sdk, generation, revision, params, failed, deleted, statuses, sessions }),
    subscribe: async (nextParams) => {
      if (!input.events || !input.notify) throw new Error("subagent subscription requires events and notify")
      if (closed) throw new Error("subagent subscription is closed")

      const before = {
        params,
        failed: new Set(failed),
        deleted: new Set(deleted),
        statuses: new Map(statuses),
        sessions: new Map(sessions),
        pending: new Set(pending),
      }
      params = nextParams
      active = true
      initializing = true
      try {
        removeListener ??= input.events.addListener(handle)
        const initial = await snapshot({
          sdk: input.sdk,
          generation,
          revision,
          params,
          failed,
          deleted,
          statuses,
          sessions,
        })
        nodes.clear()
        initial.nodes.forEach((node) => nodes.set(node.sessionId, node))
        initializing = false
        queueMicrotask(() => {
          process().catch(() => {})
        })
        return initial
      } catch (error) {
        active = false
        initializing = false
        removeListener?.()
        removeListener = undefined
        params = before.params
        replaceSet(failed, before.failed)
        replaceSet(deleted, before.deleted)
        replaceMap(statuses, before.statuses)
        replaceMap(sessions, before.sessions)
        replaceSet(pending, before.pending)
        throw error
      }
    },
    handle,
    close: () => {
      closed = true
      active = false
      removeListener?.()
      removeListener = undefined
      pending.clear()
      failed.clear()
      deleted.clear()
      statuses.clear()
      sessions.clear()
      nodes.clear()
    },
  }
}

function replaceSet<T>(target: Set<T>, source: ReadonlySet<T>) {
  target.clear()
  source.forEach((item) => target.add(item))
}

function replaceMap<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>) {
  target.clear()
  source.forEach((value, key) => target.set(key, value))
}

async function snapshot(input: {
  sdk: SDK
  generation: string
  revision: number
  params: ListParams
  failed: ReadonlySet<string>
  deleted: ReadonlySet<string>
  statuses: ReadonlyMap<string, SessionStatus>
  sessions: ReadonlyMap<string, Session>
}) {
  // Events after this boundary stay buffered for a successor revision.
  const deleted = new Set(input.deleted)
  const sessionOverrides = new Map(input.sessions)
  const statusOverrides = new Map(input.statuses)
  const [rootsResponse, statusResponse] = await Promise.all([
    input.sdk.session.list({ roots: true }),
    input.sdk.session.status(),
  ])
  const statuses = { ...(statusResponse.data ?? {}), ...Object.fromEntries(statusOverrides) }
  const nodes: Node[] = []
  const roots = mergeSessions(rootsResponse.data ?? [], sessionOverrides, deleted).filter(
    (session) => !input.params.rootSessionId || session.id === input.params.rootSessionId,
  )

  for (const root of roots) {
    const state = { descendants: 0, visited: new Set<string>() }
    await readSession({
      sdk: input.sdk,
      statuses,
      failed: input.failed,
      nodes,
      state,
      session: root,
      rootSessionId: root.id,
      depth: 0,
      deleted,
      sessions: sessionOverrides,
    })
  }

  return encodeSnapshot({ generation: input.generation, revision: input.revision, nodes })
}

function recordEvent(input: {
  event: Event
  failed: Set<string>
  deleted: Set<string>
  statuses: Map<string, SessionStatus>
  sessions: Map<string, Session>
}) {
  switch (input.event.type) {
    case "session.created":
      input.failed.delete(input.event.properties.sessionID)
      input.deleted.delete(input.event.properties.sessionID)
      input.sessions.set(input.event.properties.sessionID, input.event.properties.info)
      return input.event.properties.sessionID
    case "session.updated":
      input.deleted.delete(input.event.properties.sessionID)
      input.sessions.set(input.event.properties.sessionID, input.event.properties.info)
      return input.event.properties.sessionID
    case "session.deleted":
      input.failed.delete(input.event.properties.sessionID)
      input.deleted.add(input.event.properties.sessionID)
      input.statuses.delete(input.event.properties.sessionID)
      input.sessions.set(input.event.properties.sessionID, input.event.properties.info)
      return input.event.properties.sessionID
    case "session.status":
      input.failed.delete(input.event.properties.sessionID)
      input.statuses.set(input.event.properties.sessionID, input.event.properties.status)
      return input.event.properties.sessionID
    case "session.idle":
      input.failed.delete(input.event.properties.sessionID)
      input.statuses.set(input.event.properties.sessionID, { type: "idle" })
      return input.event.properties.sessionID
    case "session.error":
      if (!input.event.properties.sessionID) return
      input.failed.add(input.event.properties.sessionID)
      return input.event.properties.sessionID
  }
}

function mergeSessions(
  source: Session[],
  overrides: ReadonlyMap<string, Session>,
  deleted: ReadonlySet<string>,
  parentID?: string,
) {
  const merged = new Map<string, Session>()
  source.forEach((session) => {
    const current = overrides.get(session.id) ?? session
    if (deleted.has(current.id) || current.parentID !== parentID) return
    merged.set(current.id, current)
  })
  overrides.forEach((session) => {
    if (deleted.has(session.id) || session.parentID !== parentID) return
    merged.set(session.id, session)
  })
  return sortSessions([...merged.values()])
}

function affectedRoots(input: {
  sessionID: string
  nodes: ReadonlyMap<string, Node>
  sessions: ReadonlyMap<string, Session>
}) {
  const roots = new Set<string>()
  const current = input.nodes.get(input.sessionID)
  if (current) roots.add(current.rootSessionId)

  const root = rootOf(input.sessionID, input.nodes, input.sessions, new Set())
  if (root) roots.add(root)
  return [...roots]
}

function rootOf(
  sessionID: string,
  nodes: ReadonlyMap<string, Node>,
  sessions: ReadonlyMap<string, Session>,
  visited: ReadonlySet<string>,
): string | undefined {
  if (visited.has(sessionID)) return

  const session = sessions.get(sessionID)
  if (session) {
    if (!session.parentID) return session.id
    return rootOf(session.parentID, nodes, sessions, new Set(visited).add(sessionID))
  }
  return nodes.get(sessionID)?.rootSessionId
}

function sameNode(left: Node, right: Node) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readSession(input: {
  sdk: SDK
  statuses: Record<string, SessionStatus>
  failed: ReadonlySet<string>
  nodes: Node[]
  state: { descendants: number; visited: Set<string> }
  session: Session
  rootSessionId: string
  parentSessionId?: string
  depth: number
  deleted: ReadonlySet<string>
  sessions: ReadonlyMap<string, Session>
}): Promise<void> {
  if (input.state.visited.has(input.session.id)) throw new Error("subagent graph cannot contain cycles")
  if (input.depth > maxDepth) throw new Error(`subagent depth must not exceed ${maxDepth}`)

  input.state.visited.add(input.session.id)
  if (input.parentSessionId) {
    input.state.descendants += 1
    if (input.state.descendants > maxDescendants) {
      throw new Error(`subagent descendants must not exceed ${maxDescendants}`)
    }
  }

  input.nodes.push({
    runId: input.session.id,
    sessionId: input.session.id,
    rootSessionId: input.rootSessionId,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.session.agent ? { agent: input.session.agent } : {}),
    ...(input.session.title ? { title: input.session.title } : {}),
    phase: phaseOf(input.session.id, input.statuses[input.session.id], input.failed),
    createdAt: new Date(input.session.time.created).toISOString(),
    updatedAt: new Date(input.session.time.updated).toISOString(),
    cwd: input.session.directory,
    ...(input.session.cost === undefined ? {} : { directCost: serializeDirectCost(input.session.cost, "USD") }),
  })

  const children = await input.sdk.session.children({ sessionID: input.session.id })
  for (const child of mergeSessions(children.data ?? [], input.sessions, input.deleted, input.session.id)) {
    await readSession({
      ...input,
      session: child,
      parentSessionId: input.session.id,
      depth: input.depth + 1,
    })
  }
}

function sortSessions(sessions: Session[]) {
  return sessions.toSorted((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id))
}

function phaseOf(sessionId: string, status: SessionStatus | undefined, failed: ReadonlySet<string>): Phase {
  if (failed.has(sessionId)) return "failed"
  if (status?.type === "busy" || status?.type === "retry") return "running"
  if (status?.type === "idle") return "completed"
  return "unknown"
}

function validateSnapshot(input: Schema.Schema.Type<typeof Snapshot>): Snapshot {
  const snapshot = {
    generation: input.generation,
    revision: input.revision,
    nodes: input.nodes.map((node) => ({
      ...node,
      ...(node.directCost ? { directCost: { ...node.directCost } } : {}),
    })),
  }
  snapshot.nodes.forEach(validateDirectCost)

  const bySession = new Map(snapshot.nodes.map((node) => [node.sessionId, node]))
  if (bySession.size !== snapshot.nodes.length) throw new Error("subagent session IDs must be unique")

  const runIDs = new Set(snapshot.nodes.map((node) => node.runId))
  if (runIDs.size !== snapshot.nodes.length) throw new Error("subagent run IDs must be unique")

  snapshot.nodes.forEach((node) => {
    if (!node.parentSessionId) {
      if (node.rootSessionId !== node.sessionId) throw new Error("root node must match its root session ID")
      return
    }

    const parent = bySession.get(node.parentSessionId)
    if (!parent) throw new Error("subagent parent must be present in the snapshot")
    if (parent.rootSessionId !== node.rootSessionId) throw new Error("subagent parent must share its root session ID")
  })

  const nodesByRoot = snapshot.nodes.reduce((result, node) => {
    result.set(node.rootSessionId, [...(result.get(node.rootSessionId) ?? []), node])
    return result
  }, new Map<string, Node[]>())

  nodesByRoot.forEach((nodes, rootSessionId) => {
    const roots = nodes.filter((node) => !node.parentSessionId)
    if (roots.length !== 1 || roots[0]?.sessionId !== rootSessionId) {
      throw new Error("subagent root group must contain exactly one canonical root")
    }
    if (nodes.length - 1 > maxDescendants) throw new Error(`subagent descendants must not exceed ${maxDescendants}`)

    nodes.forEach((node) => {
      const depth = depthOf(node, bySession, new Set())
      if (depth > maxDepth) throw new Error(`subagent depth must not exceed ${maxDepth}`)
    })
  })

  return snapshot
}

function validateUpdate(input: Schema.Schema.Type<typeof Update>): Update {
  const update = {
    generation: input.generation,
    revision: input.revision,
    upsert: input.upsert.map((node) => ({
      ...node,
      ...(node.directCost ? { directCost: { ...node.directCost } } : {}),
    })),
    removedSessionIds: [...input.removedSessionIds],
  }
  update.upsert.forEach(validateDirectCost)

  const upserts = new Set(update.upsert.map((node) => node.sessionId))
  if (upserts.size !== update.upsert.length) throw new Error("subagent update session IDs must be unique")

  const removed = new Set(update.removedSessionIds)
  if (removed.size !== update.removedSessionIds.length) throw new Error("removed subagent session IDs must be unique")
  if (update.upsert.some((node) => removed.has(node.sessionId))) {
    throw new Error("subagent update cannot upsert and remove the same session")
  }

  return update
}

function validateDirectCost(node: Node) {
  if (!node.directCost) return

  const amount = new Decimal(node.directCost.amount)
  if (!amount.isFinite() || amount.isNegative()) throw new Error("direct cost must be finite and nonnegative")
}

function depthOf(node: Node, bySession: ReadonlyMap<string, Node>, visited: ReadonlySet<string>): number {
  if (!node.parentSessionId) return 0
  if (visited.has(node.sessionId)) throw new Error("subagent graph cannot contain cycles")

  const parent = bySession.get(node.parentSessionId)
  if (!parent) throw new Error("subagent parent must be present in the snapshot")
  return depthOf(parent, bySession, new Set(visited).add(node.sessionId)) + 1
}

export * as Subagent from "./subagent"
