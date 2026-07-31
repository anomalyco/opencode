import { describe, expect, test } from "bun:test"

import { Identifier } from "../../src/id/id"

describe("Identifier", () => {
  test("ascending IDs remain ordered across the 2026 legacy wrap boundary", () => {
    const wrap = Date.parse("2026-08-14T11:19:55.136Z")
    const before = Identifier.create("msg", "ascending", wrap - 1)
    const after = Identifier.create("msg", "ascending", wrap)

    expect(before < after).toBe(true)
    expect(Identifier.timestamp(after)).toBe(wrap)
  })

  test("timestamp decodes old 6-byte IDs for compatibility", () => {
    expect(Identifier.timestamp("msg_fffffffff001AAAAAAAAAAAAAA")).toBe(68_719_476_735)
  })
})
