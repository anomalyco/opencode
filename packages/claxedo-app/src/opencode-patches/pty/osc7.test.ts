import { describe, expect, test } from "bun:test"
import { osc7 } from "./osc7"

describe("osc7 parser", () => {
  test("osc7_parses_bel_terminator", () => {
    const out = osc7("", "\u001b]7;file://host/tmp/a\u0007")
    expect(out.cwd).toBe("/tmp/a")
    expect(out.buf).toBe("")
  })

  test("osc7_parses_st_terminator", () => {
    const out = osc7("", "\u001b]7;file://host/tmp/b\u001b\\")
    expect(out.cwd).toBe("/tmp/b")
    expect(out.buf).toBe("")
  })

  test("osc7_split_across_chunks_is_reassembled", () => {
    const first = osc7("", "abc\u001b]7;file://host/tmp")
    expect(first.cwd).toBeUndefined()
    expect(first.buf).toContain("\u001b]7;file://")

    const second = osc7(first.buf, "/split\u0007")
    expect(second.cwd).toBe("/tmp/split")
    expect(second.buf).toBe("")
  })

  test("osc7_incomplete_tail_exceeding_cap_is_discarded", () => {
    // Incomplete sequence with body > 1024 chars — buffer should be dropped
    const large = `x${"a".repeat(3000)}\u001b]7;file://host/${"b".repeat(1200)}`
    const out = osc7("", large)
    expect(out.cwd).toBeUndefined()
    expect(out.buf).toBe("")
    // Verify no cwd was extracted from the unterminated sequence
    const second = osc7(out.buf, "\u0007")
    expect(second.cwd).toBeUndefined()
  })

  test("osc7_invalid_percent_encoding_falls_back_raw", () => {
    const out = osc7("", "\u001b]7;file://host/tmp/%ZZ\u0007")
    expect(out.cwd).toBe("/tmp/%ZZ")
  })

  test("osc7_multiple_sequences_last_wins", () => {
    const out = osc7("", "\u001b]7;file://host/one\u0007x\u001b]7;file://host/two\u001b\\")
    expect(out.cwd).toBe("/two")
  })
})
