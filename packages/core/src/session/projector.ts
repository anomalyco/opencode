export * as SessionProjector from "./projector"

import { and, eq } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionMessageUpdater } from "./message-updater"
import { SessionMessageTable, SessionTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

function run(db: DatabaseService, event: SessionEvent.Event) {
  return Effect.gen(function* () {
    const adapter: SessionMessageUpdater.Adapter = {
      getCurrentAssistant() {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
            .find(
              (message): message is SessionMessage.Assistant => message.type === "assistant" && !message.time.completed,
            )
        })
      },
      getCurrentCompaction() {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "compaction")))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
            .find((message): message is SessionMessage.Compaction => message.type === "compaction")
        })
      },
      getCurrentShell(callID) {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "shell")))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
            .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
        })
      },
      updateAssistant(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
      updateCompaction(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
      updateShell(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
      appendMessage(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
    }
    yield* SessionMessageUpdater.update(adapter, event)
  })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    yield* events.project(SessionEvent.AgentSwitched, (event) =>
      Effect.gen(function* () {
        const message = Schema.encodeSync(SessionMessage.AgentSwitched)(
          new SessionMessage.AgentSwitched({
            id: event.id,
            type: "agent-switched",
            metadata: event.metadata,
            agent: event.data.agent,
            time: { created: event.data.timestamp },
          }),
        )
        const data = { metadata: message.metadata, agent: message.agent, time: message.time }
        yield* db
          .update(SessionTable)
          .set({ agent: event.data.agent, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionMessageTable)
          .values([
            {
              id: SessionMessage.ID.make(event.id),
              session_id: event.data.sessionID,
              type: "agent-switched",
              time_created: DateTime.toEpochMillis(event.data.timestamp),
              data,
            },
          ])
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionEvent.ModelSwitched, (event) =>
      Effect.gen(function* () {
        const message = Schema.encodeSync(SessionMessage.ModelSwitched)(
          new SessionMessage.ModelSwitched({
            id: event.id,
            type: "model-switched",
            metadata: event.metadata,
            model: event.data.model,
            time: { created: event.data.timestamp },
          }),
        )
        const data = { metadata: message.metadata, model: message.model, time: message.time }
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionMessageTable)
          .values([
            {
              id: SessionMessage.ID.make(event.id),
              session_id: event.data.sessionID,
              type: "model-switched",
              time_created: DateTime.toEpochMillis(event.data.timestamp),
              data,
            },
          ])
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionEvent.Prompted, (event) => run(db, event))
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
    yield* events.project(SessionEvent.Tool.Success, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Retried, (event) => run(db, event))
    yield* events.project(SessionEvent.Compaction.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Compaction.Ended, (event) => run(db, event))
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
