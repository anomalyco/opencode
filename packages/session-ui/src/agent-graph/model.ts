import type {
  AgentID,
  JsonValue,
  ModelRef,
  SessionID,
  SessionInfo,
  SessionMessageID,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client/promise"
import { Option, Schema } from "effect"

/**
 * `AgentTunnel.Message` — the wire/storage record for one tunnel message, from the agent tunnel plan
 * contract. Defined locally because the schema module lands on the backend branch; the integration
 * job swaps this type for the real `@opencode/schema` import without touching the surrounding code.
 */
export type TunnelMessage = {
  /** Doubles as the synthetic inbox item id used for delivery, so inbox idempotency rules apply. */
  id: SessionMessageID
  from: {
    sessionID: SessionID
    /** Sender's agent at send time; omitted when the session has none. */
    agent?: AgentID
  }
  to: {
    sessionID: SessionID
    /** Recipient's agent at send time; omitted when the session has none. */
    agent?: AgentID
  }
  kind: "message" | "report"
  /** The message content; shown when a graph arrow is clicked. */
  body: string
  /** Epoch milliseconds. */
  time: { created: number }
  /**
   * The recipient session's durable event seq; ascending within one recipient. Family queries order
   * by (time.created, sequence).
   */
  sequence: number
}

export type TunnelMessageKind = TunnelMessage["kind"]

export type AgentGraphNode = {
  id: SessionID
  /** The family parent when it is itself in the graph, else undefined (this node is the family root). */
  parentID: SessionID | undefined
  /** The session's title, its spawning description, or its id. */
  label: string
  agent: AgentID | undefined
  agentName: string | undefined
  agentColor: string | undefined
  status: "idle" | "running"
  model: ModelRef | undefined
  tokens: number
  cost: number
  /** The `subagent` call's description when this session was spawned by one. */
  description: string | undefined
  /** The latest spawn call's run time, else the session's creation. */
  started: number
}

export type SpawnEdge = {
  type: "spawn"
  from: SessionID
  to: SessionID
  agent: AgentID | undefined
  label: string | undefined
  started: number | undefined
}

export type MessageEdge = {
  type: "message"
  from: SessionID
  to: SessionID
  kind: TunnelMessageKind
  count: number
  last: TunnelMessage
}

export type AgentGraphEdge = SpawnEdge | MessageEdge

export type AgentGraph = {
  /** The family's root session, or undefined when the family is empty. */
  rootID: SessionID | undefined
  nodes: AgentGraphNode[]
  edges: AgentGraphEdge[]
}

export type AgentUsage = {
  agent: AgentID
  /** Assistant steps: one assistant message is one step. */
  steps: number
  tokens: number
  cost: number
}

export type SubtreeUsage = {
  /** Sessions in the subtree, including the root. */
  sessions: number
  tokens: number
  cost: number
}

const decodeString = Schema.decodeUnknownOption(Schema.String)

// Tool input and metadata are open JSON, so a field of the wrong type reads as absent.
const text = (value: JsonValue | undefined) => Option.getOrUndefined(decodeString(value))

/** Total tokens across input, output, reasoning and cache, as the TUI and usage chips count them. */
export function totalTokens(tokens: TokenUsageInfo) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function agentGraph(input: {
  sessions: readonly SessionInfo[]
  /** Any member of the family to show; the family is the root of its parent chain plus every descendant. */
  sessionID: SessionID | undefined
  status: (sessionID: SessionID) => "idle" | "running"
  /** Agent definitions for display names and colors. */
  agents?: readonly { id: AgentID; name: string; color?: string }[]
  /** A session's messages; the latest `subagent` part naming a child session labels that edge. */
  messages?: (sessionID: SessionID) => readonly SessionMessageInfo[]
  /** Tunnel messages between family members. */
  tunnelMessages?: readonly TunnelMessage[]
}): AgentGraph {
  const ids = familyIDs(input.sessions, input.sessionID)

  if (ids.length === 0) return { rootID: undefined, nodes: [], edges: [] }

  const byID = new Map(input.sessions.map((session) => [session.id, session]))
  const members = new Set(ids)
  const agentDefs = new Map((input.agents ?? []).map((agent) => [agent.id, agent]))
  // The latest call for each child names it, so later parts overwrite earlier ones.
  const calls = new Map<string, { agent: string | undefined; description: string | undefined; started: number }>()

  for (const id of ids) {
    for (const message of input.messages?.(id) ?? []) {
      if (message.type !== "assistant") continue

      for (const part of message.content) {
        if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") continue
        const child = text(part.state.metadata?.sessionID)

        if (!child || !members.has(child)) continue
        calls.set(child, {
          agent: text(part.state.input.agent),
          description: text(part.state.input.description),
          started: part.time.ran ?? part.time.created,
        })
      }
    }
  }

  const nodes = ids.flatMap((id): AgentGraphNode[] => {
    const session = byID.get(id)

    if (!session) return []
    const definition = session.agent ? agentDefs.get(session.agent) : undefined
    const call = calls.get(id)
    const parentID = session.parentID !== undefined && members.has(session.parentID) ? session.parentID : undefined

    return [
      {
        id,
        parentID,
        label: session.title ?? call?.description ?? id,
        agent: session.agent,
        agentName: definition?.name,
        agentColor: definition?.color,
        status: input.status(id),
        model: session.model,
        tokens: totalTokens(session.tokens),
        cost: session.cost,
        description: call?.description,
        started: call?.started ?? session.time.created,
      },
    ]
  })

  const spawnEdges = nodes.flatMap((node): SpawnEdge[] => {
    const call = calls.get(node.id)
    const parent = node.parentID ? byID.get(node.parentID) : undefined

    if (!parent) return []

    return [
      {
        type: "spawn",
        from: parent.id,
        to: node.id,
        agent: call?.agent,
        label: call?.description,
        started: call?.started,
      },
    ]
  })

  const messageEdges = messageEdgesFor(input.tunnelMessages ?? [], members)

  return {
    rootID: ids[0],
    nodes,
    edges: [...spawnEdges, ...messageEdges],
  }
}

/** Assistant-message usage folded per agent, in the order the agents first appear. */
export function usageByAgent(messages: readonly SessionMessageInfo[]) {
  const usage = new Map<AgentID, AgentUsage>()

  for (const message of messages) {
    if (message.type !== "assistant") continue

    const current = usage.get(message.agent)

    if (current) {
      current.steps += 1
      current.tokens += message.tokens ? totalTokens(message.tokens) : 0
      current.cost += message.cost ?? 0
      continue
    }

    usage.set(message.agent, {
      agent: message.agent,
      steps: 1,
      tokens: message.tokens ? totalTokens(message.tokens) : 0,
      cost: message.cost ?? 0,
    })
  }

  return [...usage.values()]
}

/** Token and cost roll-up of a session's subtree, the session included. */
export function subtreeUsage(sessions: readonly SessionInfo[], rootID: SessionID | undefined): SubtreeUsage {
  if (!rootID) return { sessions: 0, tokens: 0, cost: 0 }

  const children = childrenMap(sessions)

  return subtreeIDs(children, rootID).reduce<SubtreeUsage>(
    (usage, id) => {
      const session = sessions.find((session) => session.id === id)

      if (!session) return usage

      return {
        sessions: usage.sessions + 1,
        tokens: usage.tokens + totalTokens(session.tokens),
        cost: usage.cost + session.cost,
      }
    },
    { sessions: 0, tokens: 0, cost: 0 },
  )
}

/** The tunnel messages between two sessions, ordered by (time.created, sequence). */
export function messagesFor(messages: readonly TunnelMessage[], from: SessionID, to: SessionID) {
  return messages
    .filter((message) => message.from.sessionID === from && message.to.sessionID === to)
    .sort(byTunnelTime)
}

function messageEdgesFor(messages: readonly TunnelMessage[], members: Set<SessionID>) {
  const edges = new Map<string, MessageEdge>()

  for (const message of [...messages].sort(byTunnelTime)) {
    if (!members.has(message.from.sessionID) || !members.has(message.to.sessionID)) continue

    const key = `${message.from.sessionID} ${message.to.sessionID} ${message.kind}`
    const edge = edges.get(key)

    if (edge) {
      edge.count += 1
      edge.last = message
      continue
    }

    edges.set(key, {
      type: "message",
      from: message.from.sessionID,
      to: message.to.sessionID,
      kind: message.kind,
      count: 1,
      last: message,
    })
  }

  return [...edges.values()]
}

function byTunnelTime(a: TunnelMessage, b: TunnelMessage) {
  return a.time.created - b.time.created || a.sequence - b.sequence
}

function childrenMap(sessions: readonly SessionInfo[]) {
  return sessions.reduce((acc, session) => {
    if (!session.parentID) return acc
    const list = acc.get(session.parentID)

    if (list) list.push(session.id)
    else acc.set(session.parentID, [session.id])

    return acc
  }, new Map<SessionID, SessionID[]>())
}

/**
 * The family of a session, in breadth-first order from the root: the nearest ancestor without a
 * listed parent, then all its descendants. Seen sets on both walks tolerate malformed parent
 * cycles without hanging.
 */
function familyIDs(sessions: readonly SessionInfo[], sessionID: SessionID | undefined) {
  if (!sessionID || !sessions.some((session) => session.id === sessionID)) return []

  const parents = new Map(sessions.map((session) => [session.id, session.parentID]))
  const seen = new Set([sessionID])
  let rootID = sessionID

  for (let parent = parents.get(rootID); parent !== undefined && !seen.has(parent); parent = parents.get(rootID)) {
    seen.add(parent)
    rootID = parent
  }

  return subtreeIDs(childrenMap(sessions), rootID)
}

/** The root's descendants in breadth-first order, the root first. The seen set guards a cycle. */
function subtreeIDs(children: Map<SessionID, SessionID[]>, rootID: SessionID) {
  const seen = new Set([rootID])
  const ids = [rootID]

  for (const id of ids) {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  return ids
}
