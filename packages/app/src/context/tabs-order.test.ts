import { describe, expect, test } from "bun:test"
import { swapTabOrder, type TabOrderItem } from "./tabs-order"

const sessionTab = (sessionId: string): TabOrderItem => ({
  type: "session",
  server: "sidecar",
  sessionId,
})

describe("swapTabOrder", () => {
  test("swaps matching tabs by tab identity", () => {
    const first = sessionTab("first")
    const second = sessionTab("second")
    const third = sessionTab("third")

    expect(swapTabOrder([first, second, third], first, third)).toEqual([third, second, first])
  })

  test("keeps order when either tab is missing", () => {
    const first = sessionTab("first")
    const second = sessionTab("second")

    expect(swapTabOrder([first], first, second)).toEqual([first])
  })
})
