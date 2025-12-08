import { describe, expect, test } from "bun:test"
import { LSP } from "../../src/lsp"

const baseDiag = {
  severity: 1,
  range: {
    start: { line: 1, character: 1 },
    end: { line: 1, character: 2 },
  },
  message: "x",
}

describe("LSP diagnostics budget", () => {
  test("caps per-file count and total chars", () => {
    const bigMessage = "A".repeat(500)
    const diags = Array.from({ length: 200 }).map((_, i) => ({
      ...baseDiag,
      range: {
        start: { line: i, character: 0 },
        end: { line: i, character: 1 },
      },
      message: i % 2 === 0 ? bigMessage : `msg-${i}`,
    }))

    // @ts-expect-error access internal helper for test
    const result = LSP["budgetDiagnostics"]({ "/tmp/file.ts": diags })
    const out = result["/tmp/file.ts"]

    expect(out.length).toBeLessThanOrEqual(51) // 50 cap + summary
    expect(out[out.length - 1].message.includes("truncated")).toBeTrue()
    // messages should be trimmed
    const maxLen = out.reduce((m, d) => Math.max(m, d.message.length), 0)
    expect(maxLen).toBeLessThanOrEqual(205)
  })
})
