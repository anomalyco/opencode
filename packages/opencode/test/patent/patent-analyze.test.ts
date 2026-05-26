import { describe, expect, test } from "bun:test"

describe("PatentAnalyzeTool", () => {
  test("tool module exports correctly", async () => {
    const mod = await import("@/tool/patent-analyze")
    expect(mod.Parameters).toBeDefined()
    expect(mod.PatentAnalyzeTool).toBeDefined()
    expect(mod.PatentAnalyzeTool.id).toBe("patent_analyze")
  })
})