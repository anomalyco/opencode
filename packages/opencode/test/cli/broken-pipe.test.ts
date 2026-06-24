import { describe, expect, test } from "bun:test"
import { exitOnBrokenPipe, isBrokenPipeError } from "../../src/cli/broken-pipe"

describe("broken pipe handling", () => {
  test("detects EPIPE errors", () => {
    expect(isBrokenPipeError(Object.assign(new Error("broken pipe"), { code: "EPIPE" }))).toBe(true)
    expect(isBrokenPipeError(Object.assign(new Error("broken pipe"), { errno: "EPIPE" }))).toBe(true)
    expect(isBrokenPipeError(new Error("other"))).toBe(false)
  })

  test("detects EPIPE errors nested in causes", () => {
    const cause = Object.assign(new Error("broken pipe"), { code: "EPIPE" })
    expect(isBrokenPipeError(new Error("write failed", { cause }))).toBe(true)
  })

  test("exits only for broken pipe errors", () => {
    const codes: unknown[] = []
    const exit = (code?: number | string | null | undefined) => {
      codes.push(code)
    }

    expect(exitOnBrokenPipe(new Error("other"), exit)).toBe(false)
    expect(codes).toEqual([])

    expect(exitOnBrokenPipe(Object.assign(new Error("broken pipe"), { code: "EPIPE" }), exit)).toBe(true)
    expect(codes).toEqual([1])
  })
})
