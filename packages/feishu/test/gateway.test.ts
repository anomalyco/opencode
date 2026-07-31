import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GatewayConfig } from "../src/config"
import type {
  FeishuPort,
  FeishuReplyResult,
  NormalizedFeishuMessage,
} from "../src/feishu-channel"
import { createGateway } from "../src/gateway"
import { formatInventoryAnswer } from "../src/inventory-answer"
import { createInventoryRoute } from "../src/inventory-route"
import type { ChatCompletion, ChatFailure, ChatPort } from "../src/opencode"
import {
  openGatewayStore,
  type GatewayEventInput,
  type GatewayTask,
  type NewGatewayTask,
} from "../src/store"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Feishu chat gateway", () => {
  test("routes durable chat and inventory turns with continuity, isolation, deduplication, and complete traces", async () => {
    const store = await createStore()
    const channel = fakeChannel()
    const chat = fakeChat(async (task) => completed(`回答:${task.promptText}`))
    const inventoryCalls: string[] = []
    const inventoryRoute = createInventoryRoute({
      inventory: {
        async query(request) {
          inventoryCalls.push(request.term)
          return {
            status: "ok",
            text: "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
            evidence: {
              templateVersion: "mysql-inventory-v1",
              schemaVersion: "mysql-inventory-v1",
              database: "inventory",
              mysqlVersion: "8.4.10",
              rowCount: 3,
              durationMs: 10,
              itemCount: 1,
              mappedItems:
                '[{"name":"6001ZZ","attribute":"清油","size":"12×28×8","shelves":["B-11-13"],"supplier":"上海涂众轴承","inventory":"200","remark":"xxx"}]',
            },
          }
        },
      },
      createContext: (task) => ({
        source: "feishu",
        conversationID: task.conversationID,
        messageID: task.promptMessageID,
        traceID: task.traceID,
        admittedAt: 1_000,
        expiresAt: 2_000,
        integrity: "trusted",
      }),
      record: async (task, events) => {
        events.forEach((event) =>
          store.appendEvent({
            eventID: `event_inventory_${crypto.randomUUID()}`,
            eventType: event.type,
            occurredAt: event.occurredAt,
            conversationID: task.conversationID,
            turnID: task.turnID,
            traceID: task.traceID,
            messageID: task.promptMessageID,
            actor: "gateway",
            version: 1,
            status: task.state,
            content: event.data,
          }),
        )
      },
      now: times(),
    })
    const gateway = createGateway({
      config: config(),
      feishu: channel,
      chat,
      inventoryRoute,
      store,
      fallbackPath: join(directories[0], "fallback.jsonl"),
    })

    await gateway.start()
    await channel.emit(message("m1", "chat_a", "user_a", "你好"))
    await channel.emit(message("m2", "chat_a", "user_a", "继续"))
    await channel.emit(message("m3", "chat_b", "user_b", "另一个会话"))
    const inventory = message("m4", "chat_a", "user_a", "6001ZZ库存和位置")
    await channel.emit(inventory)
    await channel.emit(inventory)
    await gateway.idle()

    expect(chat.calls).toHaveLength(3)
    expect(chat.calls[0]?.sessionID).toBe(chat.calls[1]?.sessionID)
    expect(chat.calls[0]?.sessionID).not.toBe(chat.calls[2]?.sessionID)
    expect(inventoryCalls).toEqual(["6001ZZ"])
    expect(channel.sent).toHaveLength(4)
    expect(channel.sent.at(-1)?.text).toBe(
      "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
    )
    const inventoryTask = channel.sent.at(-1)!.task
    expect(store.eventsForTrace(inventoryTask.traceID).map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "message_received",
        "message_received_sentence",
        "task_admitted",
        "model_started",
        "inventory_intent_admitted",
        "inventory_query_started",
        "inventory_query_completed",
        "inventory_answer_mapped",
        "route_selected",
        "answer_recorded",
        "answer_recorded_sentence",
        "send_attempted",
        "delivery_confirmed",
      ]),
    )
    const inventoryEvents = store.eventsForTrace(inventoryTask.traceID)
    expect(inventoryEvents.find((event) => event.eventType === "inventory_query_completed")?.content).toEqual(
      expect.objectContaining({
        schemaVersion: "mysql-inventory-v1",
        database: "inventory",
        mysqlVersion: "8.4.10",
        rowCount: 3,
      }),
    )
    expect(inventoryEvents.find((event) => event.eventType === "inventory_answer_mapped")?.content).toEqual(
      expect.objectContaining({
        itemCount: 1,
        answer: "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
      }),
    )
    expect(JSON.stringify(inventoryEvents)).not.toContain("SP000000")

    await gateway.stop()
    expect(channel.stops).toBe(1)
    expect(chat.closes).toBe(1)
  })

  test("recovers a mentioned group inventory reply with native requester metadata and an exact body", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feishu-gateway-recovery-"))
    directories.push(directory)
    const databasePath = join(directory, "gateway.sqlite")
    const inventoryBody = formatInventoryAnswer([
      {
        name: "6001ZZ",
        shelves: ["B-11-13"],
        supplier: "苏州精工轴承",
        inventory: "200",
        remark: "现货",
      },
      {
        name: "6301",
        shelves: ["B-1-1"],
        supplier: "宁波宏达轴承",
        inventory: "12",
      },
      {
        name: "6401",
        shelves: [],
        inventory: "9",
        remark: "2024-7-20",
      },
    ])
    const initialStore = openGatewayStore(databasePath)
    const initialChannel = fakeChannel()
    const initialGateway = createGateway({
      config: config(),
      feishu: initialChannel,
      chat: fakeChat(async (task) => completed(`回答:${task.promptText}`)),
      inventoryRoute: { handle: () => new Promise(() => {}) },
      store: initialStore,
      fallbackPath: join(directory, "fallback.jsonl"),
    })

    await initialGateway.start()
    await initialChannel.emit({
      chatType: "group",
      chatID: "group_inventory",
      senderID: "ou_requester",
      senderName: "求精轴承",
      messageID: "group_inventory_1",
      originalText: "@机器人 6001ZZ库存",
      promptText: "6001ZZ库存",
      replyTarget: "group_inventory",
      replyRootID: "group_inventory_1",
    })

    const admitted = initialStore.recoverableTasks()[0]
    expect(admitted).toMatchObject({
      replyMentionID: "ou_requester",
      replyMentionName: "求精轴承",
    })
    expect(admitted?.answer).toBeUndefined()

    initialStore.close()

    const recoveredStore = openGatewayStore(databasePath)
    const recoveredChannel = fakeChannel()
    const recoveredGateway = createGateway({
      config: config(),
      feishu: recoveredChannel,
      chat: fakeChat(async (task) => completed(`回答:${task.promptText}`)),
      inventoryRoute: {
        async handle() {
          return { handled: true, text: inventoryBody, route: "inventory", status: "ok" }
        },
      },
      store: recoveredStore,
      fallbackPath: join(directory, "fallback.jsonl"),
    })

    await recoveredGateway.start()
    await recoveredGateway.idle()

    expect(recoveredChannel.sent).toHaveLength(1)
    expect(recoveredChannel.sent[0]).toMatchObject({
      task: {
        replyMentionID: "ou_requester",
        replyMentionName: "求精轴承",
      },
      text: inventoryBody,
    })
    expect(recoveredStore.getTask(admitted!.id)?.answer).toBe(inventoryBody)
    expect(inventoryBody).toBe(
      "6001ZZ（货架号：B-11-13）苏州精工轴承库存200，备注：现货\n6301（货架号：B-1-1）宁波宏达轴承库存12\n6401库存9，备注：2024-7-20",
    )
    expect(recoveredChannel.sent[0]?.text).not.toMatch(/@求精轴承|<at/)
    expect(recoveredChannel.sent[0]?.task.answer).not.toMatch(/@求精轴承|<at/)

    await recoveredGateway.stop()
  })

  test("recovers received work and sends one trace-bearing response for policy or provider failure", async () => {
    const store = await createStore(["secret-canary"])
    const recovered = seedTask("recovered", "session_recovered", "恢复任务")
    store.admit(recovered, [receipt(recovered)])
    const channel = fakeChannel()
    const chat = fakeChat(async (task) => {
      if (task.promptText === "恢复任务")
        return failure("policy", false, "secret-canary must never persist")
      return failure("authentication", false, "secret-canary must never persist")
    })
    const gateway = createGateway({
      config: config(),
      feishu: channel,
      chat,
      inventoryRoute: { handle: async () => ({ handled: false }) },
      store,
      fallbackPath: join(directories[0], "fallback.jsonl"),
    })

    await gateway.start()
    await gateway.idle()
    await channel.emit(message("provider", "chat_provider", "user_provider", "模型失败"))
    await gateway.idle()

    expect(channel.sent).toHaveLength(2)
    expect(channel.sent[0]?.text).toContain(recovered.traceID)
    expect(channel.sent[1]?.text).toContain(channel.sent[1].task.traceID)
    expect(JSON.stringify(channel.sent)).not.toContain("secret-canary")
    expect(JSON.stringify(store.eventsForTrace(recovered.traceID))).not.toContain("secret-canary")
    expect(store.getTask(recovered.id)?.state).toBe("delivered")

    await gateway.stop()
  })
})

