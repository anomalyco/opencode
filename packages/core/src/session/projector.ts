export * as SessionProjector from "./projector"

import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { EventExact } from "../event-exact"
import { EventTable } from "../event/sql"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "./event"
import { SessionV1 } from "../v1/session"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { SessionMessage } from "./message"
import { SessionMessageUpdater } from "./message-updater"
import { SessionInput } from "./input"
import { WorkspaceV2 } from "../workspace"
import { MessageTable, PartTable, SessionInputTable, SessionMessageTable, SessionTable } from "./sql"
import type { DeepMutable } from "../schema"
import { isDeepStrictEqual } from "node:util"

type DatabaseService = Database.Interface["db"]

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

export class SessionAlreadyProjected extends Error {}

export class ClosureRecordError extends Error {}

export type ClosureRecordResult<Row> = {
  readonly status: "committed_new" | "existing_exact"
  readonly coordinate: EventExact.Coordinate
  readonly row: Row
}

export type ClosureRecordVerification = {
  readonly messageEvent: EventV2.ID
  readonly partEvent: EventV2.ID
  readonly info: SessionV1.User
  readonly part: SessionV1.TextPart
  readonly partTime: number
}

export interface ClosureRecordInterface {
  readonly message: (input: {
    readonly authority: EventExact.Authority
    readonly eventID: EventV2.ID
    readonly info: SessionV1.User
    readonly retained?: EventExact.Coordinate
  }) => Effect.Effect<ClosureRecordResult<typeof MessageTable.$inferSelect>, unknown>
  readonly part: (input: {
    readonly authority: EventExact.Authority
    readonly eventID: EventV2.ID
    readonly part: SessionV1.TextPart
    readonly time: number
    readonly retained?: EventExact.Coordinate
  }) => Effect.Effect<ClosureRecordResult<typeof PartTable.$inferSelect>, unknown>
  readonly verify: (input: { readonly records: readonly ClosureRecordVerification[] }) => Effect.Effect<void, unknown>
}

/** Internal high-level holder of EventExact; the opaque token never crosses this service boundary. */
export class ClosureRecordService extends Context.Service<ClosureRecordService, ClosureRecordInterface>()(
  "@opencode/SessionClosureRecord",
) {}

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

function usage(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"] | unknown): Usage | undefined {
  if (typeof part !== "object" || part === null) return undefined
  const value = part as Record<string, unknown>
  if (value.type !== "step-finish") return undefined
  if (!("cost" in value) || !("tokens" in value)) return undefined
  return { cost: value.cost as Usage["cost"], tokens: value.tokens as Usage["tokens"] }
}

function sessionRow(info: SessionV1.SessionInfo): typeof SessionTable.$inferInsert {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID ?? null,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs ? [...info.summary.diffs] : undefined,
    metadata: info.metadata,
    cost: info.cost ?? 0,
    tokens_input: (info.tokens ?? { input: 0 }).input,
    tokens_output: (info.tokens ?? { output: 0 }).output,
    tokens_reasoning: (info.tokens ?? { reasoning: 0 }).reasoning,
    tokens_cache_read: (info.tokens ?? { cache: { read: 0 } }).cache.read,
    tokens_cache_write: (info.tokens ?? { cache: { write: 0 } }).cache.write,
    revert: info.revert ? { ...info.revert, messageID: SessionMessage.ID.make(info.revert.messageID) } : null,
    permission: info.permission ? [...info.permission] : undefined,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function messageData(
  info: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["info"],
): typeof MessageTable.$inferInsert.data {
  const { id: _, sessionID: __, ...rest } = info
  return rest as DeepMutable<typeof rest>
}

function partData(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"]): typeof PartTable.$inferInsert.data {
  const { id: _, messageID: __, sessionID: ___, ...rest } = part
  return rest as DeepMutable<typeof rest>
}

function applyUsage(
  db: DatabaseService,
  sessionID: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["sessionID"],
  value: Usage,
  sign = 1,
) {
  return db
    .update(SessionTable)
    .set({
      cost: sql`${SessionTable.cost} + ${value.cost * sign}`,
      tokens_input: sql`${SessionTable.tokens_input} + ${value.tokens.input * sign}`,
      tokens_output: sql`${SessionTable.tokens_output} + ${value.tokens.output * sign}`,
      tokens_reasoning: sql`${SessionTable.tokens_reasoning} + ${value.tokens.reasoning * sign}`,
      tokens_cache_read: sql`${SessionTable.tokens_cache_read} + ${value.tokens.cache.read * sign}`,
      tokens_cache_write: sql`${SessionTable.tokens_cache_write} + ${value.tokens.cache.write * sign}`,
      time_updated: sql`${SessionTable.time_updated}`,
    })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
}

function run(db: DatabaseService, event: SessionEvent.Event) {
  return Effect.gen(function* () {
    const decodeRow = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })
    const updateMessage = (message: SessionMessage.Message) => {
      if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
      const encoded = encodeMessage(message)
      const { id, type, ...data } = encoded
      return db
        .update(SessionMessageTable)
        .set({ type, time_created: DateTime.toEpochMillis(message.time.created), data })
        .where(
          and(
            eq(SessionMessageTable.id, SessionMessage.ID.make(id)),
            eq(SessionMessageTable.session_id, event.data.sessionID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    }
    const appendMessage = (message: SessionMessage.Message) => insertMessage(db, event, message)
    const adapter: SessionMessageUpdater.Adapter = {
      getCurrentAssistant() {
        return Effect.gen(function* () {
          // A newer turn supersedes stale incomplete rows; never resume an older assistant projection.
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" && !message.time.completed ? message : undefined
        })
      },
      getAssistant(messageID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" ? message : undefined
        })
      },
      getCurrentShell(callID) {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "shell")))
            .orderBy(desc(SessionMessageTable.seq))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map(decodeRow)
            .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
        })
      },
      updateAssistant: updateMessage,
      updateShell: updateMessage,
      appendMessage,
    }
    yield* SessionMessageUpdater.update(adapter, event)
  })
}

