export * as SessionTunnel from "./tunnel.js"

import { and, asc, eq, gt, inArray, or } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { AgentTunnel } from "@opencode/schema/agent-tunnel"
import { Event } from "@opencode/schema/event"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { Session } from "../session.js"
import { NotFoundError } from "./error.js"
import { SessionEvent } from "./event.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionTunnelTable } from "./sql.js"

export class NotInFamilyError extends Schema.TaggedError<NotInFamilyError>()("SessionTunnel.NotInFamilyError", {
  from: SessionSchema.ID,
  to: SessionSchema.ID,
}) {
  override get message() {
    return `Session ${this.to} is not in the family of session ${this.from}`
  }
}

export class ReportTargetError extends Schema.TaggedError<ReportTargetError>()("SessionTunnel.ReportTargetError", {
  from: SessionSchema.ID,
  to: SessionSchema.ID,
}) {
  override get message() {
    return `Reports must target an ancestor of session ${this.from}; ${this.to} is not one`
  }
}

export class ConflictError extends Schema.TaggedError<ConflictError>()("SessionTunnel.ConflictError", {
  id: SessionMessage.ID,
  sessionID: SessionSchema.ID,
}) {}

export type SendError = NotFoundError | NotInFamilyError | ReportTargetError | ConflictError

export interface SendInput {
  readonly from: SessionSchema.ID
  readonly to: SessionSchema.ID
  readonly kind: AgentTunnel.Kind
  readonly body: string
  /** Passing the id of an already-sent message makes the resend idempotent, mirroring inbox admission. */
  readonly id?: SessionMessage.ID
}

export interface Interface {
  readonly send: (input: SendInput) => Effect.Effect<AgentTunnel.Message, SendError>
  readonly list: (input: {
    readonly sessionID: SessionSchema.ID
    readonly after?: number
  }) => Effect.Effect<readonly AgentTunnel.Message[], NotFoundError>
  /** The family of a session: its root plus every descendant, including the session itself. */
  readonly family: (sessionID: SessionSchema.ID) => Effect.Effect<readonly SessionSchema.Info[], NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTunnel") {}

const decodeRow = (row: typeof SessionTunnelTable.$inferSelect): AgentTunnel.Message =>
  AgentTunnel.Message.make({
    id: row.id,
    from: { sessionID: row.from_session_id, agent: row.from_agent ?? undefined },
    to: { sessionID: row.to_session_id, agent: row.to_agent ?? undefined },
    kind: row.kind,
    body: row.body,
    time: { created: row.time_created },
    sequence: Event.Seq.make(row.sequence),
  })

export const make = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const store = yield* SessionStore.Service
  const bus = yield* Bus.Service
  const db = (yield* Database.Service).db

  const find = Effect.fn("SessionTunnel.find")(function* (id: SessionMessage.ID) {
    const row = yield* db.select().from(SessionTunnelTable).where(eq(SessionTunnelTable.id, id)).get().pipe(Effect.orDie)
    return row ? decodeRow(row) : undefined
  })

  /** The `parentID` chain above a session, nearest first; a dangling or looping parent ends the walk. */
  const ancestors = Effect.fn("SessionTunnel.ancestors")(function* (sessionID: SessionSchema.ID) {
    const chain = new Array<SessionSchema.Info>()
    const seen = new Set<SessionSchema.ID>([sessionID])
    let current = yield* store.get(sessionID)
    while (current?.parentID !== undefined && !seen.has(current.parentID)) {
      seen.add(current.parentID)
      const parent = yield* store.get(current.parentID)
      if (parent === undefined) break
      chain.push(parent)
      current = parent
    }
    return chain
  })

  const family = Effect.fn("SessionTunnel.family")(function* (sessionID: SessionSchema.ID) {
    const start = yield* sessions.get(sessionID)
    const root = (yield* ancestors(sessionID)).at(-1) ?? start
    const members = [root]
    const seen = new Set<SessionSchema.ID>([root.id])
    for (const member of members) {
      for (const child of yield* store.list({ parentID: member.id }))
        if (!seen.has(child.id)) {
          seen.add(child.id)
          members.push(child)
        }
    }
    return members
  })

  const send = Effect.fn("SessionTunnel.send")(function* (input: SendInput) {
    const from = yield* sessions.get(input.from)
    const to = yield* sessions.get(input.to)
    if (to.id === from.id || !(yield* family(input.from)).some((member) => member.id === to.id))
      return yield* new NotInFamilyError({ from: from.id, to: to.id })
    if (input.kind === "report" && !(yield* ancestors(input.from)).some((member) => member.id === to.id))
      return yield* new ReportTargetError({ from: from.id, to: to.id })
    // First admission wins, exactly like inbox reconcile: a resent id returns the original message.
    const existing = input.id === undefined ? undefined : yield* find(input.id)
    if (existing !== undefined && existing.to.sessionID !== to.id)
      return yield* new ConflictError({ id: existing.id, sessionID: to.id })
    const message =
      existing ??
      AgentTunnel.Message.make({
        id: input.id ?? SessionMessage.ID.create(),
        from: { sessionID: from.id, agent: from.agent },
        to: { sessionID: to.id, agent: to.agent },
        kind: input.kind,
        body: input.body,
        time: { created: yield* Clock.currentTimeMillis },
        // The bus assigns the real durable seq on commit; this prediction is exact for an otherwise
        // idle recipient, and reads never trust it (the projection stores the assigned seq).
        sequence: Event.Seq.make((yield* Bus.latestSequence(db, to.id)) + 1),
      })
    if (existing === undefined) yield* bus.publish(SessionEvent.TunnelSent, { sessionID: to.id, message })
    // Delivery: the shared message id is the synthetic inbox item id, so a retried send reconciles
    // with the recipient's pending inbox (first admission wins) and cross-recipient reuse fails.
    yield* sessions.synthetic({
      sessionID: to.id,
      id: message.id,
      text: [
        `Message from another session in this family (${message.kind}).`,
        `From: session ${from.id}${from.agent === undefined ? "" : ` (agent: ${from.agent})`}`,
        "",
        message.body,
      ].join("\n"),
      description: `tunnel ${message.kind} from ${from.id}`,
      metadata: { source: "tunnel", from: from.id, kind: message.kind },
    }).pipe(
      // The id already names a different admitted item on this recipient (for example a user
      // message); surface it as the tunnel's own conflict rather than the session's.
      Effect.catchTag("Session.SyntheticConflictError", () => new ConflictError({ id: message.id, sessionID: to.id })),
    )
    return message
  })

  const list = Effect.fn("SessionTunnel.list")(function* (input: {
    readonly sessionID: SessionSchema.ID
    readonly after?: number
  }) {
    const members = yield* family(input.sessionID)
    const ids = members.map((member) => member.id)
    const rows = yield* db
      .select()
      .from(SessionTunnelTable)
      .where(
        and(
          or(inArray(SessionTunnelTable.from_session_id, ids), inArray(SessionTunnelTable.to_session_id, ids)),
          input.after === undefined ? undefined : gt(SessionTunnelTable.sequence, input.after),
        ),
      )
      .orderBy(asc(SessionTunnelTable.time_created), asc(SessionTunnelTable.sequence))
      .all()
      .pipe(Effect.orDie)
    return rows.map(decodeRow)
  })

  return Service.of({ send, list, family })
})

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, SessionStore.node, Database.node, Bus.node],
})
