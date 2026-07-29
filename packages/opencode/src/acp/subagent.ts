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

export function make(input: { sdk: SDK }): Service {
  const generation = crypto.randomUUID()
  const failed = new Set<string>()

  return {
    list: (params) => snapshot({ sdk: input.sdk, generation, params, failed }),
    subscribe: (params) => snapshot({ sdk: input.sdk, generation, params, failed }),
    handle: async (event) => {
      if (event.type === "session.error" && event.properties.sessionID) {
        failed.add(event.properties.sessionID)
      }
    },
    close: () => failed.clear(),
  }
}

async function snapshot(input: { sdk: SDK; generation: string; params: ListParams; failed: ReadonlySet<string> }) {
  const [rootsResponse, statusResponse] = await Promise.all([
    input.sdk.session.list({ roots: true }),
    input.sdk.session.status(),
  ])
  const statuses = statusResponse.data ?? {}
  const nodes: Node[] = []
  const roots = sortSessions(rootsResponse.data ?? []).filter(
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
    })
  }

  return encodeSnapshot({ generation: input.generation, revision: 0, nodes })
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
  for (const child of sortSessions(children.data ?? [])) {
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
