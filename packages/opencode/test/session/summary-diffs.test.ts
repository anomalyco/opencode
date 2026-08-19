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
        file: "dist/bundle.js",
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

  test("normalizes windows separators for deny matching", () => {
    const out = compactSummaryDiffs([
      {
        file: "packages\\app\\node_modules\\x\\index.js",
        patch: "x",
        additions: 1,
        deletions: 0,
        status: "modified",
      },
      {
        file: "packages\\app\\src\\main.ts",
        patch: "y",
        additions: 2,
        deletions: 1,
        status: "modified",
      },
    ])
    expect(out).toEqual([
      {
        file: "packages\\app\\src\\main.ts",
        additions: 2,
        deletions: 1,
        status: "modified",
      },
    ])
  })

  test("keeps durable summary payload far below full-patch size (Jetsam regression)", () => {
    const monster = Array.from({ length: 40 }, (_, i) => ({
      file: i % 5 === 0 ? `.node-runtime/file-${i}.h` : `src/f${i}.ts`,
      patch: "P".repeat(200_000),
      additions: 10,
      deletions: 2,
      status: "modified" as const,
    }))
    const before = JSON.stringify(monster).length
    const after = JSON.stringify(compactSummaryDiffs(monster)).length
    expect(before).toBeGreaterThan(5_000_000)
    expect(after).toBeLessThan(20_000)
    expect(after).toBeLessThan(before / 100)
  })

  test("preserves entries that already lack patch text", () => {
    const out = compactSummaryDiffs([
      {
        file: "src/a.ts",
        additions: 1,
        deletions: 0,
        status: "added",
      },
    ])
    expect(out).toEqual([
      {
        file: "src/a.ts",
        additions: 1,
        deletions: 0,
        status: "added",
      },
    ])
  })
})
