import { and, desc, eq } from "@/storage/db"
import type { Database } from "@/storage/db"
import { SessionMessage } from "@/v2/session-message"
import { SessionMessageUpdater } from "@/v2/session-message-updater"
import { SessionEvent } from "@/v2/session-event"
import * as DateTime from "effect/DateTime"
import { SyncEvent } from "@/sync"
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
  SyncEvent.project(SessionEvent.AgentSwitched.Sync, (db, data, event) => {
    db.update(SessionTable)
      .set({
        agent: data.agent,
        time_updated: DateTime.toEpochMillis(data.timestamp),
      })
      .where(eq(SessionTable.id, data.sessionID))
      .run()
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.agent.switched", data })
  }),
  SyncEvent.project(SessionEvent.ModelSwitched.Sync, (db, data, event) => {
    db.update(SessionTable)
      .set({
        model: data.model,
        time_updated: DateTime.toEpochMillis(data.timestamp),
      })
      .where(eq(SessionTable.id, data.sessionID))
      .run()
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.model.switched", data })
  }),
  SyncEvent.project(SessionEvent.Prompted.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.prompted", data })
  }),
  SyncEvent.project(SessionEvent.Synthetic.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.synthetic", data })
  }),
  SyncEvent.project(SessionEvent.Shell.Started.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.shell.started", data })
  }),
  SyncEvent.project(SessionEvent.Shell.Ended.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.shell.ended", data })
  }),
  SyncEvent.project(SessionEvent.Step.Started.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.started", data })
  }),
  SyncEvent.project(SessionEvent.Step.Ended.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.ended", data })
  }),
  SyncEvent.project(SessionEvent.Step.Failed.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.failed", data })
  }),
  SyncEvent.project(SessionEvent.Text.Started.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.text.started", data })
  }),
  SyncEvent.project(SessionEvent.Text.Delta.Sync, () => {}),
  SyncEvent.project(SessionEvent.Text.Ended.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.text.ended", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Input.Started.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.input.started", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Input.Delta.Sync, () => {}),
  SyncEvent.project(SessionEvent.Tool.Input.Ended.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.input.ended", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Called.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.called", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Success.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.success", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Failed.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.failed", data })
  }),
  SyncEvent.project(SessionEvent.Reasoning.Started.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.reasoning.started", data })
  }),
  SyncEvent.project(SessionEvent.Reasoning.Delta.Sync, () => {}),
  SyncEvent.project(SessionEvent.Reasoning.Ended.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.reasoning.ended", data })
  }),
  SyncEvent.project(SessionEvent.Retried.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.retried", data })
  }),
  SyncEvent.project(SessionEvent.Compaction.Started.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.compaction.started", data })
  }),
  SyncEvent.project(SessionEvent.Compaction.Delta.Sync, () => {}),
  SyncEvent.project(SessionEvent.Compaction.Ended.Sync, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.compaction.ended", data })
  }),
]
