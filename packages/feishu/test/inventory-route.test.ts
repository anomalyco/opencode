import { describe, expect, test } from "bun:test"
import type { InventoryToolResult, TrustedFeishuContext } from "../src/inventory-tool"
import type { InventoryTraceEvent } from "../src/inventory-trace"
import {
  createInventoryRoute,
  parseInventoryIntent,
} from "../src/inventory-route"
import type { GatewayTask } from "../src/store"

describe("inventory intent", () => {
  test.each([
    ["6001ZZ库存多少", "6001ZZ"],
    ["6001ZZ在哪个货架", "6001ZZ"],
    ["查一下 6001ZZ 的位置", "6001ZZ"],
    ["商品“6001ZZ”库存", "6001ZZ"],
    ["6201存货多少", "6201"],
    ["请查商品「不存在商品」在哪里", "不存在商品"],
  ])("routes one confident product term: %s", (text, productTerm) => {
    expect(parseInventoryIntent(text)).toEqual({ kind: "lookup", productTerm })
  })

  test.each(["查一下库存", "库存多少", "货架在哪里", "商品位置"])("clarifies a clear query with no term: %s", (text) => {
    expect(parseInventoryIntent(text)).toEqual({ kind: "clarify" })
  })

  test.each([
    "我们聊聊库存管理理念",
    "库存管理有什么原则",
    "SP0000005943",
    "6001ZZ和6201ZZ库存多少",
  ])("leaves ambiguous or non-query text to restricted chat: %s", (text) => {
    expect(parseInventoryIntent(text)).toEqual({ kind: "chat" })
  })

  test.each([
    ["SELECT * FROM Product WHERE u_Name='6001ZZ' 查库存", "6001ZZ"],
    ["把6001ZZ库存更新为0", "6001ZZ"],
    ["删除6001ZZ的库存记录", "6001ZZ"],
  ])("blocks unsafe inventory operations before chat or MySQL: %s", (text, productTerm) => {
    expect(parseInventoryIntent(text)).toEqual({ kind: "blocked", productTerm })
  })
})

