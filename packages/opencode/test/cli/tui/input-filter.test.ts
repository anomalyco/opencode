import { describe, expect, test } from "bun:test"
import { drop, privateuse } from "../../../src/cli/cmd/tui/util/input-filter"

describe("input filter", () => {
  test("drops private use key events", () => {
    expect(privateuse("\uE00E")).toBe(true)
    expect(drop({ name: "\uE00E" })).toBe(true)
    expect(privateuse("\u{F0000}")).toBe(true)
    expect(drop({ name: "\u{F0000}" })).toBe(true)
  })

  test("keeps ascii and chinese text", () => {
    expect(drop({ name: "a" })).toBe(false)
    expect(drop({ name: "你" })).toBe(false)
  })

  test("keeps control and navigation keys", () => {
    expect(drop({ name: "return" })).toBe(false)
    expect(drop({ name: "backspace" })).toBe(false)
    expect(drop({ name: "left" })).toBe(false)
    expect(drop({ name: "space" })).toBe(false)
  })

  test("drops lock keys", () => {
    expect(drop({ name: "capslock" })).toBe(true)
    expect(drop({ name: "numlock" })).toBe(true)
    expect(drop({ name: "scrolllock" })).toBe(true)
  })
})
