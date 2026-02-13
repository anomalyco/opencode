import { describe, expect, test } from "bun:test"
import { stripTerminalRepliesFromInput } from "./input-reply-filter"

describe("input reply filter", () => {
  test("keeps plain user input", () => {
    expect(stripTerminalRepliesFromInput("hello")).toBe("hello")
  })

  test("suppresses focus reports", () => {
    expect(stripTerminalRepliesFromInput("a\u001b[Ib\u001b[Oc")).toBe("abc")
  })

  test("suppresses mode and DA replies", () => {
    const input = "a\u001b[?2004;1$yb\u001b[>0;136;0cc"
    expect(stripTerminalRepliesFromInput(input)).toBe("abc")
  })

  test("suppresses dcs query replies", () => {
    const input = "a\u001bP1$r0 q\u001b\\b\u001bP1+r6b6d3b3130\u001b\\c"
    expect(stripTerminalRepliesFromInput(input)).toBe("abc")
  })

  test("keeps cpr replies for cursor consumers", () => {
    expect(stripTerminalRepliesFromInput("a\u001b[12;34Rb")).toBe("a\u001b[12;34Rb")
  })

  test("keeps incomplete escape fragments to avoid eating user ESC", () => {
    expect(stripTerminalRepliesFromInput("\u001b")).toBe("\u001b")
    expect(stripTerminalRepliesFromInput("\u001b[12;")).toBe("\u001b[12;")
    expect(stripTerminalRepliesFromInput("\u001bP1$r")).toBe("\u001bP1$r")
  })
})
