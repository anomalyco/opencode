import { describe, expect, test } from "bun:test"

describe("PatentConvertTool", () => {
  test("tool module exports correctly", async () => {
    const mod = await import("@/tool/patent-convert")
    expect(mod.Parameters).toBeDefined()
    expect(mod.PatentConvertTool).toBeDefined()
    expect(mod.PatentConvertTool.id).toBe("patent_convert")
  })
})