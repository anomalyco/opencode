import { describe, expect, test } from "bun:test"
import { bufferToAscii, type AsciiBuffer } from "@/cli/cmd/tui/ascii"

const encoder = new TextEncoder()

describe("bufferToAscii", () => {
  test("returns decoded frame bytes", () => {
    const frame = "AB C\n"
    const stub: AsciiBuffer = {
      getRealCharBytes: (_addLineBreaks: boolean) => encoder.encode(frame),
    }

    expect(bufferToAscii(stub)).toBe(frame)
  })
})