function fakeChannel(): FeishuPort & {
  emit(message: NormalizedFeishuMessage): Promise<void>
  sent: Array<{ task: GatewayTask; text: string }>
  stops: number
} {
  let receiver: ((message: NormalizedFeishuMessage) => Promise<void>) | undefined
  const sent: Array<{ task: GatewayTask; text: string }> = []
  const channel = {
    sent,
    stops: 0,
    async start(onMessage: (message: NormalizedFeishuMessage) => Promise<void>) {
      receiver = onMessage
    },
    async emit(value: NormalizedFeishuMessage) {
      if (!receiver) throw new Error("Channel is not started")
      await receiver(value)
    },
    async send(task: GatewayTask, text: string): Promise<FeishuReplyResult> {
      sent.push({ task, text })
      return { kind: "delivered", externalReplyID: `reply_${task.id}` }
    },
    async stop() {
      channel.stops++
      receiver = undefined
    },
  }
  return channel
}

function fakeChat(
  complete: (
    task: GatewayTask,
  ) => Promise<{ ok: true; value: ChatCompletion } | { ok: false; error: ChatFailure }>,
): ChatPort & { calls: GatewayTask[]; closes: number } {
  const calls: GatewayTask[] = []
  const chat = {
    calls,
    closes: 0,
    async complete(task: GatewayTask) {
      calls.push(task)
      return complete(task)
    },
    async interrupt() {
      return true
    },
    async close() {
      chat.closes++
    },
  }
  return chat
}

