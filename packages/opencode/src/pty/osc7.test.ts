import { describe, expect, test } from "bun:test"
import { Pty } from "./index"

describe("osc7 parser", () => {
  test("osc7_parses_bel_terminator", () => {
    const out = Pty.osc7("", "\u001b]7;file://host/tmp/a\u0007")
    expect(out.cwd).toBe("/tmp/a")
    expect(out.buf).toBe("")
  })

  test("osc7_parses_st_terminator", () => {
    const out = Pty.osc7("", "\u001b]7;file://host/tmp/b\u001b\\")
    expect(out.cwd).toBe("/tmp/b")
    expect(out.buf).toBe("")
  })

  test("osc7_split_across_chunks_is_reassembled", () => {
    const first = Pty.osc7("", "abc\u001b]7;file://host/tmp")
    expect(first.cwd).toBeUndefined()
    expect(first.buf).toContain("\u001b]7;file://")

    const second = Pty.osc7(first.buf, "/split\u0007")
    expect(second.cwd).toBe("/tmp/split")
    expect(second.buf).toBe("")
  })

  test("osc7_incomplete_tail_buffer_is_capped", () => {
    const large = `x${"a".repeat(3000)}\u001b]7;file://host/${"b".repeat(1200)}`
    const out = Pty.osc7("", large)
    expect(out.cwd).toBeUndefined()
    expect(out.buf).toBe("")
  })

  test("osc7_invalid_percent_encoding_falls_back_raw", () => {
    const out = Pty.osc7("", "\u001b]7;file://host/tmp/%ZZ\u0007")
    expect(out.cwd).toBe("/tmp/%ZZ")
  })

  test("osc7_multiple_sequences_last_wins", () => {
    const out = Pty.osc7("", "\u001b]7;file://host/one\u0007x\u001b]7;file://host/two\u001b\\")
    expect(out.cwd).toBe("/two")
  })
})
