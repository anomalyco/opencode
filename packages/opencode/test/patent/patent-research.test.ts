import { describe, expect, test } from "bun:test"

describe("PatentResearchTool", () => {
  test("tool module exports correctly", async () => {
    const mod = await import("@/tool/patent-research")
    expect(mod.Parameters).toBeDefined()
    expect(mod.PatentResearchTool).toBeDefined()
    expect(mod.PatentResearchTool.id).toBe("patent_research")
  })
})