import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"

describe("PatentSearchTool", () => {
  test("tool module exports correctly", async () => {
    const mod = await import("@/tool/patent-search")
    expect(mod.Parameters).toBeDefined()
    expect(mod.PatentSearchTool).toBeDefined()
    expect(mod.PatentSearchTool.id).toBe("patent_search")
  })

  test("Parameters schema decodes valid input", async () => {
    const mod = await import("@/tool/patent-search")
    const Parameters = mod.Parameters as Schema.Schema<any>

    const validInput = {
      query: "人工智能",
      field: "title",
      ipc: "G06N",
      applicant: "公司A",
      limit: 20,
    }

    const result = await Schema.decodeUnknownEffect(Parameters)(validInput).pipe(Effect.runPromise)
    expect(result).toEqual(validInput)
  })

  test("Parameters schema decodes minimal input", async () => {
    const mod = await import("@/tool/patent-search")
    const Parameters = mod.Parameters as Schema.Schema<any>

    const minimalInput = { query: "人工智能" }

    const result = await Schema.decodeUnknownEffect(Parameters)(minimalInput).pipe(Effect.runPromise)
    expect(result.query).toBe("人工智能")
    expect(result.field).toBeUndefined()
    expect(result.ipc).toBeUndefined()
    expect(result.applicant).toBeUndefined()
    expect(result.limit).toBeUndefined()
  })

  test("Parameters schema requires query field", async () => {
    const mod = await import("@/tool/patent-search")
    const Parameters = mod.Parameters as Schema.Schema<any>

    const result = await Schema.decodeUnknownEffect(Parameters)({ field: "title" }).pipe(Effect.exit)
    if (Exit.isSuccess(result)) {
      expect(result.value.query).toBeUndefined()
    } else {
      expect(Exit.isFailure(result)).toBe(true)
    }
  })
})