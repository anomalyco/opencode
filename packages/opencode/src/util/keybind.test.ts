import { describe, expect, test } from "bun:test"
import { parse, toString } from "./keybind"

describe("keybind", () => {
  test("parses cmd as super", () => {
    expect(parse("cmd+p")).toEqual(parse("super+p"))
    expect(parse("command+p")).toEqual(parse("super+p"))
  })

  test("renders super as cmd on macOS", () => {
    const original = process.platform
    Object.defineProperty(process, "platform", { value: "darwin" })

    expect(toString(parse("super+p")[0])).toBe("cmd+p")

    Object.defineProperty(process, "platform", { value: original })
  })
})
