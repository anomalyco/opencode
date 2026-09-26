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
import { createLruCache } from "./lru-cache"

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
  readonly computeDiff: (input: {
    messages: SessionV1.WithParts[]
    sessionID?: SessionID
    messageID?: MessageID
  }) => Effect.Effect<Snapshot.FileDiff[] | undefined>
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
    // A removed message destroys its durable baseline, so drop the positive entry or a later
    // re-summarize would publish a diff without its parent (O2-18).
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== "message.removed") return Effect.void
      const { sessionID, messageID } = event.data as { sessionID: SessionID; messageID: MessageID }
      durableParents.delete(`${sessionID}:${messageID}`)
      return Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    // Bounded memo of the last computed (from, to) diff per message so repeated summarizes skip diffFull.
    const diffCache = createLruCache<string, { from: string; to: string; diffs: Snapshot.FileDiff[] }>()
    const summariesInflight = new Set<string>()
    const summariesRerun = new Set<string>()

    // The turn is exactly the target user message plus its assistant children.
    // Reading them directly avoids page-walking and hydrating the newer tail of
    // the session on every changed step, and the child lookups run concurrently
    // instead of one serial MessageV2.get per row (F-028, F-115).
    const turnMessages = Effect.fn("SessionSummary.turnMessages")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const target = yield* MessageV2.get({ sessionID: input.sessionID, messageID: input.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
      )
      if (!target || target.info.role !== "user") return []
      const children = yield* database.db
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
      const hydrated = yield* Effect.forEach(
        children,
        (row) =>
          MessageV2.get({ sessionID: input.sessionID, messageID: row.id }).pipe(
            Effect.provideService(Database.Service, database),
            Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
          ),
        { concurrency: 8 },
      )
      const messages = [
        target,
        ...hydrated.filter((item): item is SessionV1.WithParts => item !== undefined && item.info.role === "assistant"),
      ]
      messages.sort((a, b) => a.info.time.created - b.info.time.created || (a.info.id < b.info.id ? -1 : 1))
      return messages
    })

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: {
      messages: SessionV1.WithParts[]
      sessionID?: SessionID
      messageID?: MessageID
    }) {
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
      if (!from || !to || from === to) return []
      const cacheKey = input.sessionID && input.messageID ? `${input.sessionID}:${input.messageID}` : undefined
      const cached = cacheKey ? diffCache.get(cacheKey) : undefined
      if (cached && cached.from === from && cached.to === to) return cached.diffs.map((item) => ({ ...item }))
      // Same turn, newer step: reuse the prior row/patch per file and diff only what
      // the latest step touched, instead of re-diffing the whole turn every step.
      const previous =
        cached && cached.from === from && cached.to !== to ? { to: cached.to, diffs: cached.diffs } : undefined
      const diffs = yield* snapshot.diffFull(from, to, previous)
      // A failed or disabled snapshot read returns undefined instead of an empty diff.
      if (diffs === undefined) return undefined
      // Cache empty diffs too: a turn with from !== to but no file changes would otherwise
      // re-run diffFull on every step (O2-34).
      if (cacheKey) diffCache.set(cacheKey, { from, to, diffs })
      return diffs.map((item) => ({ ...item }))
    })

    const runSummarize = Effect.fn("SessionSummary.summarize")(function* (input: {
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
      const msgDiffs = yield* computeDiff({ sessionID: input.sessionID, messageID: input.messageID, messages })
      if (msgDiffs === undefined) return
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

    const summarize = Effect.fnUntraced(function* (input: { sessionID: SessionID; messageID: MessageID }) {
      const key = `${input.sessionID}:${input.messageID}`
      if (summariesInflight.has(key)) {
        summariesRerun.add(key)
        return
      }
      yield* Effect.gen(function* () {
        summariesInflight.add(key)
        while (true) {
          yield* runSummarize(input)
          if (summariesRerun.delete(key)) continue
          // The clear and the re-check must stay adjacent (no yield between) so a
          // concurrent caller either sets `rerun` before the clear or observes a
          // cleared `inflight` and becomes the new runner.
          summariesInflight.delete(key)
          if (!summariesRerun.delete(key)) return
          summariesInflight.add(key)
        }
      }).pipe(
        // A failed run must still release the latch, but only the latch: a concurrent
        // rerun signal stays set and is consumed by the next caller.
        Effect.ensuring(Effect.sync(() => summariesInflight.delete(key))),
      )
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
