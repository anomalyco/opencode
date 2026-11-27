import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { fadeTitleColor } from "../../src/component/session-tabs"

const color = RGBA.fromInts(238, 238, 238)
const background = RGBA.fromInts(30, 30, 30)
const opaque = (length: number, leading: number) =>
  Array.from({ length }, (_, index) => fadeTitleColor(color, background, index, length, leading) === color)

describe("session tab title fade", () => {
  test("keeps the middle of a narrow scrolling title fully opaque", () => {
    expect(opaque(5, 1)).toEqual([false, false, true, false, false])
    expect(opaque(6, 1)).toEqual([false, false, true, true, false, false])
    expect(opaque(7, 1)).toEqual([false, false, false, true, false, false, false])
    expect(opaque(8, 1)).toEqual([false, false, false, true, true, false, false, false])
  })

  test("keeps the outermost cells strongest on narrow titles", () => {
    expect(fadeTitleColor(color, background, 0, 5, 1)).toEqual(fadeTitleColor(color, background, 0, 12, 1))
    expect(fadeTitleColor(color, background, 4, 5, 1)).toEqual(fadeTitleColor(color, background, 11, 12, 1))
  })

  test("fades four cells at each end of a wide title", () => {
    expect(opaque(12, 1)).toEqual([false, false, false, false, true, true, true, true, false, false, false, false])
    expect(opaque(12, 0)).toEqual([true, true, true, true, true, true, true, true, false, false, false, false])
  })
})
