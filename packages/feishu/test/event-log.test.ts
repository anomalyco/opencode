import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEventLog } from "../src/event-log"
import { type NewGatewayTask, openGatewayStore } from "../src/store"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("gateway event log", () => {
  test("builds complete and ordered sentence events without rewriting the message", async () => {
    const { log, store } = await fixture()
    const events = await log.message(task(), {
      eventType: "user_message",
      actor: "user",
      status: "received",
      messageID: "msg_user_1",
      text: "@机器人 你好。\n查库存？",
      content: { normalizedPrompt: "你好。\n查库存？" },
    })

    expect(events.map((event) => event.eventType)).toEqual(["user_message", "user_message_sentence", "user_message_sentence"])
    expect(events.map((event) => event.sentenceIndex)).toEqual([undefined, 0, 1])
    expect(events.slice(1).map((event) => event.content)).toEqual([
      { text: "@机器人 你好。\n" },
      { text: "查库存？" },
    ])
    expect(events.every((event) => event.traceID === "trace_1" && event.turnID === "turn_1")).toBeTrue()
    store.close()
  })

  test("appends one reconstructable trace with future tool and SQL envelopes", async () => {
    const { log, store } = await fixture()
    store.admit(task(), await log.message(task(), {
      eventType: "user_message",
      actor: "user",
      status: "received",
      messageID: "msg_user_1",
      text: "6001ZZ库存多少",
    }))
    const selected = log.append(task(), {
      eventType: "agent_model_selected",
      actor: "gateway",
      status: "selected",
      content: { agent: "feishu-chat", providerID: "deepseek", modelID: "deepseek-chat" },
    })
    log.append(task(), {
      eventType: "tool_requested",
      actor: "provider",
      status: "blocked",
      parentEventID: selected.eventID,
      content: { tool: "bash", request: "sanitized summary" },
    })
    log.append(task(), {
      eventType: "sql_query_completed",
      actor: "gateway",
      status: "completed",
      content: { templateVersion: "inventory:v1", rowCount: 1 },
    })

    expect(store.eventsForTrace("trace_1").map((event) => event.eventType)).toEqual([
      "user_message",
      "user_message_sentence",
      "agent_model_selected",
      "tool_requested",
      "sql_query_completed",
    ])
    store.close()
  })

  test("links corrections without modifying original events and sanitizes every append", async () => {
    const { log, store } = await fixture()
    store.admit(task(), await log.message(task(), {
      eventType: "assistant_message",
      actor: "assistant",
      status: "answered",
      messageID: "msg_assistant_1",
      text: "原回答。",
      content: { upstream: "secret-canary" },
    }))
    const original = store.eventsForTrace("trace_1")[0]
    const correction = log.append(task(), {
      eventType: "operator_correction",
      actor: "operator",
      status: "corrected",
      relatedEventID: original.eventID,
      content: { text: "纠正回答。", authorization: "Bearer secret-canary" },
    })

    expect(correction.relatedEventID).toBe(original.eventID)
    expect(correction.content).toEqual({ text: "纠正回答。", authorization: "[REDACTED]" })
    expect(store.eventsForTrace("trace_1")[0]).toEqual(original)
    store.close()
  })
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "feishu-event-log-"))
  directories.push(directory)
  const store = openGatewayStore(join(directory, "gateway.sqlite"), ["secret-canary"])
  let event = 0
  return {
    store,
    log: createEventLog({
      store,
      now: () => 1_700_000_000_000,
      makeEventID: () => `evt_${++event}`,
    }),
  }
}

function task(): NewGatewayTask {
  return {
    id: "task_1",
    externalMessageHash: "hash_1",
    conversationID: "conv_1",
    sessionID: "ses_feishu_1",
    promptMessageID: "msg_feishu_1",
    turnID: "turn_1",
    traceID: "trace_1",
    promptText: "6001ZZ库存多少",
    originalText: "6001ZZ库存多少",
    replyTarget: "oc_chat_1",
    state: "received",
  }
}
