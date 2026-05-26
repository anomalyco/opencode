import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

describe("PatentSearchTool", () => {
  test("tool module exports correctly", async () => {
    const mod = await import("@/tool/patent-search")
    expect(mod.Parameters).toBeDefined()
    expect(mod.PatentSearchTool).toBeDefined()
    expect(mod.PatentSearchTool.id).toBe("patent_search")
  })

  test("Parameters schema decodes valid input", async () => {
    const mod = await import("@/tool/patent-search")
    const Parameters = mod.Parameters

    const validInput = {
      query: "人工智能",
      field: "title",
      ipc: "G06N",
      applicant: "公司A",
      limit: 20,
    }

    const result = Schema.decodeUnknownSync(Parameters)(validInput)
    expect(result).toEqual(validInput)
  })

  test("Parameters schema decodes minimal input", async () => {
    const mod = await import("@/tool/patent-search")
    const Parameters = mod.Parameters

    const minimalInput = { query: "人工智能" }

    const result = Schema.decodeUnknownSync(Parameters)(minimalInput)
    expect(result.query).toBe("人工智能")
    expect(result.field).toBeUndefined()
    expect(result.ipc).toBeUndefined()
    expect(result.applicant).toBeUndefined()
    expect(result.limit).toBeUndefined()
  })

  test("Parameters schema requires query field", async () => {
    const mod = await import("@/tool/patent-search")
    const Parameters = mod.Parameters

    const result = Schema.decodeUnknownOption(Parameters)({ field: "title" })
    if (result._tag === "Some") {
      expect(result.value.query).toBeUndefined()
    } else {
      expect(result._tag).toBe("None")
    }
  })
})
