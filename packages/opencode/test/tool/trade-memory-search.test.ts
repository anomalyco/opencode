import { describe, expect, test } from "bun:test"
import { describeFtsFallback, escapeLikePattern } from "../../../../.opencode/trade-memory-core/search"

describe("trade-memory search helpers", () => {
  test("escapes LIKE wildcards", () => {
    expect(escapeLikePattern("50%_done\\now")).toBe("50\\%\\_done\\\\now")
  })

  test("distinguishes missing fts from invalid query", () => {
    expect(describeFtsFallback(new Error("no such table: memory_note_fts"))).toBe("warning: FTS unavailable, using LIKE fallback")
    expect(describeFtsFallback(new Error("fts5: syntax error near \"(\""))).toBe("warning: invalid FTS query, using LIKE fallback")
  })
})
