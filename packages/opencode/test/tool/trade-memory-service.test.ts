import { describe, expect, test } from "bun:test"
import { createTradeMemoryService } from "../../../../.opencode/mcp/service"

describe("trade-memory service", () => {
  test("renderOracleNote returns decision template", () => {
    const service = createTradeMemoryService()
    const note = service.renderOracleNote({ issue: "Switch models" })

    expect(note).toContain("# Decision Note")
    expect(note).toContain("Switch models")
  })

  test("semanticSearch reports disabled state by default", () => {
    const service = createTradeMemoryService()
    const result = service.semanticSearch({ query: "risk" })

    expect(result.enabled).toBe(false)
    expect(result.warning).toContain("not enabled")
  })
})
