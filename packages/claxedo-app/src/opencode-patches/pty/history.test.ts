import { describe, expect, test } from "bun:test"
import { createHistory } from "./history"

describe("pty history ring", () => {
  test("keeps full payload when under limit", () => {
    const history = createHistory(32)
    history.append("abc")
    history.append("def")
    expect(history.snapshot()).toBe("abcdef")
    expect(history.size()).toBe(6)
  })

  test("drops oldest bytes when over limit", () => {
    const history = createHistory(8)
    history.append("1234")
    history.append("5678")
    history.append("90")
    expect(history.snapshot()).toBe("34567890")
    expect(history.size()).toBe(8)
  })

  test("handles single oversized chunk by keeping tail", () => {
    const history = createHistory(5)
    history.append("abcdefghij")
    expect(history.snapshot()).toBe("fghij")
    expect(history.size()).toBe(5)
  })

  test("supports smaller snapshot cap than history limit", () => {
    const history = createHistory(32)
    history.append("0123456789")
    expect(history.snapshot(4)).toBe("6789")
  })

  test("server_history_limit_enforced_exactly", () => {
    const history = createHistory(5)
    history.append("12")
    history.append("34")
    history.append("56")
    expect(history.size()).toBe(5)
    expect(history.snapshot()).toBe("23456")
  })
})
