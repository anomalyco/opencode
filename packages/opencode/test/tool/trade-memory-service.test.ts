import { describe, expect, test } from "bun:test"
import path from "path"
import { startTradeMemoryHttpServer } from "../../../../.opencode/mcp/http"
import { createTradeMemoryService, TradeMemoryInputError } from "../../../../.opencode/mcp/service"
import { tmpdir } from "../fixture/fixture"

describe("trade-memory service", () => {
  test("renderOracleNote returns decision template", async () => {
    await using tmp = await tmpdir()
    const service = createTradeMemoryService({ indexDbPath: path.join(tmp.path, "memory.sqlite3") })
    const note = service.renderOracleNote({ issue: "Switch models" })

    expect(note).toContain("# Decision Note")
    expect(note).toContain("Switch models")
  })

  test("semanticSearch reports disabled state by default", async () => {
    await using tmp = await tmpdir()
    const service = createTradeMemoryService({ indexDbPath: path.join(tmp.path, "memory.sqlite3") })
    const result = service.semanticSearch({ query: "risk" })

    expect(result.enabled).toBe(false)
    expect(result.warning).toContain("not enabled")
  })

  test("buildHandoffContext prioritizes critical active notes", async () => {
    await using tmp = await tmpdir()
    const service = createTradeMemoryService({ indexDbPath: path.join(tmp.path, "memory.sqlite3") })

    service.storeNote({ title: "Low", body: "low body", memory_type: "misc", importance: 1, status: "active" })
    service.storeNote({ title: "Risk", body: "risk body", memory_type: "risk", importance: 3, status: "active" })
    service.storeNote({ title: "Critical", body: "critical body", memory_type: "misc", importance: 5, status: "active" })

    const result = service.buildHandoffContext({ sessionID: "ses_test", modelID: "gpt-5.4" })
    const criticalIndex = result.block.indexOf("Critical")
    const riskIndex = result.block.indexOf("Risk")
    const lowIndex = result.block.indexOf("Low")

    expect(criticalIndex).toBeGreaterThan(-1)
    expect(riskIndex).toBeGreaterThan(-1)
    expect(lowIndex).toBeGreaterThan(-1)
    expect(criticalIndex).toBeLessThan(lowIndex)
    expect(riskIndex).toBeLessThan(lowIndex)
  })

  test("buildHandoffContext rejects empty session IDs", async () => {
    await using tmp = await tmpdir()
    const service = createTradeMemoryService({ indexDbPath: path.join(tmp.path, "memory.sqlite3") })

    expect(() => service.buildHandoffContext({ sessionID: "" })).toThrow(TradeMemoryInputError)
  })

  test("storeNote rejects invalid importance", async () => {
    await using tmp = await tmpdir()
    const service = createTradeMemoryService({ indexDbPath: path.join(tmp.path, "memory.sqlite3") })

    expect(() =>
      service.storeNote({ title: "Bad", body: "bad", memory_type: "risk", importance: 6, status: "active" }),
    ).toThrow(TradeMemoryInputError)
  })

  test("http enforces auth and validation", async () => {
    await using tmp = await tmpdir()
    const originalToken = process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN
    process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = "test-token"
    const service = createTradeMemoryService({ indexDbPath: path.join(tmp.path, "memory.sqlite3") })
    const server = startTradeMemoryHttpServer({ service, port: 0 })

    try {
      const unauthorized = await fetch(`http://127.0.0.1:${server.port}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x", body: "y", memory_type: "risk" }),
      })
      expect(unauthorized.status).toBe(401)

      const invalid = await fetch(`http://127.0.0.1:${server.port}/notes`, {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ title: "x", body: "y", memory_type: "risk", importance: 99 }),
      })
      expect(invalid.status).toBe(400)
    } finally {
      process.env.OPENCODE_TRADE_MEMORY_SERVICE_TOKEN = originalToken
      void server.stop(true)
    }
  })

  test("markModelSwitched ignores stale late event after ack", async () => {
    await using tmp = await tmpdir()
    const service = createTradeMemoryService({ indexDbPath: path.join(tmp.path, "memory.sqlite3") })

    service.markModelSwitched({ sessionID: "ses_test", modelID: "gpt-5.4", pendingSince: 100 })
    service.ackHandoff({ sessionID: "ses_test", modelID: "gpt-5.4", ackedAt: 200 })
    const result = service.markModelSwitched({ sessionID: "ses_test", modelID: "gpt-5.4", pendingSince: 150 })
    const state = service.buildHandoffContext({ sessionID: "ses_test", modelID: "gpt-5.4" })

    expect(result).toMatchObject({ ignored: true })
    expect(state.pendingSince).toBeNull()
    expect(state.fresh).toBe(true)
  })
})
