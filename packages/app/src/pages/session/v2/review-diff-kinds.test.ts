import { describe, expect, test } from "bun:test"
import { filterReviewFiles, reviewDiffKinds } from "./review-diff-kinds"

describe("reviewDiffKinds", () => {
  test("maps file and directory kinds", () => {
    const kinds = reviewDiffKinds([
      { file: "src/a.ts", additions: 1, deletions: 0, status: "added" },
      { file: "src/b.ts", additions: 0, deletions: 2, status: "deleted" },
    ])

    expect(kinds.get("src/a.ts")).toBe("add")
    expect(kinds.get("src/b.ts")).toBe("del")
    expect(kinds.get("src")).toBe("mix")
  })

  test("normalizes file and directory paths", () => {
    const kinds = reviewDiffKinds([{ file: "\\src//lib/a.ts/", additions: 1, deletions: 1, status: "modified" }])

    expect(kinds.get("src/lib/a.ts")).toBe("mix")
    expect(kinds.get("src/lib")).toBe("mix")
  })
})

describe("filterReviewFiles", () => {
  test("filters by path substring", () => {
    const files = ["src/a.ts", "src/b.ts", "lib/c.ts"]
    expect(filterReviewFiles(files, "b.ts")).toEqual(["src/b.ts"])
    expect(filterReviewFiles(files, "")).toEqual(files)
  })
})