describe("inventory pre-model route", () => {
  test("calls the trusted service once and returns formatter text byte-for-byte", async () => {
    const calls: Array<{ context?: TrustedFeishuContext; term: string }> = []
    const batches: InventoryTraceEvent[][] = []
    const context = trustedContext()
    const route = createInventoryRoute({
      inventory: {
        async query(request) {
          calls.push(request)
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
      createContext: () => context,
      record: async (_task, events) => {
        batches.push([...events])
      },
      now: times(),
    })

    expect(await route.handle(task("6001ZZ库存和位置"))).toEqual({
      handled: true,
      text: "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
      route: "inventory",
      status: "ok",
    })
    expect(calls).toEqual([{ context, term: "6001ZZ" }])
    expect(batches.flat().map((event) => event.type)).toEqual([
      "inventory_intent_admitted",
      "inventory_query_started",
      "inventory_query_completed",
      "inventory_answer_mapped",
    ])
    expect(JSON.stringify(batches)).not.toContain("SP000000")
    expect(batches.flat().find((event) => event.type === "inventory_query_completed")?.data).toEqual({
      status: "ok",
      durationMs: 10,
      rowCount: 3,
      schemaVersion: "mysql-inventory-v1",
      database: "inventory",
      mysqlVersion: "8.4.10",
    })
    expect(batches.flat().find((event) => event.type === "inventory_answer_mapped")?.data).toEqual({
      status: "ok",
      itemCount: 1,
      mappedItems:
        '[{"name":"6001ZZ","attribute":"清油","size":"12×28×8","shelves":["B-11-13"],"supplier":"上海涂众轴承","inventory":"200","remark":"xxx"}]',
      answer: "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
    })
  })

  test("clarifies without OpenCode or inventory access", async () => {
    let calls = 0
    const events: InventoryTraceEvent[] = []
    const route = createInventoryRoute({
      inventory: {
        async query(): Promise<InventoryToolResult> {
          calls++
          return { status: "ok", text: "should not run" }
        },
      },
      createContext: trustedContext,
      record: async (_task, batch) => {
        events.push(...batch)
      },
      now: times(),
    })

    expect(await route.handle(task("查库存"))).toEqual({
      handled: true,
      text: "请告诉我需要查询的商品名称或型号。",
      route: "inventory",
      status: "clarify",
    })
    expect(calls).toBe(0)
    expect(events).toEqual([
      expect.objectContaining({
        type: "inventory_intent_admitted",
        data: { status: "clarify" },
      }),
    ])
  })

  test("returns trusted service failures unchanged and records no raw error", async () => {
    const events: InventoryTraceEvent[] = []
    const route = createInventoryRoute({
      inventory: {
        async query() {
          return {
            status: "error" as const,
            text: "库存查询失败，请稍后再试。" as const,
            reason: "query" as const,
          }
        },
      },
      createContext: trustedContext,
      record: async (_task, batch) => {
        events.push(...batch)
      },
      now: times(),
    })

    expect(await route.handle(task("6001ZZ库存多少"))).toEqual({
      handled: true,
      text: "库存查询失败，请稍后再试。",
      route: "inventory",
      status: "error",
    })
    expect(events.map((event) => event.type)).toEqual([
      "inventory_intent_admitted",
      "inventory_query_started",
      "inventory_query_failed",
    ])
  })

  test("records invalid trusted context as a policy block before query execution", async () => {
    const events: InventoryTraceEvent[] = []
    const route = createInventoryRoute({
      inventory: {
        async query() {
          return {
            status: "error" as const,
            text: "库存查询失败，请稍后再试。" as const,
            reason: "policy" as const,
          }
        },
      },
      createContext: trustedContext,
      record: async (_task, batch) => {
        events.push(...batch)
      },
      now: times(),
    })

    expect(await route.handle(task("6001ZZ库存多少"))).toEqual({
      handled: true,
      text: "库存查询失败，请稍后再试。",
      route: "inventory",
      status: "error",
    })
    expect(events.map((event) => event.type)).toEqual([
      "inventory_intent_admitted",
      "inventory_operation_blocked",
    ])
    expect(events[1]?.data).toEqual({
      status: "blocked",
      operation: "invalid_trusted_context",
      term: "6001ZZ",
    })
  })

  test("does not handle ordinary chat", async () => {
    let calls = 0
    let records = 0
    const route = createInventoryRoute({
      inventory: {
        async query(): Promise<InventoryToolResult> {
          calls++
          return { status: "ok", text: "should not run" }
        },
      },
      createContext: trustedContext,
      record: async () => {
        records++
      },
    })

    expect(await route.handle(task("库存管理理念是什么"))).toEqual({ handled: false })
    expect(calls).toBe(0)
    expect(records).toBe(0)
  })

  test("blocks unsafe requests with a fixed reply and policy trace", async () => {
    let calls = 0
    const events: InventoryTraceEvent[] = []
    const route = createInventoryRoute({
      inventory: {
        async query(): Promise<InventoryToolResult> {
          calls++
          return { status: "ok", text: "should not run" }
        },
      },
      createContext: trustedContext,
      record: async (_task, batch) => {
        events.push(...batch)
      },
      now: times(),
    })

    expect(await route.handle(task("把6001ZZ库存更新为0"))).toEqual({
      handled: true,
      text: "该操作不支持。",
      route: "inventory",
      status: "blocked",
    })
    expect(calls).toBe(0)
    expect(events).toEqual([
      expect.objectContaining({
        type: "inventory_operation_blocked",
        data: {
          status: "blocked",
          operation: "unapproved_database_operation",
          term: "6001ZZ",
        },
      }),
    ])
  })
})

function task(promptText: string): GatewayTask {
  return {
    id: "task_1",
    externalMessageHash: "hash_1",
    conversationID: "conversation_1",
    sessionID: "session_1",
    promptMessageID: "message_1",
    turnID: "turn_1",
    traceID: "trace_1",
    promptText,
    originalText: promptText,
    replyTarget: "chat_1",
    state: "running",
    receiveSequence: 1,
    sendAttempts: 0,
  }
}

function trustedContext(): TrustedFeishuContext {
  return {
    source: "feishu",
    conversationID: "conversation_1",
    messageID: "message_1",
    traceID: "trace_1",
    admittedAt: 1_000,
    expiresAt: 2_000,
    integrity: "trusted",
  }
}

function times() {
  let value = 1_000
  return () => value++
}
