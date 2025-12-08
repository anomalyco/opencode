import { describe, expect, test } from "bun:test"
import { LSP } from "../../src/lsp"

const base = {
  severity: 1,
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  },
  message: "E0",
}

describe("LSP diagnostics budget keeps top errors", () => {
  test("highest-severity items survive cap", () => {
    const diags = [
      { ...base, message: "critical" },
      ...Array.from({ length: 120 }).map((_, i) => ({
        ...base,
        severity: 3,
        message: `info-${i}`,
      })),
    ]

    // @ts-expect-error internal helper
    const out = LSP.budgetDiagnostics({ "/tmp/file.ts": diags })["/tmp/file.ts"]

    const hasCritical = out.some((d) => d.message === "critical")
    expect(hasCritical).toBeTrue()
    expect(out.length).toBeLessThanOrEqual(51)
  })
})
