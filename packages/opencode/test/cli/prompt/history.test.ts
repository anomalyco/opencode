import { describe, expect, test } from "bun:test"
import { createPromptHistoryStoreForTest } from "../../../src/cli/cmd/tui/component/prompt/history-helper"

describe("PromptHistory (unit)", () => {
  test("filtered move finds matching entry and returns prefix when moving down", () => {
    const store = createPromptHistoryStoreForTest([
      { input: "abc1", parts: [] },
      { input: "prefix-match", parts: [] },
      { input: "prefix-other", parts: [] },
      { input: "another", parts: [] },
    ])

    const up = store.move(-1, "prefix")
    expect(up).not.toBeUndefined()
    expect(up!.input).toBe("prefix-other")

    const down = store.move(1, "prefix")
    expect(down).not.toBeUndefined()
    expect(down!.input).toBe("prefix")
  })

  test("non-filter navigation returns last item and resetIndex works", () => {
    const store = createPromptHistoryStoreForTest([
      { input: "old", parts: [] },
      { input: "newer", parts: [] },
    ])

    store.resetIndex()
    const res = store.move(-1, "")
    expect(res).not.toBeUndefined()
    expect(res!.input).toBe("newer")
  })

  test("append adds entries and latest is returned", () => {
    const store = createPromptHistoryStoreForTest([])
    for (let i = 0; i < 55; i++) {
      store.append({ input: String(i), parts: [] })
    }
    const res = store.move(-1, "")
    expect(res).not.toBeUndefined()
    expect(res!.input).toBe("54")
  })
})
