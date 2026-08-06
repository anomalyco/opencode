import { describe, expect, test } from "bun:test"
import { compactSummaryDiffs } from "../../src/session/summary"

describe("compactSummaryDiffs", () => {
  test("strips patch text from stored summary diffs", () => {
    const out = compactSummaryDiffs([
      {
        file: "src/app.ts",
        patch: "Index: src/app.ts\n" + "x".repeat(50_000),
        additions: 12,
        deletions: 3,
        status: "modified",
      },
    ])
    expect(out).toEqual([
      {
        file: "src/app.ts",
        additions: 12,
        deletions: 3,
        status: "modified",
      },
    ])
    expect("patch" in out[0]!).toBe(false)
  })

  test("drops vendor and .node-runtime paths entirely", () => {
    const out = compactSummaryDiffs([
      {
        file: "desktop-app/.node-runtime/node-v26/LICENSE",
        patch: "huge",
        additions: 100,
        deletions: 0,
        status: "added",
      },
      {
        file: "node_modules/lodash/index.js",
        patch: "huge",
        additions: 1,
        deletions: 0,
        status: "modified",
      },
      {
        file: "src/ok.ts",
        patch: "keep-meta-only",
        additions: 1,
        deletions: 0,
        status: "modified",
      },
    ])
    expect(out).toEqual([
      {
        file: "src/ok.ts",
        additions: 1,
        deletions: 0,
        status: "modified",
      },
    ])
  })
})
