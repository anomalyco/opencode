import { describe, expect, test } from "bun:test"
import { isStopIconButton } from "./icon-button-utils"

describe("IconButton", () => {
  test("treats stop as the square glyph variant", () => {
    expect(isStopIconButton("stop")).toBeTrue()
    expect(isStopIconButton("copy")).toBeFalse()
  })
})
