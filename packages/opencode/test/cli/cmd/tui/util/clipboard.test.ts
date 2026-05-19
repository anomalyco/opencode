import { describe, expect, test } from "bun:test"
import { buildOsc52Sequence } from "../../../../../src/cli/cmd/tui/util/clipboard"

function withTmux(value: string | undefined, fn: () => void): void {
  const before = process.env["TMUX"]
  if (value === undefined) delete process.env["TMUX"]
  else process.env["TMUX"] = value
  try {
    fn()
  } finally {
    if (before === undefined) delete process.env["TMUX"]
    else process.env["TMUX"] = before
  }
}

describe("buildOsc52Sequence", () => {
  test("returns plain OSC 52 without TMUX", () => {
    withTmux(undefined, () => {
      const result = buildOsc52Sequence("hello")
      expect(result).toBe("\x1b]52;c;aGVsbG8=\x07")
    })
  })

  test("returns DCS-wrapped OSC 52 with TMUX (no double ESC)", () => {
    withTmux("ses", () => {
      const result = buildOsc52Sequence("x")

      expect(result.startsWith("\x1bPtmux;")).toBe(true)

      const semicolonPos = result.indexOf(";")
      expect(result.charCodeAt(semicolonPos + 1)).toBe(0x1b)
      expect(result.charCodeAt(semicolonPos + 2)).toBe(0x5d)

      expect(result.endsWith("\x1b\\")).toBe(true)

      const escCount = Array.from(result).filter((c) => c === "\x1b").length
      expect(escCount).toBe(3)
    })
  })
})
