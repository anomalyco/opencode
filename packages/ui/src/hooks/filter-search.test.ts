import { describe, expect, test } from "bun:test"
import { fuzzy, normalize } from "./filter-search"

describe("filter search", () => {
  test("normalizes punctuation and separators", () => {
    expect(normalize(" GPT_5,3-mini ")).toBe("gpt53mini")
  })

  test("matches locale punctuation on plain strings", () => {
    const list = ["gpt-5.3", "gpt-5.2"]
    expect(fuzzy(normalize("5,3"), list)[0]).toBe("gpt-5.3")
  })

  test("matches objects through normalized indexed keys", () => {
    const list = [
      { id: "openai:gpt-5.3", name: "GPT-5.3", provider: { name: "OpenAI" } },
      { id: "openai:gpt-5.2", name: "GPT-5.2", provider: { name: "OpenAI" } },
    ]
    const result = fuzzy(normalize("openai gpt_5,3"), list, ["provider.name", "name", "id"])
    expect(result[0]?.id).toBe("openai:gpt-5.3")
  })

  test("boosts normalized prefix matches", () => {
    const list = ["my-gpt-53", "gpt-5.3", "x-gpt53"]
    expect(fuzzy(normalize("gpt53"), list)[0]).toBe("gpt-5.3")
  })
})
