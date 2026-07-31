import { describe, expect, test } from "bun:test"
import {
  createInventoryTool,
} from "../src/inventory-tool"
import type { InventoryAnswerItem } from "../src/inventory-answer"
import type { InventoryQueryEvent } from "../src/mysql-inventory"

const context = {
  source: "feishu" as const,
  conversationID: "conversation-1",
  messageID: "message-1",
  traceID: "trace-1",
  admittedAt: 1_000,
  expiresAt: 2_000,
  integrity: "gateway-issued",
}

function inventory(result: InventoryAnswerItem[] = []) {
  const calls: { term: string; limit?: number }[] = []
  return {
    calls,
    adapter: {
      preflight: {
        mysqlVersion: "8.4.10",
        database: "inventory",
        currentUser: "inventory_reader@%",
        readOnly: false,
        contractVersion: "mysql-inventory-v1" as const,
      },
      async query(term: string, limit?: number, observe?: (event: InventoryQueryEvent) => void | Promise<void>) {
        calls.push({ term, limit })
        await observe?.({
          type: "query_started",
          templateVersion: "mysql-inventory-v1",
          term,
          limit: limit ?? 20,
        })
        await observe?.({
          type: "query_completed",
          templateVersion: "mysql-inventory-v1",
          rowCount: result.length,
          durationMs: 10,
        })
        return result
      },
    },
  }
}

describe("inventory tool", () => {
  test("returns exact formatter text for valid trusted context", async () => {
    const input = inventory([
      {
        name: "6001ZZ",
        attribute: "清油",
        size: "12×28×8",
        shelves: ["B-11-13"],
        supplier: "上海涂众轴承",
        inventory: "200",
        remark: "xxx",
      },
    ])
    const tool = createInventoryTool({
      inventory: input.adapter,
      verifyContext: () => true,
      now: () => 1_500,
    })

    expect(await tool.query({ context, term: " 6001ZZ " })).toEqual({
      status: "ok",
      text: "6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx",
      evidence: {
        templateVersion: "mysql-inventory-v1",
        schemaVersion: "mysql-inventory-v1",
        database: "inventory",
        mysqlVersion: "8.4.10",
        rowCount: 1,
        durationMs: 10,
        itemCount: 1,
        mappedItems:
          '[{"name":"6001ZZ","attribute":"清油","size":"12×28×8","shelves":["B-11-13"],"supplier":"上海涂众轴承","inventory":"200","remark":"xxx"}]',
      },
    })
    expect(input.calls).toEqual([{ term: "6001ZZ", limit: undefined }])
  })

  test("returns the exact no-result sentence", async () => {
    const input = inventory()
    const tool = createInventoryTool({
      inventory: input.adapter,
      verifyContext: () => true,
      now: () => 1_500,
    })

    expect(await tool.query({ context, term: "missing" })).toEqual({
      status: "ok",
      text: "未找到相关商品。",
      evidence: {
        templateVersion: "mysql-inventory-v1",
        schemaVersion: "mysql-inventory-v1",
        database: "inventory",
        mysqlVersion: "8.4.10",
        rowCount: 0,
        durationMs: 10,
        itemCount: 0,
        mappedItems: "[]",
      },
    })
  })

  test("fails closed before querying for missing, expired, or forged context", async () => {
    const input = inventory()
    const tool = createInventoryTool({
      inventory: input.adapter,
      verifyContext: (value) => value.integrity === "gateway-issued",
      now: () => 2_000,
    })
    const forged = { ...context, integrity: "forged", expiresAt: 2_001 }

    expect(await tool.query({ term: "6001ZZ" })).toEqual({
      status: "error",
      text: "库存查询失败，请稍后再试。",
      reason: "policy",
    })
    expect(await tool.query({ context, term: "6001ZZ" })).toEqual({
      status: "error",
      text: "库存查询失败，请稍后再试。",
      reason: "policy",
    })
    expect(await tool.query({ context: forged, term: "6001ZZ" })).toEqual({
      status: "error",
      text: "库存查询失败，请稍后再试。",
      reason: "policy",
    })
    expect(input.calls).toHaveLength(0)
  })

  test("fails closed when context verification throws", async () => {
    const input = inventory()
    const tool = createInventoryTool({
      inventory: input.adapter,
      verifyContext: () => {
        throw new Error("secret-bearing verifier failure")
      },
      now: () => 1_500,
    })

    expect(await tool.query({ context, term: "6001ZZ" })).toEqual({
      status: "error",
      text: "库存查询失败，请稍后再试。",
      reason: "policy",
    })
    expect(input.calls).toHaveLength(0)
  })

  test("clarifies an empty term without querying", async () => {
    const input = inventory()
    const tool = createInventoryTool({
      inventory: input.adapter,
      verifyContext: () => true,
      now: () => 1_500,
    })

    expect(await tool.query({ context, term: "  " })).toEqual({
      status: "clarify",
      text: "请告诉我要查询的商品名称或型号。",
    })
    expect(input.calls).toHaveLength(0)
  })

  test("sanitizes adapter failures", async () => {
    const tool = createInventoryTool({
      inventory: {
        async query() {
          throw new Error("mysql://user:secret@host/schema")
        },
      },
      verifyContext: () => true,
      now: () => 1_500,
    })

    expect(await tool.query({ context, term: "6001ZZ" })).toEqual({
      status: "error",
      text: "库存查询失败，请稍后再试。",
      reason: "query",
    })
  })

  test("does not accept SQL-shaped tool input", () => {
    const input = inventory()
    const tool = createInventoryTool({
      inventory: input.adapter,
      verifyContext: () => true,
      now: () => 1_500,
    })

    const compileOnly = () => {
      // @ts-expect-error inventory tool input has no SQL field
      void tool.query({ context, term: "6001ZZ", sql: "UPDATE Product SET u_Name = 'x'" })
    }

    expect(compileOnly).toBeFunction()
    expect(Object.keys(tool)).toEqual(["query"])
  })
})
