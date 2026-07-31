import { Database } from "bun:sqlite"
import { migrateGatewayStore } from "./migrations"
import { sanitize } from "./sanitize"

export type TaskState =
  | "received"
  | "admitted"
  | "running"
  | "answered"
  | "sending"
  | "delivered"
  | "failed"
  | "uncertain_delivery"

export type GatewayTask = {
  id: string
  externalMessageHash: string
  conversationID: string
  sessionID: string
  promptMessageID: string
  turnID: string
  traceID: string
  promptText: string
  originalText: string
  replyTarget: string
  replyRootID?: string
  state: TaskState
  answer?: string
  receiveSequence: number
  sendAttempts: number
}

export type NewGatewayTask = Omit<GatewayTask, "receiveSequence" | "sendAttempts" | "answer"> & {
  answer?: string
  sendAttempts?: number
}

export type GatewayEventInput = {
  eventID: string
  eventType: string
  occurredAt: number
  conversationID: string
  turnID: string
  traceID: string
  messageID?: string
  sentenceID?: string
  sentenceIndex?: number
  parentEventID?: string
  relatedEventID?: string
  actor: "user" | "gateway" | "assistant" | "provider" | "operator"
  version: number
  status: string
  durationMs?: number
  content: unknown
}

export type GatewayEvent = GatewayEventInput & {
  sequence: number
}

export type GatewayStore = {
  admit(task: NewGatewayTask, events: readonly GatewayEventInput[]): { kind: "created" | "duplicate"; task: GatewayTask }
  getTask(taskID: string): GatewayTask | undefined
  transition(
    taskID: string,
    state: TaskState,
    update: {
      event: GatewayEventInput
      answer?: string
      sendAttempts?: number
    },
  ): GatewayTask
  appendEvent(event: GatewayEventInput): GatewayEvent
  eventsForTrace(traceID: string): GatewayEvent[]
  recoverableTasks(): GatewayTask[]
  close(): void
}

export class GatewayConflictError extends Error {
  constructor() {
    super("Conflicting Feishu message reuse")
    this.name = "GatewayConflictError"
  }
}

type TaskRow = {
  id: string
  external_message_hash: string
  conversation_id: string
  session_id: string
  prompt_message_id: string
  turn_id: string
  trace_id: string
  prompt_text: string
  original_text: string
  reply_target: string
  reply_root_id: string | null
  state: TaskState
  answer: string | null
  receive_sequence: number
  send_attempts: number
}

type EventRow = {
  sequence: number
  event_id: string
  event_type: string
  occurred_at: number
  conversation_id: string
  turn_id: string
  trace_id: string
  message_id: string | null
  sentence_id: string | null
  sentence_index: number | null
  parent_event_id: string | null
  related_event_id: string | null
  actor: GatewayEventInput["actor"]
  version: number
  status: string
  duration_ms: number | null
  content_json: string
}

const transitions: Record<TaskState, readonly TaskState[]> = {
  received: ["admitted", "failed"],
  admitted: ["running", "failed"],
  running: ["answered", "failed"],
  answered: ["sending", "failed"],
  sending: ["answered", "delivered", "failed", "uncertain_delivery"],
  delivered: [],
  failed: [],
  uncertain_delivery: [],
}

