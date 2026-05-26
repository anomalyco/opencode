import { and, desc, eq } from "@/storage/db"
import type { Database } from "@/storage/db"
import { SessionMessage } from "@opencode-ai/core/session-message"
import { SessionMessageUpdater } from "@opencode-ai/core/session-message-updater"
import { SessionEvent } from "@opencode-ai/core/session-event"
import * as DateTime from "effect/DateTime"
import { SyncEvent } from "@/sync"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionMessageTable, SessionTable } from "./session.sql"
import type { SessionID } from "./schema"
import { Schema } from "effect"

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
type SessionMessageData = NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>

function encodeDateTimes(value: unknown): unknown {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value)
  if (Array.isArray(value)) return value.map(encodeDateTimes)
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeDateTimes(item)]))
  }
  return value
}

function encodeMessageData(value: unknown): SessionMessageData {
  return encodeDateTimes(value) as SessionMessageData
}

function sqlite(db: Database.TxOrDb, sessionID: SessionID): SessionMessageUpdater.Adapter<void> {
  return {
    getCurrentAssistant() {
      return db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "assistant")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
        .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
        .find((message): message is SessionMessage.Assistant => message.type === "assistant" && !message.time.completed)
    },
    getCurrentCompaction() {
      return db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
        .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
        .find((message): message is SessionMessage.Compaction => message.type === "compaction")
    },
    getCurrentShell(callID) {
      return db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "shell")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
        .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
        .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
    },
    updateAssistant(assistant) {
      const { id, type, ...data } = assistant
      db.update(SessionMessageTable)
        .set({ data: encodeMessageData(data) })
        .where(
          and(
            eq(SessionMessageTable.id, id),
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, type),
          ),
        )
        .run()
    },
    updateCompaction(compaction) {
      const { id, type, ...data } = compaction
      db.update(SessionMessageTable)
        .set({ data: encodeMessageData(data) })
        .where(
          and(
            eq(SessionMessageTable.id, id),
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, type),
          ),
        )
        .run()
    },
    updateShell(shell) {
      const { id, type, ...data } = shell
      db.update(SessionMessageTable)
        .set({ data: encodeMessageData(data) })
        .where(
          and(
            eq(SessionMessageTable.id, id),
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, type),
          ),
        )
        .run()
    },
    appendMessage(message) {
      const { id, type, ...data } = message
      db.insert(SessionMessageTable)
        .values([
          {
            id,
            session_id: sessionID,
            type,
            time_created: DateTime.toEpochMillis(message.time.created),
            data: encodeMessageData(data),
          },
        ])
        .run()
    },
    finish() {},
  }
}

function update(db: Database.TxOrDb, event: SessionEvent.Event) {
  SessionMessageUpdater.update(sqlite(db, event.data.sessionID), event)
}

export default [
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.AgentSwitched), (db, data, event) => {
    db.update(SessionTable)
      .set({
        agent: data.agent,
        time_updated: DateTime.toEpochMillis(data.timestamp),
      })
      .where(eq(SessionTable.id, data.sessionID))
      .run()
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.agent.switched", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.ModelSwitched), (db, data, event) => {
    db.update(SessionTable)
      .set({
        model: data.model,
        time_updated: DateTime.toEpochMillis(data.timestamp),
      })
      .where(eq(SessionTable.id, data.sessionID))
      .run()
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.model.switched", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Prompted), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.prompted", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Synthetic), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.synthetic", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Shell.Started), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.shell.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Shell.Ended), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.shell.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Step.Started), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Step.Ended), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Step.Failed), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.failed", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Text.Started), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.text.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Text.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Text.Ended), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.text.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Input.Started), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.input.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Input.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Input.Ended), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.input.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Called), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.called", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Success), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.success", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Failed), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.failed", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Reasoning.Started), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.reasoning.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Reasoning.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Reasoning.Ended), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.reasoning.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Retried), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.retried", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Compaction.Started), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.compaction.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Compaction.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Compaction.Ended), (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.compaction.ended", data })
  }),
]
