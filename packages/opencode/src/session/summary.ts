import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { isDeepStrictEqual } from "node:util"
import { Effect, Layer, Context, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { MessageDiffTable, MessageTable } from "@opencode-ai/core/session/sql"
import { EventTable } from "@opencode-ai/core/event/sql"
import { and, eq, sql } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Snapshot } from "@/snapshot"
import { NotFoundError } from "@/storage/storage"
import { Session } from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"
import { Config } from "@/config/config"
import { createDurableParentCache } from "./durable-parent-cache"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: SessionV1.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const database = yield* Database.Service
    // A message with a durable baseline is remembered so later changed summarizes skip the
    // historical-event scan; the bounded cache evicts least-recently-used identities.
    const durableParents = createDurableParentCache()

    const turnMessages = Effect.fn("SessionSummary.turnMessages")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const size = 50
      const newer = [] as SessionV1.WithParts[]
      let before: string | undefined
      while (true) {
        const next = yield* MessageV2.page({ sessionID: input.sessionID, limit: size, before }).pipe(
          Effect.provideService(Database.Service, database),
          Effect.orDie,
        )
        for (let i = next.items.length - 1; i >= 0; i--) {
          const item = next.items[i]
          if (item) newer.push(item)
        }
        if (newer.some((m) => m.info.id === input.messageID)) break
        if (!next.more || !next.cursor) break
        before = next.cursor
      }
      // Children normally sort newer than their parent, but client-supplied or
      // imported ids can invert that and land outside the window above. Backfill
      // any children the walk missed so the turn is complete regardless of order.
      if (newer.some((m) => m.info.id === input.messageID)) {
        const known = new Set(newer.map((m) => m.info.id))
        const orphans = yield* database.db
          .select({ id: MessageTable.id })
          .from(MessageTable)
          .where(
            and(
              eq(MessageTable.session_id, input.sessionID),
              sql`json_extract(${MessageTable.data}, '$.parentID') = ${input.messageID}`,
            ),
          )
          .all()
          .pipe(Effect.orDie)
        for (const row of orphans) {
          if (known.has(row.id)) continue
          const child = yield* MessageV2.get({ sessionID: input.sessionID, messageID: row.id }).pipe(
            Effect.provideService(Database.Service, database),
            Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
          )
          if (child) newer.push(child)
        }
        newer.sort((a, b) => a.info.time.created - b.info.time.created || (a.info.id < b.info.id ? -1 : 1))
        return newer
      }
      return newer.reverse()
    })

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: SessionV1.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      for (const item of input.messages) {
        if (!from) {
          for (const part of item.parts) {
            if (part.type === "step-start" && part.snapshot) {
              from = part.snapshot
              break
            }
          }
        }
        for (const part of item.parts) {
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      if (from && to) return yield* snapshot.diffFull(from, to)
      return []
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      if ((yield* config.get()).snapshot === false) return
      const all = yield* turnMessages({ sessionID: input.sessionID, messageID: input.messageID })
      if (!all.length) return

      const messages = all.filter(
        (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
      )
      const target = messages.find((m) => m.info.id === input.messageID)
      if (!target || target.info.role !== "user") return
      yield* Effect.yieldNow
      const msgDiffs = yield* computeDiff({ messages })
      const dedicated = yield* database.db
        .select({ message_id: MessageDiffTable.message_id })
        .from(MessageDiffTable)
        .where(eq(MessageDiffTable.message_id, input.messageID))
        .get()
        .pipe(Effect.orDie)
      if (dedicated && isDeepStrictEqual(target.info.summary?.diffs, msgDiffs)) return
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: 0,
          deletions: 0,
          files: 0,
        },
      })
      yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: [] })
      // Imported/historic rows have no durable message event, so a diff-only publish would replay
      // without its parent. Normal turns already have one, so this never adds a duplicate stream.
      // event_aggregate_type_seq_idx scopes this to the session's message.updated rows.
      const parentKey = `${input.sessionID}:${input.messageID}`
      const durableParent =
        durableParents.has(parentKey) ||
        (yield* database.db
          .select({ id: EventTable.id })
          .from(EventTable)
          .where(
            and(
              eq(EventTable.aggregate_id, input.sessionID),
              eq(EventTable.type, "message.updated.1"),
              sql`json_extract(${EventTable.data}, '$.info.id') = ${input.messageID}`,
            ),
          )
          .limit(1)
          .get()
          .pipe(Effect.orDie))
      if (!durableParent) {
        const baseline = target.info.summary
          ? { ...target.info, summary: { ...target.info.summary, diffs: [] } }
          : target.info
        yield* sessions.updateMessage(baseline)
      }
      durableParents.add(parentKey)
      // Turn patches are their own durable stream: ordinary message updates must never duplicate them.
      yield* events.publish(Session.Event.MessageDiffUpdated, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        diffs: msgDiffs,
      })
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      if (!input.messageID) return []
      // MessageV2.get hydrates through the same diff-row merge as the page
      // walk, so this returns identical values without scanning back every
      // newer page when an old turn's diff is requested.
      const message = yield* MessageV2.get({ sessionID: input.sessionID, messageID: input.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
      )
      if (!message || message.info.role !== "user") return []
      const diffs = message.info.summary?.diffs ?? []
      return diffs.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Session.node, Snapshot.node, EventV2Bridge.node, Config.node, Database.node],
})

export * as SessionSummary from "./summary"