export function openGatewayStore(path: string, secrets: readonly string[] = []): GatewayStore {
  const database = new Database(path, { create: true, readwrite: true })
  migrateGatewayStore(database)

  const getTask = (taskID: string) => {
    const row = database.query<TaskRow, [string]>("SELECT * FROM gateway_task WHERE id = ?").get(taskID)
    return row ? mapTask(row) : undefined
  }
  const appendEvent = (event: GatewayEventInput) => {
    insertEvent(database, event, secrets)
    const row = database.query<EventRow, [string]>("SELECT * FROM gateway_event WHERE event_id = ?").get(event.eventID)
    if (!row) throw new Error("Committed gateway event was not found")
    return mapEvent(row)
  }

  return {
    admit(task, events) {
      const existing = database
        .query<TaskRow, [string]>("SELECT * FROM gateway_task WHERE external_message_hash = ?")
        .get(task.externalMessageHash)
      if (existing) {
        const mapped = mapTask(existing)
        if (isExactDuplicate(mapped, task)) return { kind: "duplicate", task: mapped }
        throw new GatewayConflictError()
      }
      if (task.state !== "received") throw new Error("New gateway tasks must start in received state")
      if (!events.length) throw new Error("Gateway admission requires at least one receipt event")

      return database.transaction(() => {
        const receiveSequence =
          database.query<{ value: number }, []>("SELECT COALESCE(MAX(receive_sequence), 0) + 1 AS value FROM gateway_task").get()!
            .value
        const occurredAt = events[0].occurredAt
        database.run(
          `INSERT INTO gateway_task (
            id, external_message_hash, conversation_id, session_id, prompt_message_id, turn_id, trace_id,
            prompt_text, original_text, reply_target, reply_root_id, state, answer, receive_sequence,
            send_attempts, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            task.externalMessageHash,
            task.conversationID,
            task.sessionID,
            task.promptMessageID,
            task.turnID,
            task.traceID,
            task.promptText,
            task.originalText,
            task.replyTarget,
            task.replyRootID ?? null,
            task.state,
            task.answer ?? null,
            receiveSequence,
            task.sendAttempts ?? 0,
            occurredAt,
            occurredAt,
          ],
        )
        events.forEach((event) => insertEvent(database, event, secrets))
        return { kind: "created" as const, task: getTask(task.id)! }
      }).immediate()
    },
    getTask,
    transition(taskID, state, update) {
      const task = getTask(taskID)
      if (!task) throw new Error("Gateway task not found")
      if (!transitions[task.state].includes(state))
        throw new Error(`Illegal gateway task transition: ${task.state} -> ${state}`)
      if (update.event.status !== state) throw new Error("Gateway transition event status must match task state")

      return database.transaction(() => {
        database.run(
          `UPDATE gateway_task
           SET state = ?, answer = ?, send_attempts = ?, updated_at = ?
           WHERE id = ?`,
          [
            state,
            update.answer ?? task.answer ?? null,
            update.sendAttempts ?? task.sendAttempts,
            update.event.occurredAt,
            taskID,
          ],
        )
        insertEvent(database, update.event, secrets)
        return getTask(taskID)!
      }).immediate()
    },
    appendEvent,
    eventsForTrace(traceID) {
      return database
        .query<EventRow, [string]>("SELECT * FROM gateway_event WHERE trace_id = ? ORDER BY sequence")
        .all(traceID)
        .map(mapEvent)
    },
    recoverableTasks() {
      return database
        .query<TaskRow, []>(
          "SELECT * FROM gateway_task WHERE state NOT IN ('delivered', 'failed', 'uncertain_delivery') ORDER BY receive_sequence",
        )
        .all()
        .map(mapTask)
    },
    close() {
      database.close()
    },
  }
}

function insertEvent(database: Database, event: GatewayEventInput, secrets: readonly string[]) {
  database.run(
    `INSERT INTO gateway_event (
      event_id, event_type, occurred_at, conversation_id, turn_id, trace_id, parent_event_id,
      related_event_id, message_id, sentence_id, sentence_index, actor, version, status, duration_ms, content_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.eventID,
      event.eventType,
      event.occurredAt,
      event.conversationID,
      event.turnID,
      event.traceID,
      event.parentEventID ?? null,
      event.relatedEventID ?? null,
      event.messageID ?? null,
      event.sentenceID ?? null,
      event.sentenceIndex ?? null,
      event.actor,
      event.version,
      event.status,
      event.durationMs ?? null,
      JSON.stringify(sanitize(event.content, secrets)),
    ],
  )
}

function isExactDuplicate(existing: GatewayTask, task: NewGatewayTask) {
  return (
    existing.id === task.id &&
    existing.conversationID === task.conversationID &&
    existing.sessionID === task.sessionID &&
    existing.promptMessageID === task.promptMessageID &&
    existing.turnID === task.turnID &&
    existing.traceID === task.traceID &&
    existing.promptText === task.promptText &&
    existing.originalText === task.originalText &&
    existing.replyTarget === task.replyTarget &&
    existing.replyRootID === task.replyRootID
  )
}

function mapTask(row: TaskRow): GatewayTask {
  return {
    id: row.id,
    externalMessageHash: row.external_message_hash,
    conversationID: row.conversation_id,
    sessionID: row.session_id,
    promptMessageID: row.prompt_message_id,
    turnID: row.turn_id,
    traceID: row.trace_id,
    promptText: row.prompt_text,
    originalText: row.original_text,
    replyTarget: row.reply_target,
    ...(row.reply_root_id ? { replyRootID: row.reply_root_id } : {}),
    state: row.state,
    ...(row.answer === null ? {} : { answer: row.answer }),
    receiveSequence: row.receive_sequence,
    sendAttempts: row.send_attempts,
  }
}

function mapEvent(row: EventRow): GatewayEvent {
  return {
    sequence: row.sequence,
    eventID: row.event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    conversationID: row.conversation_id,
    turnID: row.turn_id,
    traceID: row.trace_id,
    ...(row.message_id ? { messageID: row.message_id } : {}),
    ...(row.sentence_id ? { sentenceID: row.sentence_id } : {}),
    ...(row.sentence_index === null ? {} : { sentenceIndex: row.sentence_index }),
    ...(row.parent_event_id ? { parentEventID: row.parent_event_id } : {}),
    ...(row.related_event_id ? { relatedEventID: row.related_event_id } : {}),
    actor: row.actor,
    version: row.version,
    status: row.status,
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    content: JSON.parse(row.content_json),
  }
}
