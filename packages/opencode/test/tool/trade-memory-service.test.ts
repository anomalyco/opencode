import { describe, expect, test } from "bun:test"
import path from "path"
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
})
