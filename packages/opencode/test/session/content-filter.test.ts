import { describe, expect, test } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"

describe("readContentFilter", () => {
  test("extracts category and explanation from anthropic stopDetails", () => {
    const metadata = {
      anthropic: {
        stopDetails: { type: "refusal", category: "reasoning_extraction", explanation: "declined per policy" },
      },
    }
    expect(SessionProcessor.readContentFilter(metadata)).toEqual({
      category: "reasoning_extraction",
      explanation: "declined per policy",
    })
  })

  test("keeps only the fields that are present", () => {
    const metadata = { anthropic: { stopDetails: { type: "refusal", category: "cyber" } } }
    expect(SessionProcessor.readContentFilter(metadata)).toEqual({ category: "cyber" })
  })

  test("returns undefined when the refusal has no named category or explanation", () => {
    const metadata = { anthropic: { stopDetails: { type: "refusal", category: null, explanation: null } } }
    expect(SessionProcessor.readContentFilter(metadata)).toBeUndefined()
  })

  test("returns undefined without anthropic stopDetails", () => {
    expect(SessionProcessor.readContentFilter(undefined)).toBeUndefined()
    expect(SessionProcessor.readContentFilter({})).toBeUndefined()
    expect(SessionProcessor.readContentFilter({ anthropic: {} })).toBeUndefined()
    expect(SessionProcessor.readContentFilter({ openai: { stopDetails: { category: "cyber" } } })).toBeUndefined()
  })
})
