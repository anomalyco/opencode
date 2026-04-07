import { describe, expect, test } from "bun:test"
import { search, type PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"

function item(input: string): PromptInfo {
  return {
    input,
    parts: [],
  }
}

describe("prompt history", () => {
  test("search finds the latest matching prompt", () => {
    const list = [item("fix lint"), item("fix tests"), item("review docs")]

    const found = search(list, "fix")

    expect(found?.item.input).toBe("fix tests")
    expect(found?.next.term).toBe("fix")
  })

  test("search walks backward through matching prompts", () => {
    const list = [item("fix lint"), item("fix tests"), item("review docs"), item("fix docs")]

    const a = search(list, "fix")
    const b = search(list, "fix docs", a?.next)
    const c = search(list, "fix tests", b?.next)

    expect(a?.item.input).toBe("fix docs")
    expect(b?.item.input).toBe("fix tests")
    expect(c?.item.input).toBe("fix lint")
  })

  test("search falls back to all prompts when the query is empty", () => {
    const list = [item("fix lint"), item("fix tests")]

    const found = search(list, "")

    expect(found?.item.input).toBe("fix tests")
    expect(found?.next.term).toBe("")
  })
})
