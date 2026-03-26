import { describe, expect, test } from "bun:test"
import { targetTop } from "./use-session-scroll-utils"

describe("targetTop", () => {
  test("accounts for sticky inset while preserving scroll offset", () => {
    expect(
      targetTop({
        itemTop: 260,
        rootTop: 100,
        scrollTop: 700,
        inset: 48,
      }),
    ).toBe(812)
  })

  test("clamps negative targets to the top of the scroller", () => {
    expect(
      targetTop({
        itemTop: 80,
        rootTop: 100,
        scrollTop: 10,
        inset: 48,
      }),
    ).toBe(0)
  })
})
