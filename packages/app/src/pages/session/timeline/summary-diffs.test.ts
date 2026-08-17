import { describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { uniqueSummaryDiffs } from "./summary-diffs"

const diff = (file: string, additions: number) =>
  ({
    file,
    patch: "",
    additions,
    deletions: 0,
    status: "modified",
  }) satisfies FileDiffInfo

describe("uniqueSummaryDiffs", () => {
  test("drops entries without files and preserves unique input", () => {
    const alpha = diff("alpha.ts", 1)
    const beta = diff("beta.ts", 1)
    expect(uniqueSummaryDiffs(undefined)).toEqual([])
    expect(uniqueSummaryDiffs([])).toEqual([])

    const result = uniqueSummaryDiffs([alpha, beta])
    expect(result).toEqual([alpha, beta])
    expect(result[0]).toBe(alpha)
    expect(result[1]).toBe(beta)
  })

  test("keeps the last diff per file in the legacy display order", () => {
    const oldAlpha = diff("alpha.ts", 1)
    const oldBeta = diff("beta.ts", 1)
    const newAlpha = diff("alpha.ts", 2)
    const charlie = diff("charlie.ts", 1)
    const newBeta = diff("beta.ts", 2)

    const result = uniqueSummaryDiffs([oldAlpha, oldBeta, newAlpha, charlie, newBeta])

    expect(result).toEqual([newAlpha, charlie, newBeta])
    expect(result[0]).toBe(newAlpha)
    expect(result[1]).toBe(charlie)
    expect(result[2]).toBe(newBeta)
  })
})
