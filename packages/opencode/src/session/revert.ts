import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Snapshot } from "../snapshot"
import { Storage } from "@/storage/storage"
import { Session } from "./session"
import { optional } from "@opencode-ai/core/schema"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionSummary } from "./summary"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { and, asc, count, eq, gt, gte, or, sql } from "drizzle-orm"
import { MessageV2 } from "./message-v2"

export const RevertInput = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: Schema.optional(PartID),
})
export type RevertInput = Schema.Schema.Type<typeof RevertInput>

export const PreviewItem = Schema.Struct({
  id: MessageID,
  text: Schema.String,
})
export type PreviewItem = Schema.Schema.Type<typeof PreviewItem>

export const Preview = Schema.Struct({
  userCount: Schema.Finite,
  hasMore: Schema.Boolean,
  nextMessageID: optional(MessageID),
  continuationMessageID: optional(MessageID),
  partID: optional(PartID),
  items: Schema.Array(PreviewItem),
})
export type Preview = Schema.Schema.Type<typeof Preview>

export interface Interface {
  readonly revert: (input: RevertInput) => Effect.Effect<Session.Info, Session.BusyError>
  readonly unrevert: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info, Session.BusyError>
  readonly cleanup: (session: Session.Info) => Effect.Effect<void>
  readonly preview: (input: { sessionID: SessionID }) => Effect.Effect<Preview | undefined, Session.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRevert") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snap = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const events = yield* EventV2Bridge.Service
    const summary = yield* SessionSummary.Service
    const state = yield* SessionRunState.Service
    const database = yield* Database.Service
    const PreviewItemLimit = 100

    const previewText = (message: SessionV1.WithParts) => {
      const text = message.parts
        .flatMap((part) => (part.type === "text" && !part.synthetic && part.text.trim() ? [part.text.trim()] : []))
        .join("\n\n")
      if (text) return text
      const attachments = message.parts.flatMap((part) => (part.type === "file" ? [part.filename] : []))
      if (attachments.length === 0) return ""
      return attachments.map((name) => `[attachment:${name}]`).join(" ")
    }

    const preview = Effect.fn("SessionRevert.preview")(function* (input: { sessionID: SessionID }) {
      const session = yield* sessions.get(input.sessionID)
      const revert = session.revert
      if (!revert) return undefined
      const load = Effect.gen(function* () {
        const boundaryRow = yield* database.db
          .select()
          .from(MessageTable)
          .where(and(eq(MessageTable.session_id, input.sessionID), eq(MessageTable.id, revert.messageID)))
          .get()
          .pipe(Effect.orDie)
        if (!boundaryRow) return undefined
        const user = sql`json_extract(${MessageTable.data}, '$.role') = 'user'`
        const afterBoundary = or(
          gt(MessageTable.time_created, boundaryRow.time_created),
          and(eq(MessageTable.time_created, boundaryRow.time_created), gte(MessageTable.id, boundaryRow.id)),
        )
        const where = and(eq(MessageTable.session_id, input.sessionID), user, afterBoundary)
        const userCount =
          (yield* database.db.select({ value: count() }).from(MessageTable).where(where).get().pipe(Effect.orDie))
            ?.value ?? 0
        const rows = yield* database.db
          .select({ id: MessageTable.id })
          .from(MessageTable)
          .where(where)
          .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
          .limit(PreviewItemLimit + 1)
          .all()
          .pipe(Effect.orDie)
        const candidateIDs = revert.partID
          ? [revert.messageID, ...rows.flatMap((row) => (row.id === revert.messageID ? [] : [row.id]))]
          : rows.map((row) => row.id)
        const continuationMessageID = candidateIDs[PreviewItemLimit]
        const candidates = yield* MessageV2.getMany({
          sessionID: input.sessionID,
          messageIDs: candidateIDs.slice(0, PreviewItemLimit),
        }).pipe(Effect.provideService(Database.Service, database))
        const items = candidates.map((message) => ({ id: message.info.id, text: previewText(message) }))
        return {
          userCount,
          hasMore: continuationMessageID !== undefined,
          nextMessageID: items[items.findIndex((item) => item.id === revert.messageID) + 1]?.id,
          continuationMessageID,
          partID: revert.partID,
          items,
        }
      })
      return yield* load.pipe(
        Effect.catchIf(Storage.NotFoundError.isInstance, () =>
          load.pipe(Effect.catchIf(Storage.NotFoundError.isInstance, () => Effect.succeed(undefined))),
        ),
      )
    })

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      yield* state.assertNotBusy(input.sessionID)
      const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      let lastUser: SessionV1.User | undefined
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)

      let rev: Session.Info["revert"]
      const patches: Snapshot.Patch[] = []
      for (const msg of all) {
        if (msg.info.role === "user") lastUser = msg.info
        const remaining = []
        for (const part of msg.parts) {
          if (rev) {
            if (part.type === "patch") patches.push(part)
            continue
          }

          if (!rev) {
            if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
              const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
              rev = {
                messageID: !partID && lastUser ? lastUser.id : msg.info.id,
                partID,
              }
            }
            remaining.push(part)
          }
        }
      }

      if (!rev) return session

      rev.snapshot = session.revert?.snapshot ?? (yield* snap.track())
      if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* snap.revert(patches)
      if (rev.snapshot) rev.diff = yield* snap.diff(rev.snapshot)
      const index = all.findIndex((msg) => msg.info.id === rev.messageID)
      const range = index < 0 ? [] : all.slice(index)
      const diffs = yield* summary.computeDiff({ messages: range })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
      yield* sessions.setRevert({
        sessionID: input.sessionID,
        revert: rev,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      yield* Effect.logInfo("unreverting", { sessionID: input.sessionID })
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (!session.revert) return session
      if (session.revert.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* sessions.clearRevert(input.sessionID)
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      if (!session.revert) return
      const sessionID = session.id
      const msgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const messageID = session.revert.messageID
      const index = msgs.findIndex((msg) => msg.info.id === messageID)
      const target = index < 0 ? undefined : msgs[index]
      const remove = index < 0 ? [] : msgs.slice(index + (session.revert.partID ? 1 : 0))
      for (const msg of remove) {
        yield* sessions.removeMessage({ sessionID, messageID: msg.info.id })
      }
      if (session.revert.partID && target) {
        const partID = session.revert.partID
        const idx = target.parts.findIndex((part) => part.id === partID)
        if (idx >= 0) {
          const removeParts = target.parts.slice(idx)
          target.parts = target.parts.slice(0, idx)
          for (const part of removeParts) {
            yield* sessions.removePart({ sessionID, messageID: target.info.id, partID: part.id })
          }
        }
      }
      yield* sessions.clearRevert(sessionID)
    })

    return Service.of({ revert, unrevert, cleanup, preview })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Session.node,
    Snapshot.node,
    Storage.node,
    EventV2Bridge.node,
    SessionSummary.node,
    SessionRunState.node,
    Database.node,
  ],
})

export * as SessionRevert from "./revert"