function insertMessage(db: DatabaseService, event: SessionEvent.Event, message: SessionMessage.Message) {
  if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return db
    .insert(SessionMessageTable)
    .values({
      id: SessionMessage.ID.make(id),
      session_id: event.data.sessionID,
      type,
      seq: event.durable.seq,
      time_created: DateTime.toEpochMillis(message.time.created),
      data,
    })
    .run()
    .pipe(Effect.orDie)
}

const closureRecordLayer = Layer.effect(
  ClosureRecordService,
  Effect.gen(function* () {
    const exact = yield* EventExact.Service
    const { db } = yield* Database.Service

    const messageRow = (info: SessionV1.User): typeof MessageTable.$inferSelect => ({
      id: info.id,
      session_id: info.sessionID,
      time_created: info.time.created,
      time_updated: info.time.created,
      data: messageData(info),
    })
    const partRow = (part: SessionV1.TextPart, time: number): typeof PartTable.$inferSelect => ({
      id: part.id,
      message_id: part.messageID,
      session_id: part.sessionID,
      time_created: time,
      time_updated: time,
      data: partData(part),
    })

    const readMessage = (id: SessionV1.MessageID) =>
      db.select().from(MessageTable).where(eq(MessageTable.id, id)).get().pipe(Effect.orDie)
    const readPart = (id: SessionV1.PartID) =>
      db.select().from(PartTable).where(eq(PartTable.id, id)).get().pipe(Effect.orDie)

    const message: ClosureRecordInterface["message"] = Effect.fn("SessionProjector.closureMessage")(function* (input) {
      if (input.authority.kind !== "message")
        return yield* Effect.die(new ClosureRecordError("Message publication requires a message authority"))
      const expected = messageRow(input.info)
      const token = yield* exact.issue({
        definition: SessionV1.Event.MessageUpdated,
        id: input.eventID,
        data: { sessionID: input.info.sessionID, info: input.info },
        authority: input.authority,
        expectedRow: expected,
        retained: input.retained,
        projector: (event) =>
          Effect.gen(function* () {
            const projected = messageRow(event.data.info as SessionV1.User)
            const existing = yield* readMessage(projected.id)
            if (existing) return yield* Effect.die(new ClosureRecordError(`Message row ${projected.id} already exists`))
            yield* db.insert(MessageTable).values(projected).run().pipe(Effect.orDie)
          }),
      })
      const published = yield* exact.publish<typeof SessionV1.Event.MessageUpdated>(token)
      const row = yield* readMessage(expected.id)
      if (!row || !isDeepStrictEqual(row, expected))
        return yield* Effect.die(new ClosureRecordError(`Message row ${expected.id} failed exact readback`))
      return { status: published.status, coordinate: published.coordinate, row }
    })

    const part: ClosureRecordInterface["part"] = Effect.fn("SessionProjector.closurePart")(function* (input) {
      if (input.authority.kind !== "part")
        return yield* Effect.die(new ClosureRecordError("Part publication requires a part authority"))
      const expected = partRow(input.part, input.time)
      const token = yield* exact.issue({
        definition: SessionV1.Event.PartUpdated,
        id: input.eventID,
        data: { sessionID: input.part.sessionID, part: input.part, time: input.time },
        authority: input.authority,
        expectedRow: expected,
        retained: input.retained,
        projector: (event) =>
          Effect.gen(function* () {
            const projected = partRow(event.data.part as SessionV1.TextPart, event.data.time)
            const existing = yield* readPart(projected.id)
            if (existing) return yield* Effect.die(new ClosureRecordError(`Part row ${projected.id} already exists`))
            yield* db.insert(PartTable).values(projected).run().pipe(Effect.orDie)
          }),
      })
      const published = yield* exact.publish<typeof SessionV1.Event.PartUpdated>(token)
      const row = yield* readPart(expected.id)
      if (!row || !isDeepStrictEqual(row, expected))
        return yield* Effect.die(new ClosureRecordError(`Part row ${expected.id} failed exact readback`))
      return { status: published.status, coordinate: published.coordinate, row }
    })

    /**
     * Read-only physical postflight after exact authority has been consumed. It verifies frozen rows
     * and events, durable event order, and placement after existing transcript data without repair.
     */
    const verify: ClosureRecordInterface["verify"] = Effect.fn("SessionProjector.verifyClosureRecords")(
      function* (input) {
        const messageVersion = SessionV1.Event.MessageUpdated.durable?.version
        const partVersion = SessionV1.Event.PartUpdated.durable?.version
        if (messageVersion === undefined || partVersion === undefined)
          return yield* Effect.fail(new ClosureRecordError("Closure record events must be durable"))

        const messageIDs = input.records.map((item) => item.info.id)
        const partIDs = input.records.map((item) => item.part.id)
        const eventIDs = input.records.flatMap((item) => [item.messageEvent, item.partEvent])
        if (
          new Set(messageIDs).size !== messageIDs.length ||
          new Set(partIDs).size !== partIDs.length ||
          new Set(eventIDs).size !== eventIDs.length
        )
          return yield* Effect.fail(new ClosureRecordError("Closure record postflight received duplicate coordinates"))

        const observedEvents = new Map<
          EventV2.ID,
          {
            readonly aggregate: string
            readonly seq: number
            readonly type: string
            readonly data: Record<string, unknown>
          }
        >()
        for (const item of input.records) {
          const expectedMessage = messageRow(item.info)
          const expectedPart = partRow(item.part, item.partTime)
          const storedMessage = yield* readMessage(item.info.id)
          const storedPart = yield* readPart(item.part.id)
          if (!storedMessage || !isDeepStrictEqual(storedMessage, expectedMessage))
            return yield* Effect.fail(new ClosureRecordError(`Message row ${item.info.id} failed release readback`))
          if (!storedPart || !isDeepStrictEqual(storedPart, expectedPart))
            return yield* Effect.fail(new ClosureRecordError(`Part row ${item.part.id} failed release readback`))

          const messageEvent = yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.id, item.messageEvent))
            .get()
            .pipe(Effect.orDie)
          const partEvent = yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.id, item.partEvent))
            .get()
            .pipe(Effect.orDie)
          const messageData = Schema.encodeUnknownSync(SessionV1.Event.MessageUpdated.data)({
            sessionID: item.info.sessionID,
            info: item.info,
          }) as Record<string, unknown>
          const partData = Schema.encodeUnknownSync(SessionV1.Event.PartUpdated.data)({
            sessionID: item.part.sessionID,
            part: item.part,
            time: item.partTime,
          }) as Record<string, unknown>
          const messageExact =
            messageEvent?.aggregate_id === item.info.sessionID &&
            messageEvent.type === EventV2.versionedType(SessionV1.Event.MessageUpdated.type, messageVersion) &&
            isDeepStrictEqual(messageEvent.data, messageData)
          const partExact =
            partEvent?.aggregate_id === item.part.sessionID &&
            partEvent.type === EventV2.versionedType(SessionV1.Event.PartUpdated.type, partVersion) &&
            isDeepStrictEqual(partEvent.data, partData)
          if (!messageEvent || !messageExact)
            return yield* Effect.fail(
              new ClosureRecordError(`Message event ${item.messageEvent} failed release readback`),
            )
          if (!partEvent || !partExact)
            return yield* Effect.fail(new ClosureRecordError(`Part event ${item.partEvent} failed release readback`))
          if (messageEvent.seq >= partEvent.seq)
            return yield* Effect.fail(
              new ClosureRecordError(`Pair ${item.info.id}/${item.part.id} has reversed events`),
            )
          observedEvents.set(item.messageEvent, {
            aggregate: messageEvent.aggregate_id,
            seq: messageEvent.seq,
            type: messageEvent.type,
            data: messageEvent.data,
          })
          observedEvents.set(item.partEvent, {
            aggregate: partEvent.aggregate_id,
            seq: partEvent.seq,
            type: partEvent.type,
            data: partEvent.data,
          })
        }

        const targets = input.records
          .map((item) => item.info.sessionID)
          .filter((item, index, values) => values.indexOf(item) === index)
        for (const target of targets) {
          const expected = input.records.filter((item) => item.info.sessionID === target)
          const expectedMessages = new Set(expected.map((item) => item.info.id))
          const expectedParts = new Set(expected.map((item) => item.part.id))
          const messages = yield* db
            .select()
            .from(MessageTable)
            .where(eq(MessageTable.session_id, target))
            .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
            .all()
            .pipe(Effect.orDie)
          const parts = yield* db
            .select()
            .from(PartTable)
            .where(eq(PartTable.session_id, target))
            .all()
            .pipe(Effect.orDie)
          const orderedMessages = messages.filter((item) => expectedMessages.has(item.id)).map((item) => item.id)
          if (
            !isDeepStrictEqual(
              orderedMessages,
              expected.map((item) => item.info.id),
            )
          )
            return yield* Effect.fail(
              new ClosureRecordError(`Session ${target} has incorrect closure transcript order`),
            )

          const priorHighWater = Math.max(
            -1,
            ...messages
              .filter((item) => !expectedMessages.has(item.id))
              .flatMap((item) => [item.time_created, item.time_updated]),
            ...parts
              .filter((item) => !expectedParts.has(item.id))
              .flatMap((item) => [item.time_created, item.time_updated]),
          )
          const first = expected[0]
          if (!first || first.info.time.created <= priorHighWater)
            return yield* Effect.fail(
              new ClosureRecordError(`Session ${target} closure records precede transcript high-water`),
            )
          const timestampDrift = expected.slice(1).some((current, index) => {
            const previous = expected[index]
            return !previous || current.info.time.created <= previous.partTime
          })
          if (timestampDrift)
            return yield* Effect.fail(new ClosureRecordError(`Session ${target} closure timestamp order diverged`))

          const expectedEvents = expected.flatMap((item) => [item.messageEvent, item.partEvent])
          const orderedEvents = expectedEvents
            .map((id) => ({ id, event: observedEvents.get(id) }))
            .filter((item): item is { readonly id: EventV2.ID; readonly event: NonNullable<typeof item.event> } =>
              Boolean(item.event),
            )
            .toSorted((left, right) => left.event.seq - right.event.seq)
            .map((item) => item.id)
          if (!isDeepStrictEqual(orderedEvents, expectedEvents))
            return yield* Effect.fail(new ClosureRecordError(`Session ${target} has incorrect closure event order`))
        }
      },
    )

    return ClosureRecordService.of({ message, part, verify })
  }),
)

const projectorLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    yield* events.project(SessionV1.Event.Created, (event) =>
      Effect.gen(function* () {
        const stored = yield* db
          .insert(SessionTable)
          .values(sessionRow(event.data.info))
          .onConflictDoNothing()
          .returning({ sessionID: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!stored) return yield* Effect.die(new SessionAlreadyProjected())
        if (event.data.info.workspaceID) {
          yield* db
            .update(WorkspaceTable)
            .set({ time_used: Date.now() })
            .where(eq(WorkspaceTable.id, event.data.info.workspaceID))
            .run()
            .pipe(Effect.orDie)
        }
      }),
    )
    yield* events.project(SessionV1.Event.Updated, (event) =>
      db
        .update(SessionTable)
        .set(sessionRow(event.data.info))
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.Moved, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({
            directory: event.data.location.directory,
            path: event.data.subdirectory,
            workspace_id: event.data.location.workspaceID ? WorkspaceV2.ID.make(event.data.location.workspaceID) : null,
            time_updated: DateTime.toEpochMillis(event.data.timestamp),
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.Deleted, (event) =>
      db.delete(SessionTable).where(eq(SessionTable.id, event.data.sessionID)).run().pipe(Effect.orDie),
    )
    yield* events.project(SessionV1.Event.MessageUpdated, (event) =>
      Effect.gen(function* () {
        const time_created = event.data.info.time.created
        const id = event.data.info.id
        const sessionID = event.data.info.sessionID
        const data = messageData(event.data.info)
        yield* db
          .insert(MessageTable)
          .values({ id, session_id: sessionID, time_created, data })
          .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.MessageRemoved, (event) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.message_id, event.data.messageID), eq(PartTable.session_id, event.data.sessionID)))
          .all()
          .pipe(Effect.orDie)
        for (const row of rows) {
          const previous = usage(row.data)
          if (previous) yield* applyUsage(db, event.data.sessionID, previous, -1)
        }
        yield* db
          .delete(MessageTable)
          .where(and(eq(MessageTable.id, event.data.messageID), eq(MessageTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.PartRemoved, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .get()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        if (previous) yield* applyUsage(db, event.data.sessionID, previous, -1)
        yield* db
          .delete(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.PartUpdated, (event) =>
      Effect.gen(function* () {
        const id = event.data.part.id
        const messageID = event.data.part.messageID
        const sessionID = event.data.part.sessionID
        const data = partData(event.data.part)
        const row = yield* db.select().from(PartTable).where(eq(PartTable.id, id)).get().pipe(Effect.orDie)
        yield* db
          .insert(PartTable)
          .values({ id, message_id: messageID, session_id: sessionID, time_created: event.data.time, data })
          .onConflictDoUpdate({ target: PartTable.id, set: { data } })
          .run()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        const next = usage(event.data.part)
        if (previous) yield* applyUsage(db, row.session_id, previous, -1)
        if (next) yield* applyUsage(db, sessionID, next)
      }),
    )
    yield* events.project(SessionEvent.AgentSwitched, (event) =>
      db
        .update(SessionTable)
        .set({ agent: event.data.agent, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.andThen(run(db, event))),
    )
    yield* events.project(SessionEvent.ModelSwitched, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* run(db, event)
      }),
    )
    yield* events.project(SessionEvent.Prompted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectPrompted(db, {
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          delivery: event.data.delivery,
          timeCreated: event.data.timestamp,
          promotedSeq: event.durable.seq,
        })
        yield* run(db, event)
      }),
    )
    yield* events.project(SessionEvent.PromptAdmitted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectAdmitted(db, {
          admittedSeq: event.durable.seq,
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          delivery: event.data.delivery,
          timeCreated: event.data.timestamp,
        })
      }),
    )
    yield* events.project(SessionEvent.ContextUpdated, (event) => run(db, event))
    yield* events.project(SessionEvent.Synthetic, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Text.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Text.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Called, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Progress, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Success, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    // yield* events.project(SessionEvent.Retried, (event) => run(db, event))
    yield* events.project(SessionEvent.Compaction.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.RevertEvent.Staged, (event) =>
      db
        .update(SessionTable)
        .set({
          revert: { ...event.data.revert, files: event.data.revert.files ? [...event.data.revert.files] : undefined },
          time_updated: DateTime.toEpochMillis(event.data.timestamp),
        })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Cleared, (event) =>
      db
        .update(SessionTable)
        .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Committed, (event) =>
      Effect.gen(function* () {
        const boundary = yield* db
          .select({ seq: SessionMessageTable.seq })
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!boundary) return yield* Effect.die(`Revert boundary message not found: ${event.data.messageID}`)
        yield* db
          .delete(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), gt(SessionMessageTable.seq, boundary.seq)),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionInputTable)
          .where(
            and(
              eq(SessionInputTable.session_id, event.data.sessionID),
              or(gt(SessionInputTable.admitted_seq, boundary.seq), gt(SessionInputTable.promoted_seq, boundary.seq)),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
  }),
)

const layer = Layer.merge(projectorLayer, closureRecordLayer)

export const node = makeGlobalNode({ name: "session-projector", layer, deps: [EventV2.node, Database.node] })