function completed(text: string) {
  return {
    ok: true as const,
    value: {
      text,
      model: { providerID: "deepseek", modelID: "deepseek-chat" },
      durationMs: 1,
    },
  }
}

function failure(kind: ChatFailure["kind"], retryable: boolean, message: string) {
  return {
    ok: false as const,
    error: { kind, retryable, message },
  }
}

function message(
  messageID: string,
  chatID: string,
  senderID: string,
  promptText: string,
): NormalizedFeishuMessage {
  return {
    chatType: "direct",
    chatID,
    senderID,
    messageID,
    originalText: promptText,
    promptText,
    replyTarget: chatID,
  }
}

function config(): GatewayConfig {
  return {
    appID: "cli_test",
    appSecret: "secret-canary",
    model: { providerID: "deepseek", modelID: "deepseek-chat" },
    dataDirectory: directories[0],
    workspaceDirectory: "D:\\opencode",
    maxConcurrency: 2,
    replyAttempts: 2,
    replyTimeoutMs: 1_000,
  }
}

function seedTask(id: string, sessionID: string, promptText: string): NewGatewayTask {
  return {
    id,
    externalMessageHash: `hash_${id}`,
    conversationID: `conversation_${id}`,
    sessionID,
    promptMessageID: `message_${id}`,
    turnID: `turn_${id}`,
    traceID: `trace_${id}`,
    promptText,
    originalText: promptText,
    replyTarget: `chat_${id}`,
    state: "received",
  }
}

function receipt(task: NewGatewayTask): GatewayEventInput {
  return {
    eventID: `event_received_${task.id}`,
    eventType: "message_received",
    occurredAt: 1_000,
    conversationID: task.conversationID,
    turnID: task.turnID,
    traceID: task.traceID,
    actor: "user",
    version: 1,
    status: "received",
    content: { text: task.originalText },
  }
}

async function createStore(secrets: readonly string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "feishu-gateway-"))
  directories.push(directory)
  return openGatewayStore(join(directory, "gateway.sqlite"), secrets)
}

function times() {
  let value = 1_000
  return () => value++
}
