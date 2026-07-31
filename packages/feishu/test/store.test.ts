import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  GatewayConflictError,
  type GatewayEventInput,
  type NewGatewayTask,
  openGatewayStore,
} from "../src/store"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("gateway store", () => {
  test("applies additive schema once with WAL, foreign keys, and append-only triggers", async () => {
    const path = await databasePath()
    openGatewayStore(path).close()
    openGatewayStore(path).close()

    const database = new Database(path)
    expect(database.query<{ version: number }, []>("SELECT version FROM gateway_schema_version").get()).toEqual({
      version: 2,
    })
    expect(database.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal")
    expect(
      database
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'gateway_event_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual(["gateway_event_no_delete", "gateway_event_no_update"])
    database.close()
  })

  test("upgrades version 1 tasks without losing their data", async () => {
    const path = await databasePath()
    const database = new Database(path)
    database.exec(`
      CREATE TABLE gateway_schema_version (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO gateway_schema_version (singleton, version) VALUES (1, 1);
      CREATE TABLE gateway_task (
        id TEXT PRIMARY KEY,
        external_message_hash TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        prompt_message_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        original_text TEXT NOT NULL,
        reply_target TEXT NOT NULL,
        reply_root_id TEXT,
        state TEXT NOT NULL,
        answer TEXT,
        receive_sequence INTEGER NOT NULL UNIQUE,
        send_attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO gateway_task (
        id, external_message_hash, conversation_id, session_id, prompt_message_id, turn_id, trace_id,
        prompt_text, original_text, reply_target, state, receive_sequence, send_attempts, created_at, updated_at
      ) VALUES (
        'task_legacy', 'hash_legacy', 'conv_legacy', 'ses_feishu_legacy', 'msg_feishu_legacy', 'turn_legacy', 'trace_legacy',
        'legacy prompt', 'legacy original', 'oc_chat_legacy', 'received', 1, 0, 1700000000000, 1700000000000
      );
    `)
    database.close()

    const store = openGatewayStore(path)
    expect(store.getTask("task_legacy")).toEqual(
      expect.objectContaining({ id: "task_legacy", promptText: "legacy prompt", replyTarget: "oc_chat_legacy" }),
    )
    store.close()

    const upgraded = new Database(path)
    expect(upgraded.query<{ version: number }, []>("SELECT version FROM gateway_schema_version").get()).toEqual({ version: 2 })
    expect(
      upgraded
        .query<{ name: string }, []>("SELECT name FROM pragma_table_info('gateway_task') WHERE name LIKE 'reply_mention_%'")
        .all()
        .map((column) => column.name),
    ).toEqual(["reply_mention_id", "reply_mention_name"])
    upgraded.close()
  })

  test("enforces event relationships through the store connection", async () => {
    const store = openGatewayStore(await databasePath())

    try {
      expect(() =>
        store.appendEvent(
          event("evt_orphan", "model_started", {
            parentEventID: "evt_missing",
          }),
        ),
      ).toThrow("FOREIGN KEY constraint failed")
      expect(store.eventsForTrace("trace_1")).toEqual([])
    } finally {
      store.close()
    }
  })

  test("atomically admits a task and receipt events in durable receive order", async () => {
    const store = openGatewayStore(await databasePath())
    const first = store.admit(task(), [event("evt_received", "message_received")])
    const second = store.admit(task({ id: "task_2", externalMessageHash: "hash_2", traceID: "trace_2" }), [
      event("evt_received_2", "message_received", { traceID: "trace_2" }),
    ])

    expect(first.kind).toBe("created")
    expect(first.task.receiveSequence).toBe(1)
    expect(first.task.sendAttempts).toBe(0)
    expect(second.task.receiveSequence).toBe(2)
    expect(store.eventsForTrace("trace_1").map((item) => item.eventType)).toEqual(["message_received"])
    store.close()
  })

  test("coalesces exact duplicates and rejects conflicting message reuse", async () => {
    const store = openGatewayStore(await databasePath())
    const original = store.admit(task(), [event("evt_received", "message_received")])
    const duplicate = store.admit(task(), [event("evt_duplicate_ignored", "message_received")])

    expect(original.kind).toBe("created")
    expect(duplicate.kind).toBe("duplicate")
    expect(duplicate.task).toEqual(original.task)
    expect(store.eventsForTrace("trace_1")).toHaveLength(1)
    expect(() =>
      store.admit(task({ promptText: "changed content" }), [event("evt_conflict", "message_received")]),
    ).toThrow(GatewayConflictError)
    expect(() =>
      store.admit(task({ sessionID: "ses_feishu_changed" }), [event("evt_conflict_2", "message_received")]),
    ).toThrow(GatewayConflictError)
    expect(() =>
      store.admit(task({ replyMentionID: "ou_user_1" }), [event("evt_conflict_3", "message_received")]),
    ).toThrow(GatewayConflictError)
    expect(() =>
      store.admit(task({ replyMentionName: "姹傜簿杞存壙" }), [event("evt_conflict_4", "message_received")]),
    ).toThrow(GatewayConflictError)
    store.close()
  })

  test("persists group reply mentions through recovery after reopening", async () => {
    const path = await databasePath()
    const store = openGatewayStore(path)
    const admitted = store.admit(
      task({ replyMentionID: "ou_user_1", replyMentionName: "姹傜簿杞存壙" }),
      [event("evt_received", "message_received")],
    )

    expect(admitted.task).toEqual(
      expect.objectContaining({ replyMentionID: "ou_user_1", replyMentionName: "姹傜簿杞存壙" }),
    )
    store.close()

    const reopened = openGatewayStore(path)
    expect(reopened.recoverableTasks()).toEqual([
      expect.objectContaining({ replyMentionID: "ou_user_1", replyMentionName: "姹傜簿杞存壙" }),
    ])
    reopened.close()
  })

  test("keeps direct tasks valid without reply mentions", async () => {
    const store = openGatewayStore(await databasePath())
    const admitted = store.admit(task(), [event("evt_received", "message_received")])

    expect(admitted.task).not.toHaveProperty("replyMentionID")
    expect(admitted.task).not.toHaveProperty("replyMentionName")
    store.close()
  })

  test("advances state and event in one transaction and rejects illegal transitions", async () => {
    const store = openGatewayStore(await databasePath())
    store.admit(task(), [event("evt_received", "message_received")])
    store.transition("task_1", "admitted", { event: event("evt_admitted", "prompt_admitted", { status: "admitted" }) })

    expect(store.getTask("task_1")?.state).toBe("admitted")
    expect(store.eventsForTrace("trace_1").map((item) => item.status)).toEqual(["received", "admitted"])
    expect(() =>
      store.transition("task_1", "delivered", {
        event: event("evt_illegal", "delivery_confirmed", { status: "delivered" }),
      }),
    ).toThrow("Illegal gateway task transition")

    expect(() =>
      store.transition("task_1", "running", {
        event: event("evt_admitted", "model_started", { status: "running" }),
      }),
    ).toThrow()
    expect(store.getTask("task_1")?.state).toBe("admitted")
    expect(store.eventsForTrace("trace_1")).toHaveLength(2)
    store.close()
  })

  test("persists answers, attempts, and only returns non-terminal recovery work", async () => {
    const store = openGatewayStore(await databasePath())
    store.admit(task(), [event("evt_received", "message_received")])
    store.transition("task_1", "admitted", { event: event("evt_admitted", "prompt_admitted", { status: "admitted" }) })
    store.transition("task_1", "running", { event: event("evt_running", "model_started", { status: "running" }) })
    store.transition("task_1", "answered", {
      answer: "完整回答",
      event: event("evt_answered", "answer_recorded", { status: "answered" }),
    })
    store.transition("task_1", "sending", {
      sendAttempts: 1,
      event: event("evt_sending", "send_attempted", { status: "sending" }),
    })

    expect(store.recoverableTasks()).toEqual([
      expect.objectContaining({ id: "task_1", answer: "完整回答", sendAttempts: 1, state: "sending" }),
    ])

    store.transition("task_1", "delivered", {
      event: event("evt_delivered", "delivery_confirmed", { status: "delivered" }),
    })
    expect(store.recoverableTasks()).toEqual([])
    store.close()
  })

  test("database triggers prevent committed event mutation", async () => {
    const path = await databasePath()
    const store = openGatewayStore(path)
    store.admit(task(), [event("evt_received", "message_received")])
    store.close()

    const database = new Database(path)
    expect(() => database.run("UPDATE gateway_event SET status = 'changed' WHERE event_id = 'evt_received'")).toThrow(
      "gateway_event is append-only",
    )
    expect(() => database.run("DELETE FROM gateway_event WHERE event_id = 'evt_received'")).toThrow(
      "gateway_event is append-only",
    )
    database.close()
  })
})

function task(overrides: Partial<NewGatewayTask> = {}): NewGatewayTask {
  return {
    id: "task_1",
    externalMessageHash: "hash_1",
    conversationID: "conv_1",
    sessionID: "ses_feishu_1",
    promptMessageID: "msg_feishu_1",
    turnID: "turn_1",
    traceID: "trace_1",
    promptText: "你好",
    originalText: "你好",
    replyTarget: "oc_chat_1",
    state: "received",
    ...overrides,
  }
}

function event(
  eventID: string,
  eventType: string,
  overrides: Partial<GatewayEventInput> = {},
): GatewayEventInput {
  return {
    eventID,
    eventType,
    occurredAt: 1_700_000_000_000,
    conversationID: "conv_1",
    turnID: "turn_1",
    traceID: "trace_1",
    actor: "gateway",
    version: 1,
    status: "received",
    content: { ok: true },
    ...overrides,
  }
}

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), "feishu-store-"))
  directories.push(directory)
  return join(directory, "gateway.sqlite")
}
