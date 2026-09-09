import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { deriveDescriptionFromPrompt, Parameters } from "@/tool/task"

const decode = Schema.decodeUnknownSync(Parameters)

describe("task tool parameters", () => {
  // `description` used to be required. It is display-only — session title,
  // permission metadata, background summaries — but a model that omits it got a
  // raw SchemaError('Missing key at ["description"]'), and a smaller model does
  // not recover from that: it repeats the same call and then abandons the tool
  // entirely, falling back to reading files by hand.
  test("a call without description is accepted", () => {
    const params = decode({ prompt: "find every caller of foo()", subagent_type: "general" })
    expect(params.description).toBeUndefined()
  })

  test("a call with description keeps it", () => {
    const params = decode({ description: "find callers", prompt: "…", subagent_type: "general" })
    expect(params.description).toBe("find callers")
  })
})

describe("deriveDescriptionFromPrompt", () => {
  test("uses a short prompt as-is", () => {
    expect(deriveDescriptionFromPrompt("find every caller of foo()")).toBe("find every caller of foo()")
  })

  test("collapses whitespace", () => {
    expect(deriveDescriptionFromPrompt("  find\n  callers \t of foo  ")).toBe("find callers of foo")
  })

  test("truncates a long prompt and marks it", () => {
    const derived = deriveDescriptionFromPrompt("x".repeat(200))
    expect(derived.length).toBe(60)
    expect(derived.endsWith("…")).toBe(true)
  })

  test("never returns an empty description", () => {
    expect(deriveDescriptionFromPrompt("   \n  ")).toBe("Task")
  })
})
